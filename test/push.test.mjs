import { test, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import esbuild from "esbuild";

let Pusher;
let obsidian;

before(async () => {
	const dir = mkdtempSync(join(tmpdir(), "confluence-push-push-"));
	const stubPath = resolve("test/obsidian-stub.mjs");
	const entry = join(dir, "entry.mjs");
	writeFileSync(
		entry,
		`export { Pusher } from ${JSON.stringify(resolve("src/push.ts"))};\n` +
			`export * as obsidian from ${JSON.stringify(stubPath)};\n`
	);
	const outfile = join(dir, "push.mjs");
	await esbuild.build({
		entryPoints: [entry],
		bundle: true,
		format: "esm",
		platform: "neutral",
		target: "es2020",
		outfile,
		logLevel: "silent",
		alias: { obsidian: stubPath },
	});
	const mod = await import(outfile);
	Pusher = mod.Pusher;
	obsidian = mod.obsidian;
});

const SETTINGS = {
	siteUrl: "https://example.atlassian.net",
	email: "person@example.com",
	apiToken: "token",
	defaultSpaceKey: "DOCS",
	defaultParentPageId: "",
	frontmatterProperty: "confluence",
	uploadAttachments: true,
	skipDuplicateTitleHeading: true,
	warnOnRemoteEdits: true,
	skipUnchanged: true,
	preserveInlineComments: true,
	versionMessage: "Updated from Obsidian",
};

/** In-memory vault: path -> {file, content, frontmatter}. */
let vault;
let client;
let clientCalls;
let syncState;
let settings;

function addNote(path, content, frontmatter = {}) {
	const file = new obsidian.TFile(path);
	vault[path] = { file, content, frontmatter };
	return file;
}

function addBinary(path) {
	const file = new obsidian.TFile(path);
	vault[path] = { file, content: "", frontmatter: {}, binary: true };
	return file;
}

function makeApp() {
	return {
		vault: {
			cachedRead: async (file) => vault[file.path].content,
			readBinary: async () => new Uint8Array([1, 2, 3]).buffer,
			getAbstractFileByPath: (path) => vault[path]?.file ?? null,
			getMarkdownFiles: () =>
				Object.values(vault)
					.filter((e) => e.file.extension === "md")
					.map((e) => e.file),
		},
		metadataCache: {
			getFileCache: (file) => ({ frontmatter: vault[file.path]?.frontmatter ?? {} }),
			getFirstLinkpathDest: (linkpath) => {
				const direct = vault[linkpath] ?? vault[`${linkpath}.md`];
				if (direct) return direct.file;
				const hit = Object.values(vault).find(
					(e) => e.file.basename === linkpath || e.file.name === linkpath
				);
				return hit?.file ?? null;
			},
		},
		fileManager: {
			processFrontMatter: async (file, fn) => {
				fn(vault[file.path].frontmatter);
			},
		},
	};
}

function makeClient(overrides = {}) {
	clientCalls = [];
	const record = (name) => (args) => {
		clientCalls.push({ name, args });
	};
	return {
		siteUrl: "https://example.atlassian.net",
		getSpaceId: async (key) => {
			record("getSpaceId")(key);
			return "555";
		},
		getPage: async (id) => {
			record("getPage")(id);
			return overrides.getPage ? overrides.getPage(id) : null;
		},
		findPagesByTitle: async (spaceId, title) => {
			record("findPagesByTitle")({ spaceId, title });
			return overrides.findPagesByTitle ? overrides.findPagesByTitle(title) : [];
		},
		pageUrl: (spaceKey, pageId) =>
			`https://example.atlassian.net/wiki/spaces/${spaceKey}/pages/${pageId}`,
		createPage: async (args) => {
			record("createPage")(args);
			return {
				id: "900",
				title: args.title,
				spaceId: args.spaceId,
				parentId: args.parentId ?? null,
				status: "current",
				version: 1,
				webUrl: `https://example.atlassian.net/wiki/spaces/DOCS/pages/900/${encodeURIComponent(args.title)}`,
			};
		},
		updatePage: async (args) => {
			record("updatePage")(args);
			return {
				id: args.pageId,
				title: args.title,
				spaceId: "555",
				parentId: null,
				status: "current",
				version: args.nextVersion,
				webUrl: `https://example.atlassian.net/wiki/spaces/DOCS/pages/${args.pageId}/x`,
			};
		},
		uploadAttachment: async (pageId, filename) => {
			record("uploadAttachment")({ pageId, filename });
		},
		getOpenInlineComments: async (pageId) => {
			record("getOpenInlineComments")(pageId);
			return overrides.inlineComments ?? [];
		},
		getPageStorage: async (pageId) => {
			record("getPageStorage")(pageId);
			return overrides.pageStorage ?? null;
		},
		...(overrides.client ?? {}),
	};
}

function makePusher() {
	return new Pusher(makeApp(), client, settings, syncState, async () => {});
}

const callNames = () => clientCalls.map((c) => c.name);
const callArgs = (name) => clientCalls.find((c) => c.name === name)?.args;

beforeEach(() => {
	vault = {};
	syncState = {};
	settings = { ...SETTINGS };
	client = makeClient();
	obsidian.reset();
});

describe("creating a page", () => {
	test("creates, writes the URL back and records sync state", async () => {
		const file = addNote("Metrics/Q3.md", "# Q3 Metrics\n\nBody text.", { title: "Q3 Metrics" });
		const result = await makePusher().push(file);

		assert.equal(result.outcome, "created");
		assert.equal(callArgs("createPage").title, "Q3 Metrics");
		// The H1 repeating the title is dropped; Confluence renders the title itself.
		assert.equal(callArgs("createPage").storage, "<p>Body text.</p>");
		// The id is the last segment, so the /confluence skill can read it off the end.
		assert.equal(
			vault["Metrics/Q3.md"].frontmatter.confluence,
			"https://example.atlassian.net/wiki/spaces/DOCS/pages/900"
		);

		const record = syncState["Metrics/Q3.md"];
		assert.equal(record.pageId, "900");
		assert.equal(record.spaceKey, "DOCS");
		assert.equal(record.lastPushedVersion, 1);
	});

	test("keeps a leading heading that differs from the title", async () => {
		const file = addNote("b.md", "# Overview\n\nBody.", { title: "Q3 Metrics" });
		await makePusher().push(file);
		assert.equal(callArgs("createPage").storage, "<h1>Overview</h1><p>Body.</p>");
	});

	test("falls back to the filename when there is no title property", async () => {
		const file = addNote("Notes/My Note.md", "Body.");
		await makePusher().push(file);
		assert.equal(callArgs("createPage").title, "My Note");
	});

	test("uses the default parent page", async () => {
		settings.defaultParentPageId = "111";
		const file = addNote("a.md", "Body.");
		await makePusher().push(file);
		assert.equal(callArgs("createPage").parentId, "111");
	});

	test("a note-level parent overrides the default, accepting a URL", async () => {
		settings.defaultParentPageId = "111";
		const file = addNote("a.md", "Body.", {
			confluenceParent: "https://example.atlassian.net/wiki/spaces/DOCS/pages/222/Parent",
		});
		await makePusher().push(file);
		assert.equal(callArgs("createPage").parentId, "222");
	});

	test("a note-level space overrides the default", async () => {
		const file = addNote("a.md", "Body.", { confluenceSpace: "eng" });
		await makePusher().push(file);
		assert.equal(callArgs("getSpaceId"), "ENG");
		assert.equal(syncState["a.md"].spaceKey, "ENG");
	});

});

describe("adopting a page by title", () => {
	const titleMatch = (count = 1) =>
		makeClient({
			findPagesByTitle: (title) =>
				title === "Q3 Metrics"
					? Array.from({ length: count }, (_, i) => ({
							id: String(42 + i),
							title,
							spaceId: "555",
							version: 7,
							webUrl: null,
							parentId: null,
							status: "current",
						}))
					: [],
		});

	test("adopts an existing page instead of duplicating it, once confirmed", async () => {
		client = titleMatch();
		obsidian.Modal.onOpen = (modal) => modal.button("Adopt and replace").click();
		const file = addNote("a.md", "Body.", { title: "Q3 Metrics" });
		const result = await makePusher().push(file);

		assert.equal(result.outcome, "updated");
		assert.ok(!callNames().includes("createPage"));
		assert.equal(callArgs("updatePage").pageId, "42");
		assert.equal(callArgs("updatePage").nextVersion, 8);
		assert.ok(result.warnings.some((w) => /Adopted the existing/.test(w)));
	});

	test("asks before replacing a page this vault never published", async () => {
		client = titleMatch();
		obsidian.Modal.onOpen = (modal) => modal.button("Cancel").click();
		const file = addNote("a.md", "Body.", { title: "Q3 Metrics" });

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "cancelled");
		assert.ok(!callNames().includes("updatePage"));
		assert.ok(!callNames().includes("createPage"));
		assert.equal(syncState["a.md"], undefined);
	});

	test("flags an ambiguous title in the prompt", async () => {
		client = titleMatch(2);
		let lines = [];
		obsidian.Modal.onOpen = (modal) => {
			lines = modal.contentEl.children.filter((c) => c.tag === "p").map((c) => c.text);
			modal.button("Cancel").click();
		};
		const file = addNote("a.md", "Body.", { title: "Q3 Metrics" });

		await makePusher().push(file);
		assert.ok(lines.some((l) => /More than one page in this space/.test(l)));
	});

	test("force adopts without prompting", async () => {
		client = titleMatch();
		obsidian.Modal.onOpen = () => assert.fail("should not prompt when forcing");
		const file = addNote("a.md", "Body.", { title: "Q3 Metrics" });

		const result = await makePusher().push(file, { force: true });
		assert.equal(result.outcome, "updated");
		assert.equal(obsidian.Modal.opened.length, 0);
	});
});

describe("updating a page", () => {
	test("updates the page named in frontmatter and increments the version", async () => {
		client = makeClient({
			getPage: (id) => ({ id, title: "Q3", spaceId: "555", version: 4, webUrl: null, parentId: null, status: "current" }),
		});
		const file = addNote("a.md", "New body.", {
			confluence: "https://example.atlassian.net/wiki/spaces/DOCS/pages/900/Q3",
		});
		syncState["a.md"] = {
			pageId: "900",
			spaceKey: "DOCS",
			title: "Q3",
			lastPushedVersion: 4,
			lastPushedAt: "2026-01-01T00:00:00.000Z",
			contentHash: "stale",
		};

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "updated");
		assert.equal(callArgs("getPage"), "900");
		assert.equal(callArgs("updatePage").nextVersion, 5);
		assert.equal(callArgs("updatePage").storage, "<p>New body.</p>");
		assert.equal(syncState["a.md"].lastPushedVersion, 5);
	});

	test("recreates the page when it was deleted in Confluence", async () => {
		client = makeClient({ getPage: () => null });
		const file = addNote("a.md", "Body.", {
			confluence: "https://example.atlassian.net/wiki/spaces/DOCS/pages/900/Gone",
		});

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "created");
		assert.ok(result.warnings.some((w) => /no longer exists/.test(w)));
	});

	test("skips the push when nothing changed", async () => {
		client = makeClient({
			getPage: (id) => ({ id, title: "T", spaceId: "555", version: 4, webUrl: null, parentId: null, status: "current" }),
		});
		const file = addNote("a.md", "Body.", { title: "T" });
		syncState["a.md"] = {
			pageId: "900",
			spaceKey: "DOCS",
			title: "T",
			lastPushedVersion: 4,
			lastPushedAt: "2026-01-01T00:00:00.000Z",
			// FNV-1a of "T\n<p>Body.</p>", matching what the converter produces.
			contentHash: fnv("T\n<p>Body.</p>"),
		};

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "skipped");
		assert.ok(!callNames().includes("updatePage"));
	});

	test("pushes again once the content changes", async () => {
		client = makeClient({
			getPage: (id) => ({ id, title: "T", spaceId: "555", version: 4, webUrl: null, parentId: null, status: "current" }),
		});
		const file = addNote("a.md", "Changed body.", { title: "T" });
		syncState["a.md"] = {
			pageId: "900",
			spaceKey: "DOCS",
			title: "T",
			lastPushedVersion: 4,
			lastPushedAt: "2026-01-01T00:00:00.000Z",
			contentHash: fnv("T\n<p>Body.</p>"),
		};

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "updated");
	});
});

describe("conflict handling", () => {
	const remoteAheadClient = () =>
		makeClient({
			getPage: (id) => ({ id, title: "T", spaceId: "555", version: 9, webUrl: null, parentId: null, status: "current" }),
		});

	const staleRecord = () => ({
		pageId: "900",
		spaceKey: "DOCS",
		title: "T",
		lastPushedVersion: 4,
		lastPushedAt: "2026-01-01T00:00:00.000Z",
		contentHash: "stale",
	});

	test("cancelling the prompt leaves Confluence untouched", async () => {
		client = remoteAheadClient();
		obsidian.Modal.onOpen = (modal) => modal.button("Cancel").click();
		const file = addNote("a.md", "Body.", { title: "T" });
		syncState["a.md"] = staleRecord();

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "cancelled");
		assert.ok(!callNames().includes("updatePage"));
		assert.equal(syncState["a.md"].lastPushedVersion, 4);
	});

	test("dismissing the prompt is treated as cancel", async () => {
		client = remoteAheadClient();
		obsidian.Modal.onOpen = (modal) => modal.close();
		const file = addNote("a.md", "Body.", { title: "T" });
		syncState["a.md"] = staleRecord();

		assert.equal((await makePusher().push(file)).outcome, "cancelled");
		assert.ok(!callNames().includes("updatePage"));
	});

	test("choosing overwrite replaces the remote page", async () => {
		client = remoteAheadClient();
		obsidian.Modal.onOpen = (modal) => modal.button("Overwrite").click();
		const file = addNote("a.md", "Body.", { title: "T" });
		syncState["a.md"] = staleRecord();

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "updated");
		assert.equal(callArgs("updatePage").nextVersion, 10);
	});

	test("force skips the prompt entirely", async () => {
		client = remoteAheadClient();
		obsidian.Modal.onOpen = () => assert.fail("should not prompt when forcing");
		const file = addNote("a.md", "Body.", { title: "T" });
		syncState["a.md"] = staleRecord();

		const result = await makePusher().push(file, { force: true });
		assert.equal(result.outcome, "updated");
		assert.equal(obsidian.Modal.opened.length, 0);
	});

	test("no prompt when the remote version matches the last push", async () => {
		client = makeClient({
			getPage: (id) => ({ id, title: "T", spaceId: "555", version: 4, webUrl: null, parentId: null, status: "current" }),
		});
		obsidian.Modal.onOpen = () => assert.fail("should not prompt");
		const file = addNote("a.md", "Changed.", { title: "T" });
		syncState["a.md"] = staleRecord();

		assert.equal((await makePusher().push(file)).outcome, "updated");
	});

	test("prompts when frontmatter binds a page this vault never pushed", async () => {
		// The /confluence skill writes the property but no data.json record, and a
		// second machine starts with empty sync state. Neither can prove the page
		// is untouched, so neither should overwrite silently.
		client = remoteAheadClient();
		obsidian.Modal.onOpen = (modal) => modal.button("Cancel").click();
		const file = addNote("a.md", "Body.", {
			title: "T",
			confluence: "https://example.atlassian.net/wiki/spaces/DOCS/pages/900",
		});

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "cancelled");
		assert.ok(!callNames().includes("updatePage"));
		assert.equal(syncState["a.md"], undefined);
	});

	test("names the untracked page in the prompt", async () => {
		client = remoteAheadClient();
		let heading = "";
		obsidian.Modal.onOpen = (modal) => {
			heading = modal.contentEl.children.find((c) => c.tag === "h2")?.text ?? "";
			modal.button("Cancel").click();
		};
		const file = addNote("a.md", "Body.", {
			title: "T",
			confluence: "https://example.atlassian.net/wiki/spaces/DOCS/pages/900",
		});

		await makePusher().push(file);
		assert.equal(heading, "Page is not tracked by this vault");
	});

	test("overwriting an untracked page starts tracking it", async () => {
		client = remoteAheadClient();
		obsidian.Modal.onOpen = (modal) => modal.button("Overwrite").click();
		const file = addNote("a.md", "Body.", {
			title: "T",
			confluence: "https://example.atlassian.net/wiki/spaces/DOCS/pages/900",
		});

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "updated");
		assert.equal(callArgs("updatePage").nextVersion, 10);
		assert.equal(syncState["a.md"].lastPushedVersion, 10);
	});

	test("the warning can be turned off", async () => {
		client = remoteAheadClient();
		settings.warnOnRemoteEdits = false;
		obsidian.Modal.onOpen = () => assert.fail("should not prompt when disabled");
		const file = addNote("a.md", "Body.", { title: "T" });
		syncState["a.md"] = staleRecord();

		assert.equal((await makePusher().push(file)).outcome, "updated");
	});
});

describe("inline comments", () => {
	const marker = (ref, text) =>
		`<ac:inline-comment-marker ac:ref="${ref}">${text}</ac:inline-comment-marker>`;

	/** A page at the version we last pushed, carrying one open inline comment. */
	const commentedPage = (storage) =>
		makeClient({
			getPage: (id) => ({ id, title: "T", spaceId: "555", version: 4, webUrl: null, parentId: null, status: "current" }),
			inlineComments: [{ id: "c1", markerRef: "abc", originalSelection: "Postgres" }],
			pageStorage: storage,
		});

	const tracked = () => ({
		pageId: "900",
		spaceKey: "DOCS",
		title: "T",
		lastPushedVersion: 4,
		lastPushedAt: "2026-01-01T00:00:00.000Z",
		contentHash: "stale",
	});

	test("carries an anchor onto the new content when the text is unchanged", async () => {
		client = commentedPage(`<p>Sites using ${marker("abc", "Postgres")} grew.</p>`);
		const file = addNote("a.md", "Sites using Postgres grew.", { title: "T" });
		syncState["a.md"] = tracked();

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "updated");
		assert.equal(
			callArgs("updatePage").storage,
			`<p>Sites using ${marker("abc", "Postgres")} grew.</p>`
		);
		assert.ok(result.warnings.some((w) => /Carried 1 inline comment/.test(w)));
		assert.equal(obsidian.Modal.opened.length, 0);
	});

	test("prompts when a comment cannot be carried over, even at the expected version", async () => {
		// Commenting does not bump the page version, so the version check alone
		// would wave this through and strand the comment.
		client = commentedPage(`<p>Sites using ${marker("abc", "Postgres")} grew.</p>`);
		obsidian.Modal.onOpen = (modal) => modal.button("Cancel").click();
		const file = addNote("a.md", "This paragraph was rewritten entirely.", { title: "T" });
		syncState["a.md"] = tracked();

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "cancelled");
		assert.ok(!callNames().includes("updatePage"));
	});

	test("names the stranded comment in the prompt", async () => {
		client = commentedPage(`<p>Sites using ${marker("abc", "Postgres")} grew.</p>`);
		let lines = [];
		obsidian.Modal.onOpen = (modal) => {
			lines = modal.contentEl.children.filter((c) => c.tag === "p").map((c) => c.text);
			modal.button("Cancel").click();
		};
		const file = addNote("a.md", "Rewritten.", { title: "T" });
		syncState["a.md"] = tracked();

		await makePusher().push(file);
		assert.ok(lines.some((l) => /1 inline comment cannot be carried over/.test(l)));
		assert.ok(lines.some((l) => /"Postgres"/.test(l)));
	});

	test("stays quiet about a comment an earlier push already unanchored", async () => {
		// Its marker is gone from the body, so this push is not what breaks it.
		// Counting it would raise the same warning on every push from now on.
		client = commentedPage("<p>The body no longer carries that marker.</p>");
		obsidian.Modal.onOpen = () => assert.fail("should not prompt");
		const file = addNote("a.md", "Rewritten.", { title: "T" });
		syncState["a.md"] = tracked();

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "updated");
		assert.ok(!result.warnings.some((w) => /cannot be carried/.test(w)));
	});

	test("pushes without asking when the page has no open comments", async () => {
		client = makeClient({
			getPage: (id) => ({ id, title: "T", spaceId: "555", version: 4, webUrl: null, parentId: null, status: "current" }),
		});
		obsidian.Modal.onOpen = () => assert.fail("should not prompt");
		const file = addNote("a.md", "Rewritten.", { title: "T" });
		syncState["a.md"] = tracked();

		assert.equal((await makePusher().push(file)).outcome, "updated");
		// The body is only fetched when there is a comment worth moving.
		assert.ok(!callNames().includes("getPageStorage"));
	});

	test("does not look at comments when the setting is off", async () => {
		settings.preserveInlineComments = false;
		client = commentedPage(`<p>Sites using ${marker("abc", "Postgres")} grew.</p>`);
		const file = addNote("a.md", "Rewritten.", { title: "T" });
		syncState["a.md"] = tracked();

		assert.equal((await makePusher().push(file)).outcome, "updated");
		assert.ok(!callNames().includes("getOpenInlineComments"));
	});

	test("skips the comment check entirely when nothing changed", async () => {
		client = commentedPage("<p>Body.</p>");
		const file = addNote("a.md", "Body.", { title: "T" });
		syncState["a.md"] = { ...tracked(), contentHash: fnv("T\n<p>Body.</p>") };

		assert.equal((await makePusher().push(file)).outcome, "skipped");
		assert.ok(!callNames().includes("getOpenInlineComments"));
	});
});

describe("attachments", () => {
	test("uploads embedded images after the page exists", async () => {
		addBinary("assets/chart.png");
		const file = addNote("a.md", "![[chart.png]]");

		const result = await makePusher().push(file);
		assert.equal(result.attachmentsUploaded, 1);
		assert.deepEqual(callArgs("uploadAttachment"), { pageId: "900", filename: "chart.png" });
		// The page must be created before the attachment is attached to it.
		assert.ok(callNames().indexOf("createPage") < callNames().indexOf("uploadAttachment"));
	});

	test("a failed upload warns without failing the push", async () => {
		addBinary("assets/chart.png");
		client = makeClient({
			client: {
				uploadAttachment: async () => {
					throw new Error("network down");
				},
			},
		});
		const file = addNote("a.md", "![[chart.png]]");

		const result = await makePusher().push(file);
		assert.equal(result.outcome, "created");
		assert.equal(result.attachmentsUploaded, 0);
		assert.ok(result.warnings.some((w) => /chart\.png.*network down/.test(w)));
	});

	test("re-reads the page version after uploading, so the next push sees no conflict", async () => {
		addBinary("assets/chart.png");
		// Confluence may bump the page version when an attachment lands on it.
		client = makeClient({
			getPage: (id) => ({ id, title: "a", spaceId: "555", version: 2, webUrl: null, parentId: null, status: "current" }),
		});
		const file = addNote("a.md", "![[chart.png]]");

		const result = await makePusher().push(file);
		assert.equal(result.attachmentsUploaded, 1);
		// createPage reported version 1; the re-read reports 2, and 2 is recorded.
		assert.equal(syncState["a.md"].lastPushedVersion, 2);
		const names = callNames();
		assert.ok(names.indexOf("uploadAttachment") < names.lastIndexOf("getPage"));
	});

	test("does not re-read the page when nothing was uploaded", async () => {
		const file = addNote("a.md", "Body.");
		await makePusher().push(file);
		assert.ok(!callNames().includes("getPage"));
	});

	test("uploads nothing when the setting is off", async () => {
		addBinary("assets/chart.png");
		settings.uploadAttachments = false;
		const file = addNote("a.md", "![[chart.png]]");

		const result = await makePusher().push(file);
		assert.equal(result.attachmentsUploaded, 0);
		assert.ok(!callNames().includes("uploadAttachment"));
	});
});

describe("wikilink resolution", () => {
	test("links notes that are already published and flattens the rest", async () => {
		addNote("Published.md", "x", {
			confluence: "https://example.atlassian.net/wiki/spaces/DOCS/pages/321/Published",
		});
		addNote("Draft.md", "x");
		const file = addNote("a.md", "See [[Published]] and [[Draft]].");

		const result = await makePusher().push(file);
		const storage = callArgs("createPage").storage;
		assert.match(storage, /<a href="https:\/\/example\.atlassian\.net\/wiki\/spaces\/DOCS\/pages\/321\/Published">Published<\/a>/);
		assert.match(storage, /and Draft\./);
		assert.ok(result.warnings.some((w) => /Draft/.test(w)));
	});

	test("falls back to sync state when the property is missing", async () => {
		addNote("Published.md", "x");
		syncState["Published.md"] = {
			pageId: "321",
			spaceKey: "DOCS",
			title: "Published",
			lastPushedVersion: 1,
			lastPushedAt: "2026-01-01T00:00:00.000Z",
			contentHash: "x",
		};
		const file = addNote("a.md", "See [[Published]].");

		await makePusher().push(file);
		assert.match(
			callArgs("createPage").storage,
			/<a href="https:\/\/example\.atlassian\.net\/wiki\/spaces\/DOCS\/pages\/321">Published<\/a>/
		);
	});
});

describe("validation", () => {
	test("refuses to push without credentials", async () => {
		settings.apiToken = "";
		const file = addNote("a.md", "Body.");
		await assert.rejects(() => makePusher().push(file), /credentials are not configured/);
	});

	test("refuses to push without a space", async () => {
		settings.defaultSpaceKey = "";
		const file = addNote("a.md", "Body.");
		await assert.rejects(() => makePusher().push(file), /No space for "a"/);
	});

	test("refuses to push an empty note", async () => {
		const file = addNote("a.md", "---\ntitle: Empty\n---\n");
		await assert.rejects(() => makePusher().push(file), /no content to publish/);
	});
});

/** Mirrors the hash in src/push.ts so expected sync records can be built. */
function fnv(input) {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}
