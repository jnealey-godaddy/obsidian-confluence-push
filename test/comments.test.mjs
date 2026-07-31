import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import esbuild from "esbuild";

let extractAnchors, reanchorComments, stripMarkers;

before(async () => {
	const outfile = join(mkdtempSync(join(tmpdir(), "confluence-push-comments-")), "comments.mjs");
	await esbuild.build({
		entryPoints: ["src/comments.ts"],
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "es2020",
		outfile,
		logLevel: "silent",
	});
	({ extractAnchors, reanchorComments, stripMarkers } = await import(outfile));
});

const marker = (ref, text) =>
	`<ac:inline-comment-marker ac:ref="${ref}">${text}</ac:inline-comment-marker>`;

describe("reading anchors off a live page", () => {
	test("finds a storage-format marker", () => {
		const [anchor] = extractAnchors(`<p>How many sites use ${marker("abc", "Postgres")}?</p>`);
		assert.equal(anchor.markerRef, "abc");
		assert.equal(anchor.selection, "Postgres");
		assert.equal(anchor.blockText, "How many sites use Postgres?");
		assert.equal(anchor.occurrence, 0);
	});

	test("finds a live-doc annotation span", () => {
		// The shape the API actually returned for page 4540040073.
		const body =
			'<p>How many sites created in the last 30 days use <span class="annotation" ' +
			'data-annotation-id="55c127c5-2740-404b-a1c6-88490c56f371" ' +
			'data-annotation-type="inlineComment">Postgres</span>?</p>';
		const [anchor] = extractAnchors(body);
		assert.equal(anchor.markerRef, "55c127c5-2740-404b-a1c6-88490c56f371");
		assert.equal(anchor.selection, "Postgres");
	});

	test("ignores annotation spans that are not comments", () => {
		const body = '<p>See <span class="annotation" data-annotation-id="x" ' + 'data-annotation-type="highlight">this</span>.</p>';
		assert.deepEqual(extractAnchors(body), []);
	});

	test("records which occurrence within the block was marked", () => {
		const body = `<p>Postgres beats Postgres when ${marker("abc", "Postgres")} wins.</p>`;
		assert.equal(extractAnchors(body)[0].occurrence, 2);
	});

	test("distinguishes identical blocks by position", () => {
		const body = `<p>Same text.</p><p>Same ${marker("abc", "text")}.</p>`;
		const [anchor] = extractAnchors(body);
		assert.equal(anchor.blockText, "Same text.");
		assert.equal(anchor.blockIndex, 1);
	});

	test("strips markers back out", () => {
		assert.equal(stripMarkers(`<p>a ${marker("r", "b")} c</p>`), "<p>a b c</p>");
	});
});

describe("carrying anchors onto new content", () => {
	test("re-anchors when the block is unchanged", () => {
		const anchors = extractAnchors(`<p>Sites using ${marker("abc", "Postgres")} grew.</p>`);
		const result = reanchorComments("<p>Sites using Postgres grew.</p>", anchors);

		assert.equal(result.reanchored.length, 1);
		assert.deepEqual(result.lost, []);
		assert.equal(result.storage, `<p>Sites using ${marker("abc", "Postgres")} grew.</p>`);
	});

	test("picks the right occurrence out of many", () => {
		// The real failure mode: "Postgres" appears throughout the document, so
		// matching on the word alone would anchor the comment to the wrong one.
		const old =
			"<p>Postgres is popular.</p>" +
			`<p>New sites reach for ${marker("abc", "Postgres")} less often.</p>` +
			"<p>Postgres sits on 34%.</p>";
		const fresh =
			"<p>Postgres is popular.</p>" +
			"<p>New sites reach for Postgres less often.</p>" +
			"<p>Postgres sits on 34%.</p>";

		const result = reanchorComments(fresh, extractAnchors(old));
		assert.equal(result.reanchored.length, 1);
		assert.match(result.storage, /reach for <ac:inline-comment-marker ac:ref="abc">Postgres<\/ac/);
		// Exactly one of the three occurrences is wrapped.
		assert.equal(result.storage.split('ac:ref="abc"').length - 1, 1);
		assert.match(result.storage, /^<p>Postgres is popular\.<\/p>/);
		assert.match(result.storage, /<p>Postgres sits on 34%\.<\/p>$/);
	});

	test("reports a comment whose text was edited away", () => {
		const anchors = extractAnchors(`<p>The old ${marker("abc", "wording")} here.</p>`);
		const result = reanchorComments("<p>Completely rewritten.</p>", anchors);

		assert.deepEqual(result.reanchored, []);
		assert.equal(result.lost.length, 1);
		assert.equal(result.lost[0].selection, "wording");
		assert.equal(result.storage, "<p>Completely rewritten.</p>");
	});

	test("keeps other anchors when one is lost", () => {
		const old =
			`<p>Kept ${marker("keep", "here")}.</p>` + `<p>Gone ${marker("drop", "there")}.</p>`;
		const result = reanchorComments("<p>Kept here.</p><p>Rewritten.</p>", extractAnchors(old));

		assert.deepEqual(result.reanchored.map((a) => a.markerRef), ["keep"]);
		assert.deepEqual(result.lost.map((a) => a.markerRef), ["drop"]);
	});

	test("refuses to wrap a selection that spans tags", () => {
		// Splitting an element would produce markup Confluence rejects outright.
		const anchors = [
			{ markerRef: "abc", selection: "bold text", blockText: "A bold text run.", blockIndex: 0, occurrence: 0 },
		];
		const result = reanchorComments("<p>A <strong>bold</strong> text run.</p>", anchors);
		assert.equal(result.lost.length, 1);
		assert.ok(!result.storage.includes("inline-comment-marker"));
	});

	test("survives a round trip through table cells and list items", () => {
		const old =
			`<table><tbody><tr><td><p>Installed ${marker("t", "Postgres core")}</p></td></tr></tbody></table>` +
			`<ul><li><p>What is the ${marker("l", "true count")}?</p></li></ul>`;
		const fresh =
			"<table><tbody><tr><td><p>Installed Postgres core</p></td></tr></tbody></table>" +
			"<ul><li><p>What is the true count?</p></li></ul>";

		const result = reanchorComments(fresh, extractAnchors(old));
		assert.equal(result.reanchored.length, 2);
		assert.deepEqual(result.lost, []);
	});

	test("matches through entities rather than tripping over them", () => {
		const anchors = extractAnchors(`<p>Cost &amp; ${marker("abc", "margin")} detail.</p>`);
		const result = reanchorComments("<p>Cost &amp; margin detail.</p>", anchors);
		assert.equal(result.reanchored.length, 1);
		assert.match(result.storage, /Cost &amp; <ac:inline-comment-marker/);
	});

	test("re-anchoring twice is stable", () => {
		const first = reanchorComments(
			"<p>Stable text.</p>",
			extractAnchors(`<p>Stable ${marker("abc", "text")}.</p>`)
		);
		const second = reanchorComments("<p>Stable text.</p>", extractAnchors(first.storage));
		assert.equal(second.storage, first.storage);
	});
});
