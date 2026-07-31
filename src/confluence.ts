import { RequestUrlResponse, requestUrl } from "obsidian";

export interface ConfluenceCredentials {
	/** Site base URL, e.g. https://your-org.atlassian.net (no trailing slash). */
	siteUrl: string;
	email: string;
	apiToken: string;
}

export interface ConfluencePage {
	id: string;
	title: string;
	spaceId: string;
	parentId: string | null;
	status: string;
	version: number;
	webUrl: string | null;
}

export class ConfluenceError extends Error {
	readonly status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "ConfluenceError";
		this.status = status;
	}
}

/** Base64 that survives non-ASCII input, unlike a bare btoa call. */
function toBase64(input: string): string {
	const bytes = new TextEncoder().encode(input);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/**
 * Pulls a numeric content id out of any of the Confluence URL shapes.
 *
 * Folder URLs are included because a folder is a valid parent for a page, so
 * anywhere a parent can be named a folder link has to be accepted.
 */
export function pageIdFromUrl(url: string): string | null {
	if (!url) return null;
	const trimmed = url.trim();
	if (/^\d+$/.test(trimmed)) return trimmed;
	return (
		/\/pages\/(\d+)/.exec(trimmed)?.[1] ??
		/\/folder\/(\d+)/.exec(trimmed)?.[1] ??
		/[?&]pageId=(\d+)/.exec(trimmed)?.[1] ??
		null
	);
}

/** A page's content as Confluence renders it back to Markdown. */
export interface RemoteMarkdown {
	title: string;
	version: number;
	/** ISO timestamp of the version that produced this content. */
	editedAt: string;
	markdown: string;
}

/** An inline comment, which is anchored to a span of text inside the page body. */
export interface InlineComment {
	id: string;
	/** Ties the comment to a marker in the body markup. */
	markerRef: string;
	/** Text the comment was first attached to, for reporting only. */
	originalSelection: string;
}

/** A page or folder as it appears in a content tree. */
export interface ConfluenceNode {
	id: string;
	/** "page" or "folder"; Confluence may add others. */
	type: string;
	title: string;
	parentId: string | null;
}

export class ConfluenceClient {
	private creds: ConfluenceCredentials;
	private spaceIdCache = new Map<string, string>();

	constructor(creds: ConfluenceCredentials) {
		this.creds = creds;
	}

	updateCredentials(creds: ConfluenceCredentials): void {
		this.creds = creds;
		this.spaceIdCache.clear();
	}

	get siteUrl(): string {
		return this.creds.siteUrl.replace(/\/+$/, "");
	}

	/**
	 * Canonical URL for a page.
	 *
	 * The page id is deliberately the last segment. Confluence's own
	 * `_links.webui` ends with a slug of the title instead, which defeats
	 * readers that take the id off the end of the URL, including the
	 * `/confluence` skill.
	 */
	pageUrl(spaceKey: string, pageId: string): string {
		return `${this.siteUrl}/wiki/spaces/${encodeURIComponent(spaceKey)}/pages/${pageId}`;
	}

	folderUrl(spaceKey: string, folderId: string): string {
		return `${this.siteUrl}/wiki/spaces/${encodeURIComponent(spaceKey)}/folder/${folderId}`;
	}

	private get authHeader(): string {
		return "Basic " + toBase64(`${this.creds.email}:${this.creds.apiToken}`);
	}

	private describeError(res: RequestUrlResponse, fallback: string): string {
		try {
			const body = res.json as {
				errors?: { title?: string; detail?: string }[];
				message?: string;
			};
			if (body?.errors?.length) {
				return body.errors
					.map((e) => [e.title, e.detail].filter(Boolean).join(": "))
					.join("; ");
			}
			if (body?.message) return body.message;
		} catch {
			// Body was not JSON; fall through to the raw text.
		}
		const text = (res.text || "").slice(0, 300);
		return text || fallback;
	}

	private async request(
		method: string,
		path: string,
		body?: unknown
	): Promise<RequestUrlResponse> {
		const res = await requestUrl({
			url: `${this.siteUrl}${path}`,
			method,
			headers: {
				Authorization: this.authHeader,
				Accept: "application/json",
				...(body ? { "Content-Type": "application/json" } : {}),
			},
			body: body ? JSON.stringify(body) : undefined,
			throw: false,
		});

		if (res.status < 200 || res.status >= 300) {
			if (res.status === 401) {
				throw new ConfluenceError(
					"Authentication failed (401). Check the email and API token in settings.",
					401
				);
			}
			if (res.status === 403) {
				throw new ConfluenceError(
					"Permission denied (403). The account cannot write to this space or page.",
					403
				);
			}
			throw new ConfluenceError(
				this.describeError(res, `${method} ${path} failed with ${res.status}`),
				res.status
			);
		}
		return res;
	}

	/** Verifies credentials and returns the authenticated account's display name. */
	async verifyCredentials(): Promise<string> {
		const res = await this.request("GET", "/wiki/rest/api/user/current");
		const user = res.json as { displayName?: string; email?: string };
		return user.displayName || user.email || "unknown account";
	}

	async getSpaceId(spaceKey: string): Promise<string> {
		const cached = this.spaceIdCache.get(spaceKey);
		if (cached) return cached;

		const res = await this.request(
			"GET",
			`/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}&limit=1`
		);
		const results = (res.json as { results?: { id: string }[] }).results;
		if (!results?.length) {
			throw new ConfluenceError(`Space "${spaceKey}" was not found.`, 404);
		}
		this.spaceIdCache.set(spaceKey, results[0].id);
		return results[0].id;
	}

	private toPage(raw: Record<string, unknown>): ConfluencePage {
		const links = raw._links as { webui?: string } | undefined;
		const version = raw.version as { number?: number } | undefined;
		return {
			id: String(raw.id),
			title: String(raw.title ?? ""),
			spaceId: String(raw.spaceId ?? ""),
			parentId: raw.parentId ? String(raw.parentId) : null,
			status: String(raw.status ?? "current"),
			version: version?.number ?? 1,
			webUrl: links?.webui ? `${this.siteUrl}/wiki${links.webui}` : null,
		};
	}

	async getPage(pageId: string): Promise<ConfluencePage | null> {
		try {
			const res = await this.request("GET", `/wiki/api/v2/pages/${pageId}`);
			return this.toPage(res.json as Record<string, unknown>);
		} catch (err) {
			if (err instanceof ConfluenceError && err.status === 404) return null;
			throw err;
		}
	}

	/**
	 * The page as Markdown, rendered by Confluence rather than converted here.
	 *
	 * Used for pulling a page back for review. The result is normalised, not the
	 * Markdown that was originally pushed: links come back absolute, callouts as
	 * panels, and vault frontmatter is gone. It shows what Confluence holds, so
	 * it is a thing to read and copy from, not to write over a note with.
	 */
	async getPageMarkdown(pageId: string): Promise<RemoteMarkdown | null> {
		try {
			const res = await this.request(
				"GET",
				`/wiki/api/v2/pages/${pageId}?body-format=markdown`
			);
			const raw = res.json as {
				title?: string;
				version?: { number?: number; createdAt?: string; authorId?: string };
				body?: { markdown?: { value?: string } };
			};
			return {
				title: String(raw.title ?? ""),
				version: raw.version?.number ?? 0,
				editedAt: raw.version?.createdAt ?? "",
				markdown: raw.body?.markdown?.value ?? "",
			};
		} catch (err) {
			if (err instanceof ConfluenceError && err.status === 404) return null;
			throw err;
		}
	}

	/** The page's current body as storage markup, or null if it has none. */
	async getPageStorage(pageId: string): Promise<string | null> {
		try {
			const res = await this.request(
				"GET",
				`/wiki/api/v2/pages/${pageId}?body-format=storage`
			);
			const body = (res.json as { body?: { storage?: { value?: string } } }).body;
			return body?.storage?.value ?? null;
		} catch (err) {
			if (err instanceof ConfluenceError && err.status === 404) return null;
			throw err;
		}
	}

	/**
	 * Inline comments still anchored to text in the page body.
	 *
	 * Resolved and dangling ones are filtered out here rather than by query
	 * parameter, because only the comment objects themselves are guaranteed to
	 * carry the status across API versions.
	 */
	async getOpenInlineComments(pageId: string): Promise<InlineComment[]> {
		const res = await this.request(
			"GET",
			`/wiki/api/v2/pages/${pageId}/inline-comments?limit=250`
		);
		const results = (res.json as { results?: Record<string, unknown>[] }).results ?? [];

		return results
			.filter((raw) => {
				const status = String(raw.resolutionStatus ?? "open");
				return status === "open" || status === "reopened";
			})
			.map((raw) => {
				// Property names differ in spelling between API surfaces, so accept both.
				const props = (raw.properties ?? {}) as Record<string, unknown>;
				const pick = (...keys: string[]): string => {
					for (const key of keys) {
						const value = props[key];
						if (typeof value === "string" && value) return value;
					}
					return "";
				};
				return {
					id: String(raw.id ?? ""),
					markerRef: pick("inline-marker-ref", "inlineMarkerRef"),
					originalSelection: pick("inline-original-selection", "inlineOriginalSelection"),
				};
			})
			.filter((comment) => comment.markerRef);
	}

	/**
	 * Current pages in the space with exactly this title.
	 *
	 * Capped at two results because callers only need to tell "none" from "one"
	 * from "more than one". An ambiguous title is a reason to ask the user, not
	 * something to resolve by guessing.
	 */
	async findPagesByTitle(spaceId: string, title: string): Promise<ConfluencePage[]> {
		const res = await this.request(
			"GET",
			`/wiki/api/v2/pages?space-id=${encodeURIComponent(spaceId)}` +
				`&title=${encodeURIComponent(title)}&status=current&limit=2`
		);
		const results = (res.json as { results?: Record<string, unknown>[] }).results;
		return (results ?? []).map((raw) => this.toPage(raw));
	}

	async createPage(args: {
		spaceId: string;
		title: string;
		storage: string;
		parentId?: string | null;
	}): Promise<ConfluencePage> {
		const res = await this.request("POST", "/wiki/api/v2/pages", {
			spaceId: args.spaceId,
			status: "current",
			title: args.title,
			...(args.parentId ? { parentId: args.parentId } : {}),
			body: { representation: "storage", value: args.storage },
		});
		return this.toPage(res.json as Record<string, unknown>);
	}

	async updatePage(args: {
		pageId: string;
		title: string;
		storage: string;
		nextVersion: number;
		message?: string;
		parentId?: string | null;
	}): Promise<ConfluencePage> {
		const res = await this.request("PUT", `/wiki/api/v2/pages/${args.pageId}`, {
			id: args.pageId,
			status: "current",
			title: args.title,
			...(args.parentId ? { parentId: args.parentId } : {}),
			body: { representation: "storage", value: args.storage },
			version: {
				number: args.nextVersion,
				message: args.message || "Updated from Obsidian",
				minorEdit: false,
			},
		});
		return this.toPage(res.json as Record<string, unknown>);
	}

	/**
	 * Everything filed under a page, pages and folders alike, flattened.
	 *
	 * Walks children one level at a time rather than using the descendants
	 * endpoint, which stops recursing once it reaches a folder inside a folder
	 * and so silently reports nested folders as empty. Callers rebuild the
	 * hierarchy from `parentId`.
	 */
	async descendants(rootId: string): Promise<ConfluenceNode[]> {
		const nodes: ConfluenceNode[] = [];
		const queue = [rootId];
		const visited = new Set<string>();

		while (queue.length) {
			const parentId = queue.shift() as string;
			if (visited.has(parentId)) continue;
			visited.add(parentId);

			const children = await this.directChildren(parentId);
			for (const child of children) {
				nodes.push(child);
				if (child.type === "folder" || child.type === "page") queue.push(child.id);
			}
		}

		return nodes;
	}

	/**
	 * Immediate children of a page or a folder.
	 *
	 * The endpoint differs by parent type and Confluence does not accept a page
	 * id on the folder route or the reverse, so both are tried. Results carry no
	 * `parentId` of their own, since being in this list is what makes them
	 * children.
	 */
	async directChildren(parentId: string): Promise<ConfluenceNode[]> {
		for (const kind of ["folders", "pages"]) {
			try {
				const res = await this.request(
					"GET",
					`/wiki/api/v2/${kind}/${parentId}/direct-children?limit=250`
				);
				const results = (res.json as { results?: Record<string, unknown>[] }).results ?? [];
				return results.map((raw) => ({
					id: String(raw.id),
					type: String(raw.type ?? "page"),
					title: String(raw.title ?? ""),
					parentId,
				}));
			} catch (err) {
				if (err instanceof ConfluenceError && err.status === 404) continue;
				throw err;
			}
		}
		throw new ConfluenceError(`No page or folder with id ${parentId}.`, 404);
	}

	/**
	 * Changes a page's title without altering what is on it.
	 *
	 * The v2 update needs a body, so the current one is read back and sent again
	 * unchanged. Without that, renaming a page would double as a content
	 * overwrite, which is exactly what must not happen to a page this vault has
	 * never published.
	 */
	async retitle(args: {
		pageId: string;
		title: string;
		currentVersion: number;
		message?: string;
	}): Promise<ConfluencePage> {
		const storage = await this.getPageStorage(args.pageId);
		if (storage === null) {
			throw new ConfluenceError(`Page ${args.pageId} has no readable body to preserve.`, 404);
		}
		return this.updatePage({
			pageId: args.pageId,
			title: args.title,
			storage,
			nextVersion: args.currentVersion + 1,
			message: args.message || "Renamed from Obsidian",
		});
	}

	/**
	 * Refiles a page or folder under a new parent, leaving its body untouched.
	 *
	 * Deliberately the v1 move endpoint. A v2 update would have to send a body,
	 * so refiling a page would replace its content as a side effect, and v2 has
	 * no update route for folders at all.
	 */
	async moveContent(contentId: string, targetParentId: string): Promise<void> {
		await this.request(
			"PUT",
			`/wiki/rest/api/content/${contentId}/move/append/${targetParentId}`
		);
	}

	/**
	 * Finds a folder anywhere in the space by title.
	 *
	 * Confluence requires folder titles to be unique across a whole space, not
	 * just among siblings, so a name already taken under a different parent
	 * still blocks a create. Searching the space is what makes "already exists"
	 * mean the same thing here as it does on the server.
	 */
	async findFolderByTitle(spaceKey: string, title: string): Promise<ConfluenceNode | null> {
		const cql = `type=folder and space="${spaceKey}" and title="${title.replace(/"/g, '\\"')}"`;
		const res = await this.request(
			"GET",
			`/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=5`
		);
		const results = (res.json as { results?: { content?: Record<string, unknown> }[] }).results;
		for (const hit of results ?? []) {
			const content = hit.content;
			if (content && String(content.title ?? "") === title) {
				return {
					id: String(content.id),
					type: "folder",
					title,
					parentId: null,
				};
			}
		}
		return null;
	}

	async createFolder(args: {
		spaceId: string;
		title: string;
		parentId: string;
	}): Promise<ConfluenceNode> {
		const res = await this.request("POST", "/wiki/api/v2/folders", {
			spaceId: args.spaceId,
			title: args.title,
			parentId: args.parentId,
		});
		const raw = res.json as Record<string, unknown>;
		return {
			id: String(raw.id),
			type: "folder",
			title: String(raw.title ?? args.title),
			parentId: raw.parentId ? String(raw.parentId) : args.parentId,
		};
	}

	/**
	 * Creates or replaces an attachment.
	 *
	 * Uses the v1 endpoint because v2 has no attachment write API. PUT is
	 * deliberate: it updates an existing attachment with the same filename
	 * instead of creating a duplicate on every push.
	 */
	async uploadAttachment(
		pageId: string,
		filename: string,
		data: ArrayBuffer,
		contentType: string
	): Promise<void> {
		const boundary = `----ObsidianConfluencePush${Math.random().toString(36).slice(2)}`;
		const encoder = new TextEncoder();

		const header = encoder.encode(
			`--${boundary}\r\n` +
				`Content-Disposition: form-data; name="file"; filename="${filename.replace(/"/g, "")}"\r\n` +
				`Content-Type: ${contentType}\r\n\r\n`
		);
		const middle = encoder.encode(
			`\r\n--${boundary}\r\n` +
				`Content-Disposition: form-data; name="minorEdit"\r\n\r\ntrue\r\n` +
				`--${boundary}--\r\n`
		);
		const file = new Uint8Array(data);

		const payload = new Uint8Array(header.length + file.length + middle.length);
		payload.set(header, 0);
		payload.set(file, header.length);
		payload.set(middle, header.length + file.length);

		const res = await requestUrl({
			url: `${this.siteUrl}/wiki/rest/api/content/${pageId}/child/attachment`,
			method: "PUT",
			headers: {
				Authorization: this.authHeader,
				Accept: "application/json",
				"X-Atlassian-Token": "no-check",
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			body: payload.buffer,
			throw: false,
		});

		if (res.status < 200 || res.status >= 300) {
			throw new ConfluenceError(
				`Uploading "${filename}" failed: ${this.describeError(res, String(res.status))}`,
				res.status
			);
		}
	}
}
