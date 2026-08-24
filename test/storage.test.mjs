import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import esbuild from "esbuild";

let StorageConverter;
let workDir;

before(async () => {
	// Checked up front so a missing binary reports itself, rather than surfacing
	// as every converter case producing "malformed XML".
	try {
		execFileSync("xmllint", ["--version"], { stdio: "pipe" });
	} catch (err) {
		throw new Error(
			"xmllint is required by these tests and was not found on PATH. " +
				"Install it with `brew install libxml2` or `apt-get install libxml2-utils`.\n" +
				String(err.message ?? err)
		);
	}

	workDir = mkdtempSync(join(tmpdir(), "confluence-push-test-"));
	const outfile = join(workDir, "storage.mjs");
	await esbuild.build({
		entryPoints: ["src/storage.ts"],
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "es2020",
		outfile,
		logLevel: "silent",
	});
	({ StorageConverter } = await import(outfile));
});

/** Vault stub: "Published Note" is on Confluence, "Draft Note" is not. */
const ctx = {
	resolveLink: (target) =>
		target === "Published Note" || target === "Strategy/Published Note"
			? "https://example.atlassian.net/wiki/spaces/DOCS/pages/123/Published+Note"
			: null,
	resolveAttachment: (target) =>
		/\.(png|jpg|pdf)$/i.test(target)
			? { filename: target.split("/").pop(), vaultPath: `assets/${target}` }
			: null,
};

const convert = (md, opts) => new StorageConverter(ctx).convert(md, opts);

/**
 * Confluence parses storage format as XML, so every case must be well-formed
 * once the ac/ri namespaces are declared.
 */
function assertWellFormed(storage, label) {
	const file = join(workDir, `frag-${Math.random().toString(36).slice(2)}.xml`);
	writeFileSync(
		file,
		`<?xml version="1.0"?>\n<root xmlns:ac="http://atlassian.com/content" ` +
			`xmlns:ri="http://atlassian.com/resource/identifier">${storage}</root>`
	);
	try {
		execFileSync("xmllint", ["--noout", file], { stdio: "pipe" });
	} catch (err) {
		// A failure to launch xmllint says nothing about the markup.
		if (err.code === "ENOENT") throw err;
		assert.fail(
			`${label} produced malformed XML:\n${err.stderr?.toString() ?? err.message}\n\n${storage}`
		);
	}
}

describe("frontmatter and comments", () => {
	test("strips YAML frontmatter", () => {
		const { storage } = convert("---\ntitle: Foo\ntags: [a, b]\n---\n\nBody text.");
		assert.equal(storage, "<p>Body text.</p>");
	});

	test("strips %% comments but keeps them inside code fences", () => {
		const { storage } = convert("Before %%hidden%% after.\n\n```\nkeep %%this%%\n```");
		assert.match(storage, /<p>Before\s+after\.<\/p>/);
		assert.match(storage, /keep %%this%%/);
	});

	test("strips multi-line comments", () => {
		const { storage } = convert("A\n\n%%\nnote to self\nmore\n%%\n\nB");
		assert.match(storage, /<p>A<\/p>/);
		assert.match(storage, /<p>B<\/p>/);
		assert.doesNotMatch(storage, /note to self/);
	});
});

describe("escaping", () => {
	test("escapes XML-significant characters in text", () => {
		const { storage } = convert("Tom & Jerry < 5 > 3");
		assert.equal(storage, "<p>Tom &amp; Jerry &lt; 5 &gt; 3</p>");
	});

	test("escapes inside code spans and attributes", () => {
		const { storage } = convert('`a && b` and [x](https://e.com/?a=1&b="2")');
		assert.match(storage, /<code>a &amp;&amp; b<\/code>/);
		assert.match(storage, /href="https:\/\/e\.com\/\?a=1&amp;b=&quot;2&quot;"/);
		assertWellFormed(storage, "escaping");
	});

	test("escapes raw HTML rather than passing it through", () => {
		const { storage, warnings } = convert("Text <div class='x'>unclosed");
		assert.match(storage, /&lt;div/);
		assert.ok(warnings.some((w) => /Raw HTML/.test(w)));
		assertWellFormed(storage, "raw html");
	});

	test("escapes each character exactly once", () => {
		const { storage } = convert("A &amp; B and C & D");
		assert.equal(storage, "<p>A &amp; B and C &amp; D</p>");
		assert.doesNotMatch(storage, /&amp;amp;/);
	});

	test("converts entities XML does not define into literal characters", () => {
		// A bare &nbsp; in storage format is an undefined-entity parse error.
		const { storage } = convert("spaced&nbsp;out and 50&deg; &hellip; &#8212; &#x2192;");
		assert.doesNotMatch(storage, /&(?!amp;|lt;|gt;|quot;|#39;)/);
		assert.match(storage, /50°/);
		assert.match(storage, /…/);
		assert.match(storage, /—/);
		assert.match(storage, /→/);
		assertWellFormed(storage, "entities");
	});

	test("leaves an unknown entity as safe visible text", () => {
		const { storage } = convert("a &notreal; b");
		assert.match(storage, /&amp;notreal;/);
		assertWellFormed(storage, "unknown entity");
	});

	test("allows safe inline HTML through as XHTML", () => {
		const { storage } = convert("line one<br>line two");
		assert.match(storage, /<br \/>/);
		assertWellFormed(storage, "br");
	});
});

describe("blocks", () => {
	test("renders headings and paragraphs", () => {
		const { storage } = convert("## Section\n\nSome text.");
		assert.equal(storage, "<h2>Section</h2><p>Some text.</p>");
	});

	test("renders a code block with a mapped language", () => {
		const { storage } = convert("```typescript\nconst a = 1;\n```");
		assert.match(storage, /ac:name="code"/);
		assert.match(storage, /<ac:parameter ac:name="language">js<\/ac:parameter>/);
		assert.match(storage, /<!\[CDATA\[const a = 1;\]\]>/);
		assertWellFormed(storage, "code block");
	});

	test("omits the language parameter for unknown fences", () => {
		const { storage } = convert("```dataview\nTABLE file\n```");
		assert.doesNotMatch(storage, /ac:name="language"/);
		assertWellFormed(storage, "unknown fence");
	});

	test("splits a CDATA terminator appearing in code", () => {
		const { storage } = convert("```\nvar x = a]]>b;\n```");
		assert.doesNotMatch(storage, /\[CDATA\[[^]*?\]\]>[^]*?\]\]>[^]*?\]\]><\/ac:plain/);
		assertWellFormed(storage, "cdata terminator");
	});

	test("renders a table with alignment and header cells", () => {
		const md = "| Metric | Value |\n|:---|---:|\n| MAU | 3,455 |";
		const { storage } = convert(md);
		assert.match(storage, /<th style="text-align: left;"><p>Metric<\/p><\/th>/);
		assert.match(storage, /<th style="text-align: right;"><p>Value<\/p><\/th>/);
		assert.match(storage, /<td style="text-align: left;"><p>MAU<\/p><\/td>/);
		assertWellFormed(storage, "table");
		assert.doesNotMatch(storage, /data-layout/);
	});

	test("gives four-column and wider tables a full-width layout", () => {
		const md = "| A | B | C | D |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |";
		const { storage } = convert(md);
		assert.match(storage, /<table data-layout="full-width"><tbody>/);
		assertWellFormed(storage, "wide table");
	});

	test("renders nested lists", () => {
		const { storage } = convert("- one\n  - nested\n- two");
		assert.match(storage, /<ul><li>one<ul><li>nested<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
		assertWellFormed(storage, "nested list");
	});

	test("renders ordered lists with a custom start", () => {
		const { storage } = convert("3. three\n4. four");
		assert.match(storage, /<ol start="3">/);
		assertWellFormed(storage, "ordered list");
	});

	test("renders checkboxes as Confluence tasks", () => {
		const { storage } = convert("- [ ] open item\n- [x] done item");
		assert.match(storage, /<ac:task-list>/);
		assert.match(storage, /<ac:task-status>incomplete<\/ac:task-status>/);
		assert.match(storage, /<ac:task-status>complete<\/ac:task-status>/);
		assertWellFormed(storage, "task list");
	});

	test("keeps tasks and plain items distinct in a mixed list", () => {
		const { storage } = convert("- [ ] task\n- plain bullet");
		assert.match(storage, /<ac:task-list>[\s\S]*<\/ac:task-list><ul><li>plain bullet<\/li><\/ul>/);
		assertWellFormed(storage, "mixed list");
	});

	test("renders a plain blockquote", () => {
		const { storage } = convert("> quoted line");
		assert.match(storage, /<blockquote><p>quoted line<\/p><\/blockquote>/);
	});
});

describe("callouts", () => {
	test("maps a titled callout to the matching macro", () => {
		const { storage } = convert("> [!warning] Heads up\n> Body line.");
		assert.match(storage, /ac:name="note"/);
		assert.match(storage, /<ac:parameter ac:name="title">Heads up<\/ac:parameter>/);
		assert.match(storage, /<ac:rich-text-body><p>Body line\.<\/p><\/ac:rich-text-body>/);
		assertWellFormed(storage, "callout");
	});

	test("maps danger to the red warning macro", () => {
		const { storage } = convert("> [!danger]\n> Broken.");
		assert.match(storage, /ac:name="warning"/);
		assert.doesNotMatch(storage, /ac:name="title"/);
	});

	test("renders markdown inside a callout body", () => {
		const { storage } = convert("> [!info] Notes\n> - one\n> - two");
		assert.match(storage, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
		assertWellFormed(storage, "callout with list");
	});

	test("falls back to info for an unknown callout type", () => {
		const { storage } = convert("> [!custom-thing] T\n> body");
		assert.match(storage, /ac:name="info"/);
	});
});

describe("links, embeds and images", () => {
	test("links a published wikilink and flattens an unpublished one", () => {
		const { storage, warnings } = convert("See [[Published Note]] and [[Draft Note]].");
		assert.match(storage, /<a href="https:\/\/example\.atlassian\.net[^"]*">Published Note<\/a>/);
		assert.match(storage, /and Draft Note\./);
		assert.doesNotMatch(storage, /\[\[/);
		assert.ok(warnings.some((w) => /Draft Note/.test(w)));
	});

	test("uses the alias as link text", () => {
		const { storage } = convert("[[Published Note|the strategy doc]]");
		assert.match(storage, /">the strategy doc<\/a>/);
	});

	test("carries a heading anchor onto the resolved link", () => {
		const { storage } = convert("[[Published Note#Results|results]]");
		assert.match(storage, /pages\/123\/Published\+Note#Results">results<\/a>/);
	});

	test("registers an embedded image as an attachment", () => {
		const { storage, attachments } = convert("![[chart.png]]");
		assert.match(storage, /<ac:image><ri:attachment ri:filename="chart\.png" \/><\/ac:image>/);
		assert.deepEqual(attachments, [{ filename: "chart.png", vaultPath: "assets/chart.png" }]);
		assertWellFormed(storage, "embed");
	});

	test("applies an embed width", () => {
		const { storage } = convert("![[chart.png|400]]");
		assert.match(storage, /ac:width="400"/);
	});

	test("renders an external image by URL", () => {
		const { storage, attachments } = convert("![alt text](https://example.com/a.png)");
		assert.match(storage, /<ri:url ri:value="https:\/\/example\.com\/a\.png" \/>/);
		assert.match(storage, /ac:alt="alt text"/);
		assert.equal(attachments.length, 0);
	});

	test("renders a non-image embed as an attachment link", () => {
		const { storage, attachments } = convert("![[report.pdf]]");
		assert.match(storage, /<ac:link><ri:attachment ri:filename="report\.pdf" \/>/);
		assert.equal(attachments.length, 1);
		assertWellFormed(storage, "file embed");
	});

	test("de-duplicates repeated attachments", () => {
		const { attachments } = convert("![[chart.png]]\n\n![[chart.png]]");
		assert.equal(attachments.length, 1);
	});

	test("links a note embed instead of dropping it", () => {
		const { storage } = convert("![[Published Note]]");
		assert.match(storage, /<a href="https:\/\/example\.atlassian\.net[^"]*">Published Note<\/a>/);
	});
});

describe("inline formatting", () => {
	test("renders emphasis, strong, strikethrough and highlight", () => {
		const { storage } = convert("*a* **b** ~~c~~ ==d==");
		assert.match(storage, /<em>a<\/em>/);
		assert.match(storage, /<strong>b<\/strong>/);
		assert.match(storage, /<s>c<\/s>/);
		assert.match(storage, /<span style="background-color: rgb\(254,222,200\);">d<\/span>/);
		assertWellFormed(storage, "inline formatting");
	});

	test("does not treat an equals sign in prose as a highlight", () => {
		const { storage } = convert("Set a = b and c = d here.");
		assert.doesNotMatch(storage, /background-color/);
	});
});

describe("title handling", () => {
	test("drops a leading H1 matching the page title", () => {
		const { storage } = convert("# My Doc\n\nBody.", { skipFirstHeading: "My Doc" });
		assert.equal(storage, "<p>Body.</p>");
	});

	test("keeps a leading H1 that differs from the title", () => {
		const { storage } = convert("# Other\n\nBody.", { skipFirstHeading: "My Doc" });
		assert.match(storage, /<h1>Other<\/h1>/);
	});

	test("keeps the H1 when no title is supplied", () => {
		const { storage } = convert("# My Doc\n\nBody.");
		assert.match(storage, /<h1>My Doc<\/h1>/);
	});
});

describe("document-level wellformedness", () => {
	test("a representative vault note converts to valid XML", () => {
		const md = [
			"---",
			'title: "Q3 Metrics"',
			"tags: [metrics, reference]",
			"---",
			"",
			"# Q3 Metrics",
			"",
			"Summary with a [[Published Note]] link & an <unclosed tag.",
			"",
			"> [!warning] Watch out",
			"> Churn is at 2.07%.",
			"",
			"| Metric | Jun | Jul |",
			"|---|---:|---:|",
			"| MAU | 3,455 | 4,001 |",
			"",
			"## Actions",
			"",
			"- [x] Pull the roll-forward",
			"- [ ] Check the OKR baseline",
			"",
			"```sql",
			"SELECT * FROM units WHERE qty > 5 AND kind < 'z';",
			"```",
			"",
			"![[chart.png|500]]",
			"",
			"Footnote ==highlighted== and `code & stuff`.",
		].join("\n");

		const { storage, attachments } = convert(md, { skipFirstHeading: "Q3 Metrics" });
		assertWellFormed(storage, "full document");
		assert.equal(attachments.length, 1);
		assert.doesNotMatch(storage, /<h1>Q3 Metrics<\/h1>/);
		assert.match(storage, /link &amp; an &lt;unclosed tag\./);
		assert.match(storage, /ac:name="note"/);
		assert.match(storage, /<ac:task-status>complete<\/ac:task-status>/);
		assert.match(storage, /ac:width="500"/);
	});

	test("pathological input stays well-formed", () => {
		const cases = [
			"<<<>>> & &amp; &nbsp;",
			"| broken | table\n|---|\n| a |",
			"- [ ] task with **bold** and [[Draft Note]]",
			"> [!info]\n> > nested quote\n> > more",
			"```\n<div>&amp;</div>\n```",
			"![](https://x.com/a.png)",
			"[[]]",
			"==",
			"%%",
			"| a | b |\n|---|---|\n| `x&y` | <b>z</b> |",
		];
		for (const md of cases) {
			const { storage } = convert(md);
			assertWellFormed(storage, JSON.stringify(md));
		}
	});
});
