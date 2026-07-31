/**
 * Bringing a Confluence page back for review.
 *
 * This is deliberately not the other half of a two-way sync. The pulled content
 * is what Confluence renders, not the Markdown that was pushed: links come back
 * absolute, callouts as panels, wikilinks resolved, and frontmatter gone. Written
 * straight over a note it would churn formatting nobody changed and bury the one
 * paragraph a colleague actually edited.
 *
 * So a pull writes a separate review copy beside the note and never touches the
 * note itself. Deciding what to carry across stays a human judgement.
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
	| "drifted";

export interface PullOutcome {
	notePath: string;
	state: PullState;
	pageId: string | null;
	remoteVersion: number | null;
	lastPushedVersion: number | null;
	/** Vault path of the review copy, when one was written. */
	sidecarPath: string | null;
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
export function shouldWriteSidecar(state: PullState, opts: { sweeping: boolean }): boolean {
	if (state === "drifted") return true;
	if (state === "untracked") return !opts.sweeping;
	return false;
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
