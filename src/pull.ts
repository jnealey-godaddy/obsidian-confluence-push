/**
 * Bringing a Confluence page back for review.
 *
 * This is deliberately not the other half of a two-way sync. The pulled content
 * is what Confluence renders, not the Markdown that was pushed: links come back
 * absolute, callouts as panels, wikilinks resolved, and frontmatter gone. Written
 * straight over a note it would churn formatting nobody changed and bury the one
 * paragraph a colleague actually edited.
 *
 * So by default a pull writes a separate review copy beside the note and leaves
 * the note alone. Deciding what to carry across stays a human judgement.
 *
 * `--in-place` is the deliberate exception, for when you have already decided the
 * Confluence version wins. It replaces the note's body and keeps its frontmatter,
 * because that block holds the `confluence` property binding the note to its page:
 * dropped, the note would quietly unpublish itself on the way past.
 */

import { RemoteMarkdown } from "./confluence";

export type PullState =
	/** No page is bound to the note. */
	| "not published"
	/** The bound page is gone from Confluence. */
	| "missing"
	/** Bound by frontmatter only, so there is no version to compare against. */
	| "untracked"
	/** The page is at the version this vault last pushed. */
	| "in sync"
	/** Someone changed the page after the last push. */
	| "drifted"
	/** The note could not be read or its page could not be reached. */
	| "failed";

export interface PullOutcome {
	notePath: string;
	state: PullState;
	pageId: string | null;
	remoteVersion: number | null;
	lastPushedVersion: number | null;
	/** Vault path of the review copy, when one was written. */
	sidecarPath: string | null;
	/** Whether the remote body was written over the note itself. */
	inPlace: boolean;
	/** Why this note could not be pulled, when it could not be. */
	error: string | null;
	url: string | null;
}

/** Suffix that marks a file as a pulled review copy rather than a real note. */
export const SIDECAR_SUFFIX = ".confluence.md";

export function isSidecarPath(notePath: string): boolean {
	return notePath.toLowerCase().endsWith(SIDECAR_SUFFIX);
}

/** Where the review copy for a note lives. */
export function sidecarPathFor(notePath: string): string {
	return notePath.replace(/\.md$/i, "") + SIDECAR_SUFFIX;
}

function yamlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The review copy's contents.
 *
 * It carries no `confluence` property on purpose. That property is what marks a
 * note as published, so putting one here would make the review copy look like a
 * note of its own and expose it to the next `push --all`.
 */
export function sidecarContents(args: {
	remote: RemoteMarkdown;
	notePath: string;
	url: string;
	lastPushedVersion: number | null;
	pulledAt: string;
}): string {
	const { remote, notePath, url, lastPushedVersion, pulledAt } = args;
	const since =
		lastPushedVersion === null
			? "This vault has no record of publishing the page, so there is nothing to compare against."
			: lastPushedVersion === remote.version
				? `The page is still at version ${remote.version}, the one this vault last pushed, so nobody has edited it since.`
				: `Version ${lastPushedVersion} was the last one pushed from this vault. Confluence is now at ${remote.version}.`;

	return [
		"---",
		`title: ${yamlString(`${remote.title} (Confluence copy)`)}`,
		`date: ${pulledAt.slice(0, 10)}`,
		"type: reference",
		"tags: [confluence-pull]",
		"status: draft",
		`summary: ${yamlString(
			`Read-only copy of the Confluence version of ${notePath}, pulled ${pulledAt.slice(0, 10)}. ` +
				"Kept for review only. The note is the source of truth."
		)}`,
		"keywords: [confluence, review copy, drift]",
		`related: [${yamlString(`[[${notePath.replace(/\.md$/i, "")}]]`)}]`,
		"---",
		"",
		"> [!info] Review copy, not a note",
		`> Pulled from [the Confluence page](${url}) at ${pulledAt}.`,
		`> ${since}`,
		"> Confluence rendered this Markdown itself, so formatting differs from the note even where the words match. Read it for what changed, copy across by hand, then delete this file.",
		"",
		remote.markdown.trimEnd(),
		"",
	].join("\n");
}

/**
 * Whether a page in this state has content worth writing down.
 *
 * Drift is evidence someone changed the page. Untracked only means this vault
 * has no baseline to compare against, which is the normal state for everything
 * published before the plugin existed. Asked for by name it is worth pulling,
 * but sweeping the whole vault it would bury the pages that did change under a
 * copy of every page that merely lacks a record.
 */
export function shouldPull(state: PullState, opts: { sweeping: boolean }): boolean {
	if (state === "failed") return false;
	if (state === "drifted") return true;
	if (state === "untracked") return !opts.sweeping;
	return false;
}

/**
 * Splits a note into its leading YAML block and everything after it.
 *
 * The block is returned verbatim, closing delimiter and line ending included, so
 * it can be put back exactly as it was found. Anchored at the start of the file,
 * so a `---` horizontal rule further down is body text, not a delimiter.
 *
 * A note can also *open* with a horizontal rule, which looks identical to an
 * opening delimiter until you read what follows. Prose is not a property, so the
 * block only counts as frontmatter if its first meaningful line reads like one.
 * Otherwise the rule is body text and the note has no frontmatter, which is the
 * safe reading: an in-place pull then replaces the whole body, rather than
 * preserving a paragraph it mistook for metadata.
 */
export function splitFrontmatter(contents: string): { frontmatter: string; body: string } {
	if (!contents.startsWith("---")) return { frontmatter: "", body: contents };
	const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(contents);
	if (!match) return { frontmatter: "", body: contents };

	const inner = match[0].replace(/^---\r?\n/, "").replace(/\r?\n---[ \t]*(\r?\n|$)$/, "");
	const first = inner.split(/\r?\n/).find((line) => line.trim() !== "");
	const looksLikeYaml = first !== undefined && /^\s*(#|-\s|[\w.$-]+\s*:)/.test(first);
	if (!looksLikeYaml) return { frontmatter: "", body: contents };

	return { frontmatter: match[0], body: contents.slice(match[0].length) };
}

/**
 * The note's contents once the Confluence body has been written over it.
 *
 * Deliberately carries no banner saying where the text came from or when. This
 * is a real note, and a note reads as the current state of the document, not as
 * a log of what was done to it. The pull report says what happened instead.
 */
export function inPlaceContents(args: { existing: string; remote: RemoteMarkdown }): string {
	const { frontmatter } = splitFrontmatter(args.existing);
	const body = args.remote.markdown.trimEnd() + "\n";
	return frontmatter ? `${frontmatter}\n${body}` : body;
}

export function pullState(args: {
	pageId: string | null;
	remoteExists: boolean;
	remoteVersion: number | null;
	lastPushedVersion: number | null;
}): PullState {
	if (!args.pageId) return "not published";
	if (!args.remoteExists) return "missing";
	if (args.lastPushedVersion === null) return "untracked";
	return args.lastPushedVersion === args.remoteVersion ? "in sync" : "drifted";
}
