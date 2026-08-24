/**
 * Command-line front end for the same pusher the Obsidian plugin uses.
 *
 * Everything here is plumbing: reading settings out of `data.json`, standing up
 * a filesystem vault, and printing results. The conversion, the REST calls and
 * the conflict rules all come from `storage.ts`, `confluence.ts` and `push.ts`
 * unchanged, so a note published from a terminal is the same page the plugin
 * would have published.
 *
 * Sync state is written back to the plugin's `data.json`, which is what lets
 * the two front ends take turns on the same note.
 */

import { promises as fs } from "fs";
import * as path from "path";
import type { App, TFile } from "obsidian";
import { Modal, TFile as VaultFile } from "./node/obsidian-shim";
import { NodeVault } from "./node/vault-fs";
import { ConfluenceClient, ConfluenceNode, pageIdFromUrl } from "./confluence";
import { Pusher, PushOutcome } from "./push";
import { StorageConverter } from "./storage";
import { ConfluencePushSettings, DEFAULT_SETTINGS, PluginData } from "./settings";
import { SyncRecord } from "./types";
import {
	PullOutcome,
	isSidecarPath,
	inPlaceContents,
	pullState,
	shouldPull,
	sidecarContents,
	sidecarPathFor,
} from "./pull";

const PLUGIN_DIR = path.resolve(__dirname);
const VAULT_ROOT = path.resolve(PLUGIN_DIR, "../../..");
const DATA_FILE = path.join(PLUGIN_DIR, "data.json");
const APP_CONFIG = path.join(VAULT_ROOT, ".obsidian/app.json");

const USAGE = `confluence-push - publish vault notes to Confluence

Usage:
  confluence-push push <note>... [--force] [--parent <id|url>] [--dry-run]
  confluence-push push --all [--force]
  confluence-push move <note>... [--parent <id|url>] [--dry-run]
  confluence-push move --all [--dry-run]
  confluence-push status [<note>...]
  confluence-push pull <note>... [--force] [--dry-run]
  confluence-push pull --all [--force] [--dry-run]
  confluence-push pull <note>... --in-place [--force] [--dry-run]
  confluence-push pull <note> --stdout
  confluence-push preview <note>
  confluence-push tree [<page id|url>]
  confluence-push mkfolder <title> --parent <id|url>

Commands:
  push       Create or update the Confluence page for each note.
  move       Bring a page's title and parent in line with its note, leaving content untouched.
  status     Report what each note is bound to and whether it has drifted.
  pull       Write a review copy of each changed page beside its note.
  preview    Print the storage-format markup without publishing.
  tree       Print the page and folder hierarchy under a page.
  mkfolder   Create a Confluence folder, or print the id of one that already exists.

Options:
  --all        Act on every note that already has a page.
  --force      Overwrite remote content without asking, and ignore the unchanged check.
               With pull, write a review copy even for a page that has not changed.
               With pull --all --in-place, confirm overwriting every published note.
  --parent     Parent page or folder for notes that do not name one themselves.
  --dry-run    Report what would happen without changing anything.
  --stdout     With pull, print the page instead of writing a review copy.
  --in-place   With pull, write the page over the note's body instead of beside it.
  --json       Machine-readable output.

pull saves what Confluence holds as a separate <note>.confluence.md review copy,
because a page comes back rendered rather than as the Markdown that was pushed.
Read it, copy across what you want, delete it.

pull --in-place skips that step and writes the page straight over the note's
body, keeping its frontmatter. Use it once you have decided the Confluence
version wins: the note keeps Confluence's rendering, absolute links and panels
included, and pushing afterwards sends that back. Sweeping the whole vault that
way is refused unless you pass --all and --force together.

A note names its own page title, space and parent through the title,
confluenceSpace and confluenceParent frontmatter properties. The published URL
is written back to the confluence property.
`;

interface Args {
	command: string;
	positional: string[];
	force: boolean;
	all: boolean;
	dryRun: boolean;
	json: boolean;
	parent: string | null;
	/** Print a pulled page instead of writing a review copy. */
	stdout: boolean;
	/** Write a pulled page over the note's body instead of beside it. */
	inPlace: boolean;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		command: argv[0] ?? "",
		positional: [],
		force: false,
		all: false,
		dryRun: false,
		json: false,
		parent: null,
		stdout: false,
		inPlace: false,
	};

	for (let i = 1; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--force" || arg === "-f") args.force = true;
		else if (arg === "--all") args.all = true;
		else if (arg === "--dry-run" || arg === "-n") args.dryRun = true;
		else if (arg === "--json") args.json = true;
		else if (arg === "--stdout") args.stdout = true;
		else if (arg === "--in-place") args.inPlace = true;
		else if (arg === "--parent") args.parent = argv[++i] ?? null;
		else if (arg.startsWith("--parent=")) args.parent = arg.slice("--parent=".length);
		else if (arg.startsWith("-")) throw new Error(`Unknown option "${arg}".`);
		else args.positional.push(arg);
	}

	return args;
}

/**
 * `Pusher` is typed against the real Obsidian API. The CLI hands it a
 * filesystem stand-in, so the cast happens here, once, rather than being
 * spread through every call site.
 */
function asObsidianFile(file: VaultFile): TFile {
	return file as unknown as TFile;
}

function fail(message: string): never {
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

async function readPluginData(): Promise<PluginData> {
	let raw: Partial<PluginData>;
	try {
		raw = JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as Partial<PluginData>;
	} catch {
		fail(`Could not read ${DATA_FILE}. Configure the plugin in Obsidian first.`);
	}
	const settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings ?? {});
	if (!settings.siteUrl || !settings.email || !settings.apiToken) {
		fail("Confluence credentials are not configured. Open the plugin settings in Obsidian.");
	}
	return { settings, sync: (raw.sync ?? {}) as Record<string, SyncRecord> };
}

/**
 * Writes sync state back without disturbing anything else in the file.
 *
 * Re-reads first so a push that landed from Obsidian while this process was
 * working is not thrown away, mirroring the merge the plugin does on save.
 */
async function writeSyncState(sync: Record<string, SyncRecord>): Promise<void> {
	const raw = JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as Partial<PluginData>;
	const merged: Record<string, SyncRecord> = { ...(raw.sync ?? {}) };
	for (const [notePath, record] of Object.entries(sync)) {
		const theirs = merged[notePath];
		if (!theirs || record.lastPushedAt >= theirs.lastPushedAt) merged[notePath] = record;
	}
	raw.sync = merged;
	await fs.writeFile(DATA_FILE, JSON.stringify(raw, null, 2) + "\n", "utf8");
}

/**
 * Coalesces the per-note sync-state writes a push batch would otherwise make.
 *
 * `Pusher` persists after every note so a note that failed cannot erase the
 * record of one that succeeded. That is the right instinct, but the whole file
 * is rewritten each time, so a sweep over a large vault rewrites a file that
 * grows with the vault once per note. Marking the state dirty and flushing once
 * keeps the write count linear. The batch loops catch their own per-note errors
 * and flush in a `finally`, so the state still reaches disk on the failure paths
 * the per-note write was protecting.
 */
function coalescedPersist(write: () => Promise<void>): {
	mark: () => Promise<void>;
	flush: () => Promise<void>;
} {
	let dirty = false;
	return {
		mark: async () => {
			dirty = true;
		},
		flush: async () => {
			if (!dirty) return;
			dirty = false;
			await write();
		},
	};
}

/** Obsidian's own exclusions, so the CLI indexes the same notes the app does. */
async function ignoredPrefixes(): Promise<string[]> {
	try {
		const config = JSON.parse(await fs.readFile(APP_CONFIG, "utf8")) as {
			userIgnoreFilters?: string[];
		};
		return (config.userIgnoreFilters ?? []).map((prefix) =>
			prefix.endsWith("/") ? prefix : `${prefix}/`
		);
	} catch {
		return [];
	}
}

async function openVault(): Promise<NodeVault> {
	const vault = await NodeVault.open(VAULT_ROOT, { ignore: await ignoredPrefixes() });
	await vault.warmFrontmatter();
	return vault;
}

function clientFor(settings: ConfluencePushSettings): ConfluenceClient {
	return new ConfluenceClient({
		siteUrl: settings.siteUrl,
		email: settings.email,
		apiToken: settings.apiToken,
	});
}

function resolveNotes(vault: NodeVault, inputs: string[]): VaultFile[] {
	return inputs.map((input) => {
		const file = vault.resolve(input);
		if (!file) fail(`Not a note in this vault: ${input}`);
		if (file.extension !== "md") fail(`Not a Markdown note: ${input}`);
		return file;
	});
}

/**
 * Rejects the case where two notes claim the same Confluence page.
 *
 * Usually a `confluence` URL that was copy-pasted between notes. Left alone the
 * notes overwrite each other's title and content on every run, each undoing the
 * last, and the page version climbs forever without anything converging.
 */
async function assertOnePageEach(vault: NodeVault, data: PluginData, files: VaultFile[]): Promise<void> {
	const claims = new Map<string, string[]>();
	for (const file of files) {
		const url = (await vault.frontmatter(file))[data.settings.frontmatterProperty];
		const pageId =
			data.sync[file.path]?.pageId ?? (typeof url === "string" ? pageIdFromUrl(url) : null);
		if (!pageId) continue;
		const bucket = claims.get(pageId);
		if (bucket) bucket.push(file.path);
		else claims.set(pageId, [file.path]);
	}

	const shared = [...claims].filter(([, notes]) => notes.length > 1);
	if (!shared.length) return;

	const lines = shared.map(
		([pageId, notes]) => `  page ${pageId}\n${notes.map((n) => `    ${n}`).join("\n")}`
	);
	fail(
		"More than one note is bound to the same Confluence page:\n" +
			lines.join("\n") +
			"\n\nClear the confluence property on all but one of each group, then run again."
	);
}

/** Every note already bound to a page, by sync state or by frontmatter. */
/**
 * The notes a batch command should act on.
 *
 * `--all` and a list of names are two answers to the same question, so being
 * given both is a mistake worth reporting rather than resolving by precedence:
 * quietly preferring one would act on the whole vault when three notes were
 * meant, or the reverse. Neither is refused too, so no command treats "no
 * arguments" as "everything you have".
 */
async function selectNotes(
	vault: NodeVault,
	data: PluginData,
	args: Args,
	verb: string
): Promise<VaultFile[]> {
	if (args.all && args.positional.length) {
		fail(`--all acts on every published note, so naming notes as well asks for two different things.`);
	}
	if (!args.all && !args.positional.length) {
		fail(`Name at least one note to ${verb}, or pass --all for every published note.`);
	}
	return args.all ? await publishedNotes(vault, data) : resolveNotes(vault, args.positional);
}

async function publishedNotes(vault: NodeVault, data: PluginData): Promise<VaultFile[]> {
	const published: VaultFile[] = [];
	for (const file of vault.markdownFiles()) {
		if (data.sync[file.path]) {
			published.push(file);
			continue;
		}
		const url = (await vault.frontmatter(file))[data.settings.frontmatterProperty];
		if (typeof url === "string" && pageIdFromUrl(url)) published.push(file);
	}
	return published;
}

/**
 * Answers the plugin's overwrite prompts on a terminal's behalf.
 *
 * Declining is the only safe default: a prompt means content in Confluence
 * would be replaced with something nobody has compared it against. The reason
 * is captured so the operator can decide whether to re-run with --force.
 */
function installPromptPolicy(): string[] {
	const reasons: string[] = [];
	Modal.handler = (modal) => {
		reasons.push(modal.describe().join(" "));
		const cancel = modal.button("Cancel");
		if (cancel) cancel.click();
		else modal.close();
	};
	return reasons;
}

interface PushReport {
	note: string;
	outcome: PushOutcome | "failed";
	url: string | null;
	warnings: string[];
	attachments: number;
	error?: string;
}

async function commandPush(args: Args): Promise<void> {
	const data = await readPluginData();
	if (args.parent) {
		const parentId = pageIdFromUrl(args.parent);
		if (!parentId) fail(`Could not read a page id from --parent "${args.parent}".`);
		data.settings.defaultParentPageId = parentId;
	}

	const vault = await openVault();
	const files = await selectNotes(vault, data, args, "push");
	if (!files.length) fail("No published notes found.");
	await assertOnePageEach(vault, data, files);

	if (args.dryRun) {
		for (const file of files) {
			// Same binding rule the pusher uses: sync state first, then the
			// property on the note, so a dry run does not claim it would create
			// a page that already exists.
			const url = (await vault.frontmatter(file))[data.settings.frontmatterProperty];
			const pageId =
				data.sync[file.path]?.pageId ?? (typeof url === "string" ? pageIdFromUrl(url) : null);
			process.stdout.write(
				`${pageId ? "would update" : "would create"}  ${file.path}` +
					(pageId ? `  [${pageId}]` : "") +
					"\n"
			);
		}
		return;
	}

	const client = clientFor(data.settings);
	const reasons = installPromptPolicy();
	const state = coalescedPersist(() => writeSyncState(data.sync));
	const pusher = new Pusher(
		vault.asApp() as App,
		client,
		data.settings,
		data.sync,
		state.mark
	);

	const reports: PushReport[] = [];
	try {
		for (const file of files) {
			reasons.length = 0;
			try {
				const result = await pusher.push(asObsidianFile(file), { force: args.force });
				reports.push({
					note: file.path,
					outcome: result.outcome,
					url: result.url,
					warnings: result.outcome === "cancelled" ? [...reasons] : result.warnings,
					attachments: result.attachmentsUploaded,
				});
			} catch (err) {
				reports.push({
					note: file.path,
					outcome: "failed",
					url: null,
					warnings: [],
					attachments: 0,
					error: (err as Error).message,
				});
			}
		}
	} finally {
		await state.flush();
	}

	if (args.json) {
		process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
	} else {
		for (const report of reports) {
			const suffix = report.attachments ? ` (+${report.attachments} attachments)` : "";
			process.stdout.write(`${report.outcome.padEnd(9)} ${report.note}${suffix}\n`);
			if (report.url) process.stdout.write(`          ${report.url}\n`);
			if (report.error) process.stdout.write(`          ${report.error}\n`);
			for (const warning of report.warnings) process.stdout.write(`          ! ${warning}\n`);
		}
		const counts = new Map<string, number>();
		for (const report of reports) counts.set(report.outcome, (counts.get(report.outcome) ?? 0) + 1);
		process.stdout.write(
			`\n${[...counts].map(([outcome, n]) => `${n} ${outcome}`).join(", ")}\n`
		);
	}

	if (reports.some((report) => report.outcome === "failed")) process.exit(1);
}

async function commandStatus(args: Args): Promise<void> {
	const data = await readPluginData();
	const vault = await openVault();
	const client = clientFor(data.settings);

	const files = args.positional.length
		? resolveNotes(vault, args.positional)
		: await publishedNotes(vault, data);

	const rows: Record<string, unknown>[] = [];
	for (const file of files) {
		const record = data.sync[file.path];
		const url = (await vault.frontmatter(file))[data.settings.frontmatterProperty];
		const pageId = record?.pageId ?? (typeof url === "string" ? pageIdFromUrl(url) : null);

		if (!pageId) {
			rows.push({ note: file.path, state: "not published" });
			continue;
		}

		const remote = await client.getPage(pageId);
		if (!remote) {
			rows.push({ note: file.path, pageId, state: "missing in Confluence" });
			continue;
		}

		rows.push({
			note: file.path,
			pageId,
			title: remote.title,
			parentId: remote.parentId,
			remoteVersion: remote.version,
			lastPushedVersion: record?.lastPushedVersion ?? null,
			state: !record
				? "untracked by this vault"
				: record.lastPushedVersion === remote.version
					? "in sync"
					: "edited in Confluence",
			url: client.pageUrl(record?.spaceKey ?? data.settings.defaultSpaceKey, pageId),
		});
	}

	if (args.json) {
		process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
		return;
	}
	for (const row of rows) process.stdout.write(`${String(row.state).padEnd(24)} ${row.note}\n`);
}

/**
 * Brings a published page's title and placement in line with its note, without
 * republishing it.
 *
 * Reorganising is not the same act as publishing: a page may carry edits or
 * comments this vault has never seen, and refiling or renaming it should not
 * put any of that at risk. Content is left exactly as Confluence holds it.
 */
async function commandMove(args: Args): Promise<void> {
	const data = await readPluginData();
	const vault = await openVault();
	const client = clientFor(data.settings);

	const override = args.parent ? pageIdFromUrl(args.parent) : null;
	if (args.parent && !override) fail(`Could not read a page id from --parent "${args.parent}".`);

	const files = await selectNotes(vault, data, args, "move");
	if (!files.length) fail("No published notes found.");
	await assertOnePageEach(vault, data, files);

	let moved = 0;
	let inPlace = 0;
	let touched = false;
	const problems: string[] = [];

	for (const file of files) {
		const frontmatter = await vault.frontmatter(file);
		const url = frontmatter[data.settings.frontmatterProperty];
		const pageId =
			data.sync[file.path]?.pageId ?? (typeof url === "string" ? pageIdFromUrl(url) : null);
		if (!pageId) {
			problems.push(`${file.path}: not published`);
			continue;
		}

		const declared = frontmatter.confluenceParent;
		const target =
			override ?? (typeof declared === "string" ? pageIdFromUrl(declared) : null);
		if (!target) {
			problems.push(`${file.path}: no confluenceParent, and no --parent given`);
			continue;
		}

		const remote = await client.getPage(pageId);
		if (!remote) {
			problems.push(`${file.path}: page ${pageId} is missing in Confluence`);
			continue;
		}

		const title =
			typeof frontmatter.title === "string" && frontmatter.title.trim()
				? frontmatter.title.trim()
				: file.basename;
		const needsMove = remote.parentId !== target;
		const needsTitle = remote.title !== title;

		if (!needsMove && !needsTitle) {
			inPlace++;
			continue;
		}

		const what = [needsMove ? `-> ${target}` : "", needsTitle ? `"${title}"` : ""]
			.filter(Boolean)
			.join("  ");

		if (args.dryRun) {
			process.stdout.write(`would refile  ${file.path}  ${what}\n`);
			moved++;
			continue;
		}

		try {
			// Retitle first: the move endpoint does not take a title, and doing it
			// second would mean re-reading the page for its new version number.
			if (needsTitle) {
				const renamed = await client.retitle({
					pageId,
					title,
					currentVersion: remote.version,
				});
				// A rename is a new version, and this vault is the one that made it.
				// Without recording that, every renamed page would report as edited
				// in Confluence and prompt on the next push.
				const record = data.sync[file.path];
				if (record) {
					record.lastPushedVersion = renamed.version;
					record.title = title;
					record.lastPushedAt = new Date().toISOString();
					touched = true;
				}
			}
			if (needsMove) await client.moveContent(pageId, target);
			process.stdout.write(`refiled   ${file.path}  ${what}\n`);
			moved++;
		} catch (err) {
			problems.push(`${file.path}: ${(err as Error).message}`);
		}
	}

	if (touched) await writeSyncState(data.sync);

	process.stdout.write(`\n${moved} refiled, ${inPlace} already correct, ${problems.length} skipped\n`);
	for (const problem of problems) process.stdout.write(`  ! ${problem}\n`);
	if (problems.length) process.exitCode = 1;
}

async function commandPreview(args: Args): Promise<void> {
	const data = await readPluginData();
	const vault = await openVault();
	const [file] = resolveNotes(vault, args.positional.slice(0, 1));
	if (!file) fail("Name a note to preview.");

	const pusher = new Pusher(
		vault.asApp() as App,
		clientFor(data.settings),
		data.settings,
		data.sync,
		async () => {}
	);
	const note = asObsidianFile(file);
	const title = pusher.titleFor(note);
	const result = new StorageConverter(pusher.buildContext(note)).convert(await vault.read(file), {
		skipFirstHeading: data.settings.skipDuplicateTitleHeading ? title : undefined,
	});

	if (args.json) {
		process.stdout.write(JSON.stringify({ title, ...result }, null, 2) + "\n");
		return;
	}
	for (const warning of result.warnings) process.stderr.write(`! ${warning}\n`);
	process.stdout.write(result.storage + "\n");
}

/**
 * Prints what Confluence currently holds for a note, as Markdown.
 *
 * For reading, never for writing back. Confluence renders this itself, so it
 * comes back normalised rather than as the Markdown that was pushed: absolute
 * links, panels in place of callouts, no frontmatter. Reconciling a page a
 * teammate edited is a judgement call, so this shows you the text and leaves
 * the note alone.
 */
async function commandPullToStdout(args: Args): Promise<void> {
	const data = await readPluginData();
	const vault = await openVault();
	const client = clientFor(data.settings);

	const [file] = resolveNotes(vault, args.positional.slice(0, 1));
	if (!file) fail("Name a note to pull.");

	const url = (await vault.frontmatter(file))[data.settings.frontmatterProperty];
	const pageId =
		data.sync[file.path]?.pageId ?? (typeof url === "string" ? pageIdFromUrl(url) : null);
	if (!pageId) fail(`"${file.path}" is not published, so there is nothing to pull.`);

	const remote = await client.getPageMarkdown(pageId);
	if (!remote) fail(`Page ${pageId} was not found.`);

	const record = data.sync[file.path];
	if (args.json) {
		process.stdout.write(
			JSON.stringify({ ...remote, pageId, lastPushedVersion: record?.lastPushedVersion ?? null }, null, 2) + "\n"
		);
		return;
	}

	const drift =
		record?.lastPushedVersion === remote.version
			? "unchanged since your last push"
			: record
				? `edited since your last push (you pushed v${record.lastPushedVersion})`
				: "not tracked by this vault, so its history is unknown";
	// The report goes to stderr so stdout stays pipeable into a diff.
	process.stderr.write(
		`${remote.title}\nversion ${remote.version}, ${remote.editedAt}\n${drift}\n` +
			`${client.pageUrl(record?.spaceKey ?? data.settings.defaultSpaceKey, pageId)}\n\n`
	);
	process.stdout.write(remote.markdown + "\n");
}

/**
 * Brings changed pages back down: beside their notes for review, or with
 * `--in-place`, over the notes themselves.
 *
 * The default answers "what does Confluence say now" and leaves what to keep
 * from it as a decision for whoever reads the diff. `--in-place` is for when
 * that decision is already made and the Confluence version wins outright.
 */
async function commandPull(args: Args): Promise<void> {
	if (args.inPlace && args.stdout) fail("--in-place and --stdout ask for different things.");
	if (args.stdout) return commandPullToStdout(args);
	const data = await readPluginData();
	const vault = await openVault();
	const client = clientFor(data.settings);
	const pulledAt = new Date().toISOString();

	const sweeping = args.all;
	// Sweeping in place rewrites the body of every drifted note in the vault in one
	// unattended pass, with no copy of what was there before. --all says which notes,
	// --force says you accept losing what is in them.
	if (sweeping && args.inPlace && !args.force) {
		fail(
			"Refusing to overwrite every published note at once. Name the notes to pull " +
				"in place, or pass --force alongside --all if you really mean the whole vault."
		);
	}
	const files = (await selectNotes(vault, data, args, "pull")).filter(
		(file) => !isSidecarPath(file.path)
	);

	if (!files.length) fail("No published notes found.");

	const outcomes: PullOutcome[] = [];
	for (const file of files) {
		const record = data.sync[file.path];
		try {
			const url = (await vault.frontmatter(file))[data.settings.frontmatterProperty];
			const pageId = record?.pageId ?? (typeof url === "string" ? pageIdFromUrl(url) : null);
			const lastPushedVersion = record?.lastPushedVersion ?? null;

			const remote = pageId ? await client.getPageMarkdown(pageId) : null;
			const state = pullState({
				pageId,
				remoteExists: remote !== null,
				remoteVersion: remote?.version ?? null,
				lastPushedVersion,
			});

			const outcome: PullOutcome = {
				notePath: file.path,
				state,
				pageId,
				remoteVersion: remote?.version ?? null,
				lastPushedVersion,
				sidecarPath: null,
				inPlace: false,
				error: null,
				url: pageId
					? client.pageUrl(record?.spaceKey ?? data.settings.defaultSpaceKey, pageId)
					: null,
			};

			if (remote && (shouldPull(state, { sweeping }) || args.force)) {
				if (args.inPlace) {
					outcome.inPlace = true;
					if (!args.dryRun) {
						const notePath = path.join(VAULT_ROOT, file.path);
						const existing = await fs.readFile(notePath, "utf8");
						await fs.writeFile(notePath, inPlaceContents({ existing, remote }), "utf8");
						// The note now holds what Confluence holds, so the drift is settled
						// and should stop being reported. contentHash is left alone on
						// purpose: this body renders to different markup than the one last
						// pushed, and stamping the hash would make the next push skip as a
						// no-op and leave the page stale. Untracked notes gain no record,
						// because a pull learns nothing about what was last pushed.
						//
						// Written per note rather than batched at the end, so a later note
						// failing cannot erase the bookkeeping for one already overwritten:
						// the file on disk and the record describing it move together.
						if (record) {
							await writeSyncState({
								[file.path]: { ...record, lastPushedVersion: remote.version },
							});
						}
					}
				} else {
					outcome.sidecarPath = sidecarPathFor(file.path);
					if (!args.dryRun) {
						await fs.writeFile(
							path.join(VAULT_ROOT, outcome.sidecarPath),
							sidecarContents({
								remote,
								notePath: file.path,
								url: outcome.url ?? "",
								lastPushedVersion,
								pulledAt,
							}),
							"utf8"
						);
					}
				}
			}

			outcomes.push(outcome);
		} catch (err) {
			// One unreachable page or unreadable file should not abandon the notes
			// still queued behind it, the same way a failed push does not.
			outcomes.push({
				notePath: file.path,
				state: "failed",
				pageId: record?.pageId ?? null,
				remoteVersion: null,
				lastPushedVersion: record?.lastPushedVersion ?? null,
				sidecarPath: null,
				inPlace: false,
				error: err instanceof Error ? err.message : String(err),
				url: null,
			});
		}
	}

	const failed = outcomes.filter((o) => o.error).length;
	if (failed) process.exitCode = 1;

	if (args.json) {
		process.stdout.write(JSON.stringify(outcomes, null, 2) + "\n");
		return;
	}

	let written = 0;
	for (const outcome of outcomes) {
		if (outcome.error) {
			process.stdout.write(`${"failed".padEnd(14)} ${outcome.notePath}\n`);
			process.stdout.write(`${" ".repeat(14)} ! ${outcome.error}\n`);
			continue;
		}
		const versions =
			outcome.remoteVersion === null
				? ""
				: `  v${outcome.lastPushedVersion ?? "?"} -> v${outcome.remoteVersion}`;
		process.stdout.write(`${outcome.state.padEnd(14)} ${outcome.notePath}${versions}\n`);
		if (outcome.inPlace) {
			written++;
			process.stdout.write(
				`${" ".repeat(14)} ${args.dryRun ? "would overwrite" : "overwrote"} ${outcome.notePath}\n`
			);
		} else if (outcome.sidecarPath) {
			written++;
			process.stdout.write(`${" ".repeat(14)} ${args.dryRun ? "would write" : "wrote"} ${outcome.sidecarPath}\n`);
		}
	}
	const drifted = outcomes.filter((o) => o.state === "drifted").length;
	const untracked = outcomes.filter((o) => o.state === "untracked").length;
	process.stdout.write(
		args.inPlace
			? `\n${drifted} drifted, ${written} ${written === 1 ? "note" : "notes"} ` +
					`${args.dryRun ? "would be overwritten" : "overwritten"}\n`
			: `\n${drifted} drifted, ${written} review ${written === 1 ? "copy" : "copies"} ` +
					`${args.dryRun ? "would be written" : "written"}\n`
	);
	if (untracked && sweeping) {
		process.stdout.write(
			`${untracked} published before this vault kept records, so there is no baseline ` +
				`to compare them against. Pull one by name to see what Confluence holds.\n`
		);
	}
	if (failed) process.stdout.write(`${failed} failed\n`);
}

function renderTree(nodes: ConfluenceNode[], rootId: string, rootTitle: string): string {
	const children = new Map<string, ConfluenceNode[]>();
	for (const node of nodes) {
		const key = node.parentId ?? rootId;
		const bucket = children.get(key);
		if (bucket) bucket.push(node);
		else children.set(key, [node]);
	}

	const lines = [`${rootTitle}  [${rootId}]`];
	const walk = (parentId: string, depth: number): void => {
		for (const node of children.get(parentId) ?? []) {
			lines.push(
				`${"  ".repeat(depth)}- ${node.title}${node.type === "folder" ? "/" : ""}  [${node.id}]`
			);
			walk(node.id, depth + 1);
		}
	};
	walk(rootId, 1);
	return lines.join("\n");
}

async function commandTree(args: Args): Promise<void> {
	const data = await readPluginData();
	const client = clientFor(data.settings);

	const rootId = pageIdFromUrl(args.positional[0] ?? data.settings.defaultParentPageId);
	if (!rootId) fail("Name the page to print, or set a default parent page in the plugin settings.");

	const root = await client.getPage(rootId);
	if (!root) fail(`Page ${rootId} was not found.`);

	const nodes = await client.descendants(rootId);
	if (args.json) {
		process.stdout.write(JSON.stringify({ root, nodes }, null, 2) + "\n");
		return;
	}
	process.stdout.write(renderTree(nodes, rootId, root.title) + "\n");
}

async function commandMkfolder(args: Args): Promise<void> {
	const data = await readPluginData();
	const title = args.positional.join(" ").trim();
	if (!title) fail("Name the folder to create.");

	const parentId = pageIdFromUrl(args.parent ?? data.settings.defaultParentPageId);
	if (!parentId) fail("Pass --parent with the page or folder the new folder belongs under.");

	const client = clientFor(data.settings);

	// Confluence requires folder titles to be unique across the space, so a
	// name taken under any other parent blocks the create just the same. Look
	// space-wide, and report where the existing one actually lives.
	const existing =
		(await client.directChildren(parentId)).find(
			(node) => node.type === "folder" && node.title === title
		) ?? (await client.findFolderByTitle(data.settings.defaultSpaceKey, title));
	if (existing) {
		process.stdout.write(
			args.json
				? JSON.stringify({ ...existing, created: false }, null, 2) + "\n"
				: `exists  ${existing.title}  [${existing.id}]\n`
		);
		return;
	}

	if (args.dryRun) {
		process.stdout.write(`would create  ${title}  under [${parentId}]\n`);
		return;
	}

	const spaceId = await client.getSpaceId(data.settings.defaultSpaceKey);
	const folder = await client.createFolder({ spaceId, title, parentId });
	process.stdout.write(
		args.json
			? JSON.stringify({ ...folder, created: true }, null, 2) + "\n"
			: `created ${folder.title}  [${folder.id}]\n`
	);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (!args.command || args.command === "help" || args.command === "--help") {
		process.stdout.write(USAGE);
		return;
	}

	switch (args.command) {
		case "push":
			return commandPush(args);
		case "move":
			return commandMove(args);
		case "status":
			return commandStatus(args);
		case "pull":
			return commandPull(args);
		case "preview":
			return commandPreview(args);
		case "tree":
			return commandTree(args);
		case "mkfolder":
			return commandMkfolder(args);
		default:
			fail(`Unknown command "${args.command}".\n\n${USAGE}`);
	}
}

main().catch((err: Error) => fail(err.message));
