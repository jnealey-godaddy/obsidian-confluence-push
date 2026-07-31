import { test, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import esbuild from "esbuild";

let ConfluenceClient;
let pageIdFromUrl;
let stub;

before(async () => {
	const dir = mkdtempSync(join(tmpdir(), "confluence-push-client-"));
	const stubPath = resolve("test/obsidian-stub.mjs");

	// The stub is aliased in place of the obsidian module and re-exported from
	// the same bundle, so the client and the assertions share one instance of
	// the call log. Marking it external instead would give the test a
	// second, unrelated copy.
	const entry = join(dir, "entry.mjs");
	writeFileSync(
		entry,
		`export { ConfluenceClient, pageIdFromUrl } from ${JSON.stringify(resolve("src/confluence.ts"))};\n` +
			`export { calls, queue, reset } from ${JSON.stringify(stubPath)};\n`
	);

	const outfile = join(dir, "confluence.mjs");
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
	({ ConfluenceClient, pageIdFromUrl } = mod);
	stub = mod;
});

const creds = {
	siteUrl: "https://example.atlassian.net",
	email: "person@example.com",
	apiToken: "token-123",
};

let client;
beforeEach(() => {
	stub.reset();
	client = new ConfluenceClient(creds);
});

describe("pageIdFromUrl", () => {
	test("reads the id from every Confluence URL shape", () => {
		assert.equal(
			pageIdFromUrl("https://x.atlassian.net/wiki/spaces/DOCS/pages/123456/Some+Title"),
			"123456"
		);
		assert.equal(pageIdFromUrl("https://x.atlassian.net/wiki/spaces/DOCS/pages/789"), "789");
		assert.equal(
			pageIdFromUrl("https://x.atlassian.net/wiki/pages/viewpage.action?pageId=4242"),
			"4242"
		);
		assert.equal(pageIdFromUrl("998877"), "998877");
		assert.equal(pageIdFromUrl("https://example.com/not-a-page"), null);
		assert.equal(pageIdFromUrl(""), null);
	});
});

describe("authentication", () => {
	test("sends Basic auth built from email and token", async () => {
		stub.queue.push({ json: { displayName: "Test Person" } });
		const who = await client.verifyCredentials();
		assert.equal(who, "Test Person");

		const [call] = stub.calls;
		const expected = "Basic " + Buffer.from("person@example.com:token-123").toString("base64");
		assert.equal(call.headers.Authorization, expected);
		assert.equal(call.url, "https://example.atlassian.net/wiki/rest/api/user/current");
	});

	test("reports a clear message on 401", async () => {
		stub.queue.push({ status: 401, json: { message: "Unauthorized" } });
		await assert.rejects(() => client.verifyCredentials(), /Authentication failed \(401\)/);
	});

	test("reports a clear message on 403", async () => {
		stub.queue.push({ status: 403, json: {} });
		await assert.rejects(() => client.verifyCredentials(), /Permission denied \(403\)/);
	});

	test("surfaces the Confluence error detail on other failures", async () => {
		stub.queue.push({
			status: 400,
			json: { errors: [{ title: "Invalid body", detail: "unexpected element" }] },
		});
		await assert.rejects(() => client.verifyCredentials(), /Invalid body: unexpected element/);
	});
});

describe("space lookup", () => {
	test("queries v2 spaces by key and caches the id", async () => {
		stub.queue.push({ json: { results: [{ id: "555" }] } });
		assert.equal(await client.getSpaceId("DOCS"), "555");
		assert.equal(
			stub.calls[0].url,
			"https://example.atlassian.net/wiki/api/v2/spaces?keys=DOCS&limit=1"
		);

		// Second call must not hit the network again.
		assert.equal(await client.getSpaceId("DOCS"), "555");
		assert.equal(stub.calls.length, 1);
	});

	test("fails clearly when the space does not exist", async () => {
		stub.queue.push({ json: { results: [] } });
		await assert.rejects(() => client.getSpaceId("NOPE"), /Space "NOPE" was not found/);
	});
});

describe("page create and update", () => {
	test("posts the documented v2 create body", async () => {
		stub.queue.push({
			json: {
				id: "900",
				title: "New Page",
				spaceId: "555",
				status: "current",
				version: { number: 1 },
				_links: { webui: "/spaces/DOCS/pages/900/New+Page" },
			},
		});

		const page = await client.createPage({
			spaceId: "555",
			title: "New Page",
			storage: "<p>hi</p>",
			parentId: "111",
		});

		const [call] = stub.calls;
		assert.equal(call.method, "POST");
		assert.equal(call.url, "https://example.atlassian.net/wiki/api/v2/pages");
		assert.deepEqual(JSON.parse(call.body), {
			spaceId: "555",
			status: "current",
			title: "New Page",
			parentId: "111",
			body: { representation: "storage", value: "<p>hi</p>" },
		});
		assert.equal(page.id, "900");
		assert.equal(page.version, 1);
		assert.equal(
			page.webUrl,
			"https://example.atlassian.net/wiki/spaces/DOCS/pages/900/New+Page"
		);
	});

	test("omits parentId when none is given", async () => {
		stub.queue.push({ json: { id: "1", title: "t", version: { number: 1 } } });
		await client.createPage({ spaceId: "555", title: "t", storage: "<p/>" });
		assert.ok(!("parentId" in JSON.parse(stub.calls[0].body)));
	});

	test("puts the documented v2 update body with an incremented version", async () => {
		stub.queue.push({
			json: { id: "900", title: "Edited", spaceId: "555", version: { number: 8 } },
		});

		await client.updatePage({
			pageId: "900",
			title: "Edited",
			storage: "<p>new</p>",
			nextVersion: 8,
			message: "Updated from Obsidian",
		});

		const [call] = stub.calls;
		assert.equal(call.method, "PUT");
		assert.equal(call.url, "https://example.atlassian.net/wiki/api/v2/pages/900");
		assert.deepEqual(JSON.parse(call.body), {
			id: "900",
			status: "current",
			title: "Edited",
			body: { representation: "storage", value: "<p>new</p>" },
			version: { number: 8, message: "Updated from Obsidian", minorEdit: false },
		});
	});

	test("returns null for a page that no longer exists", async () => {
		stub.queue.push({ status: 404, json: { errors: [{ title: "Not Found" }] } });
		assert.equal(await client.getPage("123"), null);
	});

	test("finds pages by title within a space", async () => {
		stub.queue.push({ json: { results: [{ id: "42", title: "Q3 Metrics", version: { number: 3 } }] } });
		const pages = await client.findPagesByTitle("555", "Q3 Metrics");
		assert.equal(pages.length, 1);
		assert.equal(pages[0].id, "42");
		assert.equal(pages[0].version, 3);
		assert.match(stub.calls[0].url, /\/wiki\/api\/v2\/pages\?space-id=555&title=Q3%20Metrics/);
		assert.match(stub.calls[0].url, /status=current/);
	});

	test("returns every match so an ambiguous title can be detected", async () => {
		stub.queue.push({
			json: { results: [{ id: "42", title: "T" }, { id: "43", title: "T" }] },
		});
		const pages = await client.findPagesByTitle("555", "T");
		assert.deepEqual(pages.map((p) => p.id), ["42", "43"]);
		assert.match(stub.calls[0].url, /limit=2/);
	});

	test("returns an empty list when no page has that title", async () => {
		stub.queue.push({ json: { results: [] } });
		assert.deepEqual(await client.findPagesByTitle("555", "Nothing"), []);
	});

	test("builds a page URL with the id as the last segment", () => {
		// The /confluence skill reads the page id off the end of this URL.
		assert.equal(
			client.pageUrl("DOCS", "900"),
			"https://example.atlassian.net/wiki/spaces/DOCS/pages/900"
		);
	});
});

describe("attachment upload", () => {
	test("PUTs multipart form data to the v1 attachment endpoint", async () => {
		stub.queue.push({ json: { results: [] } });
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
		await client.uploadAttachment("900", "chart.png", bytes.buffer, "image/png");

		const [call] = stub.calls;
		assert.equal(call.method, "PUT");
		assert.equal(
			call.url,
			"https://example.atlassian.net/wiki/rest/api/content/900/child/attachment"
		);
		// The CSRF opt-out header is mandatory for this endpoint.
		assert.equal(call.headers["X-Atlassian-Token"], "no-check");

		const boundary = /boundary=(.+)$/.exec(call.headers["Content-Type"])[1];
		const body = Buffer.from(call.body);
		const text = body.toString("latin1");
		assert.ok(text.startsWith(`--${boundary}\r\n`));
		assert.match(text, /Content-Disposition: form-data; name="file"; filename="chart\.png"/);
		assert.match(text, /Content-Type: image\/png/);
		assert.ok(text.trimEnd().endsWith(`--${boundary}--`));
		// Binary payload must survive byte-for-byte.
		assert.ok(body.includes(Buffer.from(bytes)));
	});

	test("names the file in the error when upload fails", async () => {
		stub.queue.push({ status: 413, text: "too large" });
		await assert.rejects(
			() => client.uploadAttachment("900", "big.png", new Uint8Array([1]).buffer, "image/png"),
			/Uploading "big\.png" failed/
		);
	});
});

describe("credentials", () => {
	test("clears the space cache when credentials change", async () => {
		stub.queue.push({ json: { results: [{ id: "555" }] } });
		await client.getSpaceId("DOCS");

		client.updateCredentials({ ...creds, siteUrl: "https://other.atlassian.net" });
		stub.queue.push({ json: { results: [{ id: "777" }] } });
		assert.equal(await client.getSpaceId("DOCS"), "777");
		assert.match(stub.calls[1].url, /^https:\/\/other\.atlassian\.net/);
	});

	test("tolerates a trailing slash in the site URL", async () => {
		client.updateCredentials({ ...creds, siteUrl: "https://example.atlassian.net/" });
		stub.queue.push({ json: { displayName: "x" } });
		await client.verifyCredentials();
		assert.equal(stub.calls[0].url, "https://example.atlassian.net/wiki/rest/api/user/current");
	});
});
