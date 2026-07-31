import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import esbuild from "esbuild";

let pull;

before(async () => {
	const outfile = join(mkdtempSync(join(tmpdir(), "confluence-push-pull-")), "pull.mjs");
	await esbuild.build({
		entryPoints: ["src/pull.ts"],
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "es2020",
		outfile,
		logLevel: "silent",
	});
	pull = await import(outfile);
});

const remote = (overrides = {}) => ({
	title: "Q3 Metrics",
	version: 9,
	editedAt: "2026-07-31T10:00:00.000Z",
	markdown: "## Answer\n\nA colleague edited this line.",
	...overrides,
});

describe("deciding what has drifted", () => {
	const state = (args) => pull.pullState({ remoteExists: true, ...args });

	test("a note with no page is not published", () => {
		assert.equal(state({ pageId: null, remoteVersion: null, lastPushedVersion: null }), "not published");
	});

	test("a deleted page is missing", () => {
		assert.equal(
			pull.pullState({ pageId: "1", remoteExists: false, remoteVersion: null, lastPushedVersion: 3 }),
			"missing"
		);
	});

	test("no local record means the history is unknown", () => {
		assert.equal(state({ pageId: "1", remoteVersion: 9, lastPushedVersion: null }), "untracked");
	});

	test("matching versions are in sync", () => {
		assert.equal(state({ pageId: "1", remoteVersion: 4, lastPushedVersion: 4 }), "in sync");
	});

	test("a moved version has drifted", () => {
		assert.equal(state({ pageId: "1", remoteVersion: 9, lastPushedVersion: 4 }), "drifted");
	});

	test("a drifted page is always worth copying down", () => {
		assert.equal(pull.shouldWriteSidecar("drifted", { sweeping: true }), true);
		assert.equal(pull.shouldWriteSidecar("drifted", { sweeping: false }), true);
	});

	test("an untracked page is copied when asked for by name, not when sweeping", () => {
		// This vault has 119 notes published before it kept records. Sweeping
		// would bury the pages that changed under a copy of every page that
		// merely has no baseline.
		assert.equal(pull.shouldWriteSidecar("untracked", { sweeping: false }), true);
		assert.equal(pull.shouldWriteSidecar("untracked", { sweeping: true }), false);
	});

	test("nothing else is copied down", () => {
		for (const state of ["in sync", "missing", "not published"]) {
			assert.equal(pull.shouldWriteSidecar(state, { sweeping: false }), false);
			assert.equal(pull.shouldWriteSidecar(state, { sweeping: true }), false);
		}
	});
});

describe("naming the review copy", () => {
	test("sits beside the note", () => {
		assert.equal(pull.sidecarPathFor("Data & Research/Q3.md"), "Data & Research/Q3.confluence.md");
	});

	test("recognises its own output", () => {
		assert.equal(pull.isSidecarPath("Data & Research/Q3.confluence.md"), true);
		assert.equal(pull.isSidecarPath("Data & Research/Q3.md"), false);
	});

	test("round-trips, so a pull cannot pick up its own copies", () => {
		const sidecar = pull.sidecarPathFor("A/B.md");
		assert.equal(pull.isSidecarPath(sidecar), true);
	});
});

describe("review copy contents", () => {
	const build = (overrides = {}) =>
		pull.sidecarContents({
			remote: remote(),
			notePath: "Data & Research/Q3.md",
			url: "https://example.atlassian.net/wiki/spaces/DOCS/pages/900",
			lastPushedVersion: 4,
			pulledAt: "2026-07-31T12:00:00.000Z",
			...overrides,
		});

	test("carries the remote body", () => {
		assert.match(build(), /A colleague edited this line\./);
	});

	test("never claims to be the published page", () => {
		// The confluence property is what marks a note as published. A review copy
		// carrying one would be picked up by the next push --all and overwrite the
		// real page with a copy of itself.
		const out = build();
		assert.ok(!/^confluence:/m.test(out));
		assert.match(out, /^tags: \[confluence-pull\]$/m);
	});

	test("says which versions are in play", () => {
		assert.match(build(), /Version 4 was the last one pushed.*Confluence is now at 9/s);
	});

	test("says so plainly when nothing has changed", () => {
		assert.match(
			build({ remote: remote({ version: 4 }) }),
			/still at version 4.*nobody has edited it since/s
		);
	});

	test("admits when there is no baseline", () => {
		assert.match(build({ lastPushedVersion: null }), /no record of publishing/);
	});

	test("links back to the note it belongs to", () => {
		assert.match(build(), /related: \["\[\[Data & Research\/Q3\]\]"\]/);
	});

	test("escapes a title that would break the YAML", () => {
		const out = build({ remote: remote({ title: 'A "quoted" title' }) });
		assert.match(out, /title: "A \\"quoted\\" title \(Confluence copy\)"/);
	});
});
