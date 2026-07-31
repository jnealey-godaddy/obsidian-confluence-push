/**
 * A filesystem-backed stand-in for `App`, so the CLI can hand the shared
 * `Pusher` something that reads notes, resolves wikilinks and writes the
 * `confluence` property back, without Obsidian running.
 *
 * The file index is built once per invocation. A CLI process is short-lived
 * and the vault does not change underneath it, so there is nothing to watch.
 */

import { promises as fs } from "fs";
import * as path from "path";
import { TFile } from "./obsidian-shim";

/** Directories that never hold publishable notes. */
const ALWAYS_SKIP = new Set([".git", ".obsidian", "node_modules", ".trash"]);

export interface VaultIndexOptions {
	/** Vault-relative prefixes to exclude, e.g. Obsidian's userIgnoreFilters. */
	ignore?: string[];
}

/** Every file in the vault, indexed the ways link resolution needs. */
class FileIndex {
	readonly files: TFile[] = [];
	private byPath = new Map<string, TFile>();
	private byBasename = new Map<string, TFile[]>();

	add(file: TFile): void {
		this.files.push(file);
		this.byPath.set(file.path, file);
		const bucket = this.byBasename.get(file.basename);
		if (bucket) bucket.push(file);
		else this.byBasename.set(file.basename, [file]);
	}

	get(vaultPath: string): TFile | null {
		return this.byPath.get(vaultPath) ?? null;
	}

	/** Path match, trying the `.md` extension Obsidian lets links omit. */
	getByPathish(candidate: string): TFile | null {
		return this.byPath.get(candidate) ?? this.byPath.get(`${candidate}.md`) ?? null;
	}

	withBasename(basename: string): TFile[] {
		return this.byBasename.get(basename) ?? [];
	}
}

async function walk(root: string, rel: string, ignore: string[], index: FileIndex): Promise<void> {
	const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
	for (const entry of entries) {
		const childRel = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (ALWAYS_SKIP.has(entry.name)) continue;
			if (ignore.some((prefix) => `${childRel}/`.startsWith(prefix))) continue;
			await walk(root, childRel, ignore, index);
		} else if (entry.isFile()) {
			index.add(new TFile(childRel));
		}
	}
}

/**
 * Splits a note into its frontmatter block and the rest.
 *
 * `block` is the YAML between the delimiters, `bodyStart` the offset just past
 * the closing delimiter line, so the property writer can rebuild the file
 * without touching a byte of the body.
 */
interface FrontmatterSpan {
	block: string;
	start: number;
	end: number;
}

function findFrontmatter(text: string): FrontmatterSpan | null {
	if (!text.startsWith("---")) return null;
	const firstBreak = text.indexOf("\n");
	if (firstBreak === -1 || text.slice(0, firstBreak).trim() !== "---") return null;

	const closing = /^---[ \t]*$/m;
	const rest = text.slice(firstBreak + 1);
	const match = closing.exec(rest);
	if (!match) return null;

	return {
		block: rest.slice(0, match.index),
		start: firstBreak + 1,
		end: firstBreak + 1 + match.index,
	};
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length >= 2) {
		const first = trimmed[0];
		const last = trimmed[trimmed.length - 1];
		if ((first === '"' || first === "'") && last === first) {
			const inner = trimmed.slice(1, -1);
			return first === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner;
		}
	}
	// An unquoted scalar runs to a trailing comment, if there is one.
	return trimmed.replace(/\s+#.*$/, "").trim();
}

/**
 * Top-level scalars and simple lists from a frontmatter block.
 *
 * Deliberately not a general YAML parser. Everything the pusher reads is a
 * top-level scalar; lists are parsed only so a caller inspecting `tags` sees
 * something sensible, and nested maps are skipped rather than guessed at.
 */
export function parseFrontmatter(block: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = block.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim() || line.trimStart().startsWith("#")) continue;
		if (/^\s/.test(line)) continue; // Belongs to the entry above.

		const match = /^([A-Za-z0-9_.-]+):(.*)$/.exec(line);
		if (!match) continue;
		const [, key, rawValue] = match;
		const value = rawValue.trim();

		if (!value) {
			// A block list follows, or the key is simply empty.
			const items: string[] = [];
			while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
				items.push(unquote(lines[++i].replace(/^\s*-\s+/, "")));
			}
			result[key] = items.length ? items : "";
			continue;
		}

		if (value.startsWith("[") && value.endsWith("]")) {
			const inner = value.slice(1, -1).trim();
			result[key] = inner ? inner.split(",").map((item) => unquote(item)) : [];
			continue;
		}

		result[key] = unquote(value);
	}

	return result;
}

function quote(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Rewrites one top-level scalar property, leaving the rest of the file byte
 * for byte as it was.
 *
 * Line surgery rather than a YAML round-trip: these notes carry hand-written
 * frontmatter whose quoting, ordering and inline-list style are conventions
 * worth preserving, and reserializing would quietly rewrite all of it.
 */
export function setFrontmatterProperty(text: string, key: string, value: string): string {
	const line = `${key}: ${quote(value)}`;
	const span = findFrontmatter(text);

	if (!span) {
		return `---\n${line}\n---\n\n${text.replace(/^\n+/, "")}`;
	}

	const pattern = new RegExp(`^${key}:.*$`, "m");
	if (pattern.test(span.block)) {
		const updated = span.block.replace(pattern, line);
		return text.slice(0, span.start) + updated + text.slice(span.end);
	}

	const separator = span.block.endsWith("\n") ? "" : "\n";
	return text.slice(0, span.start) + span.block + separator + line + "\n" + text.slice(span.end);
}

export class NodeVault {
	private index = new FileIndex();
	private cache = new Map<string, Record<string, unknown>>();

	private constructor(readonly root: string) {}

	static async open(root: string, opts: VaultIndexOptions = {}): Promise<NodeVault> {
		const vault = new NodeVault(path.resolve(root));
		await walk(vault.root, "", opts.ignore ?? [], vault.index);
		return vault;
	}

	absolute(file: TFile): string {
		return path.join(this.root, file.path);
	}

	/** Resolves any path the user might type: absolute, relative to cwd, or vault-relative. */
	resolve(input: string): TFile | null {
		const direct = this.index.getByPathish(input);
		if (direct) return direct;

		const absolute = path.resolve(input);
		if (absolute.startsWith(this.root + path.sep)) {
			return this.index.getByPathish(absolute.slice(this.root.length + 1));
		}
		return null;
	}

	markdownFiles(): TFile[] {
		return this.index.files.filter((file) => file.extension === "md");
	}

	async read(file: TFile): Promise<string> {
		return fs.readFile(this.absolute(file), "utf8");
	}

	async frontmatter(file: TFile): Promise<Record<string, unknown>> {
		const cached = this.cache.get(file.path);
		if (cached) return cached;

		const span = findFrontmatter(await this.read(file));
		const parsed = span ? parseFrontmatter(span.block) : {};
		this.cache.set(file.path, parsed);
		return parsed;
	}

	/**
	 * Obsidian resolves a wikilink target as a path first, then as a basename,
	 * preferring a match beside the linking note and otherwise the shallowest
	 * path in the vault. This mirrors that closely enough that the links a note
	 * publishes with match what the app shows.
	 */
	resolveLinkpath(target: string, sourcePath: string): TFile | null {
		const clean = target.split("#")[0].split("|")[0].trim();
		if (!clean) return null;

		const byPath = this.index.getByPathish(clean);
		if (byPath) return byPath;

		const sourceDir = sourcePath.includes("/")
			? sourcePath.slice(0, sourcePath.lastIndexOf("/"))
			: "";
		if (sourceDir) {
			const sibling = this.index.getByPathish(`${sourceDir}/${clean}`);
			if (sibling) return sibling;
		}

		const basename = clean.includes("/") ? (clean.split("/").pop() as string) : clean;
		const matches = this.index.withBasename(basename.replace(/\.md$/, ""));
		if (!matches.length) return null;
		if (matches.length === 1) return matches[0];

		const beside = matches.find((file) => file.path.startsWith(sourceDir ? `${sourceDir}/` : ""));
		if (beside && sourceDir) return beside;
		return [...matches].sort(
			(a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path)
		)[0];
	}

	/**
	 * The object `Pusher` expects as its `App`.
	 *
	 * `Pusher` reaches for a handful of synchronous metadata calls, which is why
	 * frontmatter is cached up front by `warmFrontmatter` rather than read on
	 * demand here.
	 */
	asApp(): unknown {
		return {
			vault: {
				cachedRead: (file: TFile) => this.read(file),
				readBinary: async (file: TFile): Promise<ArrayBuffer> => {
					const buffer = await fs.readFile(this.absolute(file));
					return buffer.buffer.slice(
						buffer.byteOffset,
						buffer.byteOffset + buffer.byteLength
					) as ArrayBuffer;
				},
				getAbstractFileByPath: (vaultPath: string) => this.index.get(vaultPath),
				getMarkdownFiles: () => this.markdownFiles(),
			},
			metadataCache: {
				getFileCache: (file: TFile) => ({ frontmatter: this.cache.get(file.path) ?? {} }),
				getFirstLinkpathDest: (target: string, sourcePath: string) =>
					this.resolveLinkpath(target, sourcePath),
			},
			fileManager: {
				processFrontMatter: async (
					file: TFile,
					fn: (frontmatter: Record<string, unknown>) => void
				): Promise<void> => {
					const text = await this.read(file);
					const span = findFrontmatter(text);
					const before = span ? parseFrontmatter(span.block) : {};
					const after: Record<string, unknown> = { ...before };
					fn(after);

					let updated = text;
					for (const [key, value] of Object.entries(after)) {
						if (before[key] === value) continue;
						updated = setFrontmatterProperty(updated, key, String(value));
					}
					if (updated !== text) await fs.writeFile(this.absolute(file), updated, "utf8");
					this.cache.set(file.path, after);
				},
			},
		};
	}

	/**
	 * Loads frontmatter for every note that could be reached as a link target,
	 * so the synchronous metadata calls above have something to answer with.
	 */
	async warmFrontmatter(): Promise<void> {
		for (const file of this.markdownFiles()) {
			try {
				await this.frontmatter(file);
			} catch {
				// An unreadable note simply has no metadata; it is not fatal to a push.
			}
		}
	}
}
