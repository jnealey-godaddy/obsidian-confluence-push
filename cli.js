#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli.ts
var import_fs2 = require("fs");
var path2 = __toESM(require("path"));

// src/node/obsidian-shim.ts
async function requestUrl(options2) {
  const res = await fetch(options2.url, {
    method: options2.method ?? "GET",
    headers: options2.headers,
    body: options2.body
  });
  const text = await res.text();
  if (options2.throw !== false && (res.status < 200 || res.status >= 300)) {
    throw new Error(`Request failed, status ${res.status}`);
  }
  return {
    status: res.status,
    text,
    // Lazy so a non-JSON error body does not throw before the caller has
    // had a chance to read `text` instead. Matches Obsidian's behaviour.
    get json() {
      return JSON.parse(text);
    }
  };
}
var TFile = class {
  constructor(path3) {
    this.path = path3;
    this.name = path3.split("/").pop() ?? path3;
    const dot = this.name.lastIndexOf(".");
    this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
  }
};
function makeEl(tag2) {
  const el = {
    tag: tag2,
    text: "",
    children: [],
    settings: [],
    createEl(childTag, opts = {}) {
      const child = makeEl(childTag);
      child.text = opts.text ?? "";
      el.children.push(child);
      return child;
    },
    createDiv(opts = {}) {
      return el.createEl("div", opts);
    },
    addClass() {
    },
    removeClass() {
    },
    empty() {
      el.children.length = 0;
      el.settings.length = 0;
    },
    addEventListener() {
    }
  };
  return el;
}
var Setting = class {
  constructor(containerEl) {
    this.buttons = [];
    containerEl.settings.push(this);
  }
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  setHeading() {
    return this;
  }
  addText() {
    return this;
  }
  addToggle() {
    return this;
  }
  addButton(cb) {
    let handler = null;
    const button = {
      text: "",
      setButtonText(text) {
        button.text = text;
        return button;
      },
      setCta: () => button,
      setWarning: () => button,
      setDisabled: () => button,
      setIcon: () => button,
      onClick(fn) {
        handler = fn;
        return button;
      },
      click() {
        handler?.();
      }
    };
    cb(button);
    this.buttons.push(button);
    return this;
  }
};
var Modal = class _Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = makeEl("div");
    this.closed = false;
  }
  static {
    this.handler = null;
  }
  open() {
    this.onOpen();
    const handler = _Modal.handler ?? ((modal) => modal.button("Cancel")?.click());
    handler(this);
    if (!this.closed)
      this.close();
  }
  close() {
    this.closed = true;
    this.onClose();
  }
  onOpen() {
  }
  onClose() {
  }
  /** Finds a rendered button by its label. */
  button(label) {
    for (const setting of this.contentEl.settings) {
      const match = setting.buttons.find((b) => b.text === label);
      if (match)
        return match;
    }
    return null;
  }
  /** Heading and paragraphs as plain lines, for printing to a terminal. */
  describe() {
    const lines = [];
    const walk2 = (el) => {
      if (el.text)
        lines.push(el.text);
      el.children.forEach(walk2);
    };
    this.contentEl.children.forEach(walk2);
    return lines;
  }
};

// src/node/vault-fs.ts
var import_fs = require("fs");
var path = __toESM(require("path"));
var ALWAYS_SKIP = /* @__PURE__ */ new Set([".git", ".obsidian", "node_modules", ".trash"]);
var FileIndex = class {
  constructor() {
    this.files = [];
    this.byPath = /* @__PURE__ */ new Map();
    this.byBasename = /* @__PURE__ */ new Map();
  }
  add(file) {
    this.files.push(file);
    this.byPath.set(file.path, file);
    const bucket = this.byBasename.get(file.basename);
    if (bucket)
      bucket.push(file);
    else
      this.byBasename.set(file.basename, [file]);
  }
  get(vaultPath) {
    return this.byPath.get(vaultPath) ?? null;
  }
  /** Path match, trying the `.md` extension Obsidian lets links omit. */
  getByPathish(candidate) {
    return this.byPath.get(candidate) ?? this.byPath.get(`${candidate}.md`) ?? null;
  }
  withBasename(basename) {
    return this.byBasename.get(basename) ?? [];
  }
};
async function walk(root, rel, ignore, index) {
  const entries = await import_fs.promises.readdir(path.join(root, rel), { withFileTypes: true });
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (ALWAYS_SKIP.has(entry.name))
        continue;
      if (ignore.some((prefix) => `${childRel}/`.startsWith(prefix)))
        continue;
      await walk(root, childRel, ignore, index);
    } else if (entry.isFile()) {
      index.add(new TFile(childRel));
    }
  }
}
function findFrontmatter(text) {
  if (!text.startsWith("---"))
    return null;
  const firstBreak = text.indexOf("\n");
  if (firstBreak === -1 || text.slice(0, firstBreak).trim() !== "---")
    return null;
  const closing = /^---[ \t]*$/m;
  const rest = text.slice(firstBreak + 1);
  const match = closing.exec(rest);
  if (!match)
    return null;
  return {
    block: rest.slice(0, match.index),
    start: firstBreak + 1,
    end: firstBreak + 1 + match.index
  };
}
function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && last === first) {
      const inner = trimmed.slice(1, -1);
      return first === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : inner;
    }
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}
function parseFrontmatter(block2) {
  const result = {};
  const lines = block2.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#"))
      continue;
    if (/^\s/.test(line))
      continue;
    const match = /^([A-Za-z0-9_.-]+):(.*)$/.exec(line);
    if (!match)
      continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (!value) {
      const items = [];
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
function quote(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function setFrontmatterProperty(text, key, value) {
  const line = `${key}: ${quote(value)}`;
  const span = findFrontmatter(text);
  if (!span) {
    return `---
${line}
---

${text.replace(/^\n+/, "")}`;
  }
  const pattern = new RegExp(`^${key}:.*$`, "m");
  if (pattern.test(span.block)) {
    const updated = span.block.replace(pattern, line);
    return text.slice(0, span.start) + updated + text.slice(span.end);
  }
  const separator = span.block.endsWith("\n") ? "" : "\n";
  return text.slice(0, span.start) + span.block + separator + line + "\n" + text.slice(span.end);
}
var NodeVault = class _NodeVault {
  constructor(root) {
    this.root = root;
    this.index = new FileIndex();
    this.cache = /* @__PURE__ */ new Map();
  }
  static async open(root, opts = {}) {
    const vault = new _NodeVault(path.resolve(root));
    await walk(vault.root, "", opts.ignore ?? [], vault.index);
    return vault;
  }
  absolute(file) {
    return path.join(this.root, file.path);
  }
  /** Resolves any path the user might type: absolute, relative to cwd, or vault-relative. */
  resolve(input) {
    const direct = this.index.getByPathish(input);
    if (direct)
      return direct;
    const absolute = path.resolve(input);
    if (absolute.startsWith(this.root + path.sep)) {
      return this.index.getByPathish(absolute.slice(this.root.length + 1));
    }
    return null;
  }
  markdownFiles() {
    return this.index.files.filter((file) => file.extension === "md");
  }
  async read(file) {
    return import_fs.promises.readFile(this.absolute(file), "utf8");
  }
  async frontmatter(file) {
    const cached = this.cache.get(file.path);
    if (cached)
      return cached;
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
  resolveLinkpath(target, sourcePath) {
    const clean = target.split("#")[0].split("|")[0].trim();
    if (!clean)
      return null;
    const byPath = this.index.getByPathish(clean);
    if (byPath)
      return byPath;
    const sourceDir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
    if (sourceDir) {
      const sibling = this.index.getByPathish(`${sourceDir}/${clean}`);
      if (sibling)
        return sibling;
    }
    const basename = clean.includes("/") ? clean.split("/").pop() : clean;
    const matches = this.index.withBasename(basename.replace(/\.md$/, ""));
    if (!matches.length)
      return null;
    if (matches.length === 1)
      return matches[0];
    const beside = matches.find((file) => file.path.startsWith(sourceDir ? `${sourceDir}/` : ""));
    if (beside && sourceDir)
      return beside;
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
  asApp() {
    return {
      vault: {
        cachedRead: (file) => this.read(file),
        readBinary: async (file) => {
          const buffer = await import_fs.promises.readFile(this.absolute(file));
          return buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          );
        },
        getAbstractFileByPath: (vaultPath) => this.index.get(vaultPath),
        getMarkdownFiles: () => this.markdownFiles()
      },
      metadataCache: {
        getFileCache: (file) => ({ frontmatter: this.cache.get(file.path) ?? {} }),
        getFirstLinkpathDest: (target, sourcePath) => this.resolveLinkpath(target, sourcePath)
      },
      fileManager: {
        processFrontMatter: async (file, fn) => {
          const text = await this.read(file);
          const span = findFrontmatter(text);
          const before = span ? parseFrontmatter(span.block) : {};
          const after = { ...before };
          fn(after);
          let updated = text;
          for (const [key, value] of Object.entries(after)) {
            if (before[key] === value)
              continue;
            updated = setFrontmatterProperty(updated, key, String(value));
          }
          if (updated !== text)
            await import_fs.promises.writeFile(this.absolute(file), updated, "utf8");
          this.cache.set(file.path, after);
        }
      }
    };
  }
  /**
   * Loads frontmatter for every note that could be reached as a link target,
   * so the synchronous metadata calls above have something to answer with.
   */
  async warmFrontmatter() {
    for (const file of this.markdownFiles()) {
      try {
        await this.frontmatter(file);
      } catch {
      }
    }
  }
};

// src/confluence.ts
var ConfluenceError = class extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ConfluenceError";
    this.status = status;
  }
};
function toBase64(input) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes)
    binary += String.fromCharCode(byte);
  return btoa(binary);
}
function pageIdFromUrl(url) {
  if (!url)
    return null;
  const trimmed = url.trim();
  if (/^\d+$/.test(trimmed))
    return trimmed;
  return /\/pages\/(\d+)/.exec(trimmed)?.[1] ?? /\/folder\/(\d+)/.exec(trimmed)?.[1] ?? /[?&]pageId=(\d+)/.exec(trimmed)?.[1] ?? null;
}
var ConfluenceClient = class {
  constructor(creds) {
    this.spaceIdCache = /* @__PURE__ */ new Map();
    this.creds = creds;
  }
  updateCredentials(creds) {
    this.creds = creds;
    this.spaceIdCache.clear();
  }
  get siteUrl() {
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
  pageUrl(spaceKey, pageId) {
    return `${this.siteUrl}/wiki/spaces/${encodeURIComponent(spaceKey)}/pages/${pageId}`;
  }
  folderUrl(spaceKey, folderId) {
    return `${this.siteUrl}/wiki/spaces/${encodeURIComponent(spaceKey)}/folder/${folderId}`;
  }
  get authHeader() {
    return "Basic " + toBase64(`${this.creds.email}:${this.creds.apiToken}`);
  }
  describeError(res, fallback) {
    try {
      const body = res.json;
      if (body?.errors?.length) {
        return body.errors.map((e) => [e.title, e.detail].filter(Boolean).join(": ")).join("; ");
      }
      if (body?.message)
        return body.message;
    } catch {
    }
    const text = (res.text || "").slice(0, 300);
    return text || fallback;
  }
  async request(method, path3, body) {
    const res = await requestUrl({
      url: `${this.siteUrl}${path3}`,
      method,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        ...body ? { "Content-Type": "application/json" } : {}
      },
      body: body ? JSON.stringify(body) : void 0,
      throw: false
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
        this.describeError(res, `${method} ${path3} failed with ${res.status}`),
        res.status
      );
    }
    return res;
  }
  /** Verifies credentials and returns the authenticated account's display name. */
  async verifyCredentials() {
    const res = await this.request("GET", "/wiki/rest/api/user/current");
    const user = res.json;
    return user.displayName || user.email || "unknown account";
  }
  async getSpaceId(spaceKey) {
    const cached = this.spaceIdCache.get(spaceKey);
    if (cached)
      return cached;
    const res = await this.request(
      "GET",
      `/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}&limit=1`
    );
    const results = res.json.results;
    if (!results?.length) {
      throw new ConfluenceError(`Space "${spaceKey}" was not found.`, 404);
    }
    this.spaceIdCache.set(spaceKey, results[0].id);
    return results[0].id;
  }
  toPage(raw) {
    const links = raw._links;
    const version = raw.version;
    return {
      id: String(raw.id),
      title: String(raw.title ?? ""),
      spaceId: String(raw.spaceId ?? ""),
      parentId: raw.parentId ? String(raw.parentId) : null,
      status: String(raw.status ?? "current"),
      version: version?.number ?? 1,
      webUrl: links?.webui ? `${this.siteUrl}/wiki${links.webui}` : null
    };
  }
  async getPage(pageId) {
    try {
      const res = await this.request("GET", `/wiki/api/v2/pages/${pageId}`);
      return this.toPage(res.json);
    } catch (err) {
      if (err instanceof ConfluenceError && err.status === 404)
        return null;
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
  async getPageMarkdown(pageId) {
    try {
      const res = await this.request(
        "GET",
        `/wiki/api/v2/pages/${pageId}?body-format=markdown`
      );
      const raw = res.json;
      return {
        title: String(raw.title ?? ""),
        version: raw.version?.number ?? 0,
        editedAt: raw.version?.createdAt ?? "",
        markdown: raw.body?.markdown?.value ?? ""
      };
    } catch (err) {
      if (err instanceof ConfluenceError && err.status === 404)
        return null;
      throw err;
    }
  }
  /** The page's current body as storage markup, or null if it has none. */
  async getPageStorage(pageId) {
    try {
      const res = await this.request(
        "GET",
        `/wiki/api/v2/pages/${pageId}?body-format=storage`
      );
      const body = res.json.body;
      return body?.storage?.value ?? null;
    } catch (err) {
      if (err instanceof ConfluenceError && err.status === 404)
        return null;
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
  async getOpenInlineComments(pageId) {
    const res = await this.request(
      "GET",
      `/wiki/api/v2/pages/${pageId}/inline-comments?limit=250`
    );
    const results = res.json.results ?? [];
    return results.filter((raw) => {
      const status = String(raw.resolutionStatus ?? "open");
      return status === "open" || status === "reopened";
    }).map((raw) => {
      const props = raw.properties ?? {};
      const pick = (...keys) => {
        for (const key of keys) {
          const value = props[key];
          if (typeof value === "string" && value)
            return value;
        }
        return "";
      };
      return {
        id: String(raw.id ?? ""),
        markerRef: pick("inline-marker-ref", "inlineMarkerRef"),
        originalSelection: pick("inline-original-selection", "inlineOriginalSelection")
      };
    }).filter((comment) => comment.markerRef);
  }
  /**
   * Current pages in the space with exactly this title.
   *
   * Capped at two results because callers only need to tell "none" from "one"
   * from "more than one". An ambiguous title is a reason to ask the user, not
   * something to resolve by guessing.
   */
  async findPagesByTitle(spaceId, title) {
    const res = await this.request(
      "GET",
      `/wiki/api/v2/pages?space-id=${encodeURIComponent(spaceId)}&title=${encodeURIComponent(title)}&status=current&limit=2`
    );
    const results = res.json.results;
    return (results ?? []).map((raw) => this.toPage(raw));
  }
  async createPage(args) {
    const res = await this.request("POST", "/wiki/api/v2/pages", {
      spaceId: args.spaceId,
      status: "current",
      title: args.title,
      ...args.parentId ? { parentId: args.parentId } : {},
      body: { representation: "storage", value: args.storage }
    });
    return this.toPage(res.json);
  }
  async updatePage(args) {
    const res = await this.request("PUT", `/wiki/api/v2/pages/${args.pageId}`, {
      id: args.pageId,
      status: "current",
      title: args.title,
      ...args.parentId ? { parentId: args.parentId } : {},
      body: { representation: "storage", value: args.storage },
      version: {
        number: args.nextVersion,
        message: args.message || "Updated from Obsidian",
        minorEdit: false
      }
    });
    return this.toPage(res.json);
  }
  /**
   * Everything filed under a page, pages and folders alike, flattened.
   *
   * Walks children one level at a time rather than using the descendants
   * endpoint, which stops recursing once it reaches a folder inside a folder
   * and so silently reports nested folders as empty. Callers rebuild the
   * hierarchy from `parentId`.
   */
  async descendants(rootId) {
    const nodes = [];
    const queue = [rootId];
    const visited = /* @__PURE__ */ new Set();
    while (queue.length) {
      const parentId = queue.shift();
      if (visited.has(parentId))
        continue;
      visited.add(parentId);
      const children = await this.directChildren(parentId);
      for (const child of children) {
        nodes.push(child);
        if (child.type === "folder" || child.type === "page")
          queue.push(child.id);
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
  async directChildren(parentId) {
    for (const kind of ["folders", "pages"]) {
      try {
        const res = await this.request(
          "GET",
          `/wiki/api/v2/${kind}/${parentId}/direct-children?limit=250`
        );
        const results = res.json.results ?? [];
        return results.map((raw) => ({
          id: String(raw.id),
          type: String(raw.type ?? "page"),
          title: String(raw.title ?? ""),
          parentId
        }));
      } catch (err) {
        if (err instanceof ConfluenceError && err.status === 404)
          continue;
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
  async retitle(args) {
    const storage = await this.getPageStorage(args.pageId);
    if (storage === null) {
      throw new ConfluenceError(`Page ${args.pageId} has no readable body to preserve.`, 404);
    }
    return this.updatePage({
      pageId: args.pageId,
      title: args.title,
      storage,
      nextVersion: args.currentVersion + 1,
      message: args.message || "Renamed from Obsidian"
    });
  }
  /**
   * Refiles a page or folder under a new parent, leaving its body untouched.
   *
   * Deliberately the v1 move endpoint. A v2 update would have to send a body,
   * so refiling a page would replace its content as a side effect, and v2 has
   * no update route for folders at all.
   */
  async moveContent(contentId, targetParentId) {
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
  async findFolderByTitle(spaceKey, title) {
    const cql = `type=folder and space="${spaceKey}" and title="${title.replace(/"/g, '\\"')}"`;
    const res = await this.request(
      "GET",
      `/wiki/rest/api/search?cql=${encodeURIComponent(cql)}&limit=5`
    );
    const results = res.json.results;
    for (const hit of results ?? []) {
      const content = hit.content;
      if (content && String(content.title ?? "") === title) {
        return {
          id: String(content.id),
          type: "folder",
          title,
          parentId: null
        };
      }
    }
    return null;
  }
  async createFolder(args) {
    const res = await this.request("POST", "/wiki/api/v2/folders", {
      spaceId: args.spaceId,
      title: args.title,
      parentId: args.parentId
    });
    const raw = res.json;
    return {
      id: String(raw.id),
      type: "folder",
      title: String(raw.title ?? args.title),
      parentId: raw.parentId ? String(raw.parentId) : args.parentId
    };
  }
  /**
   * Creates or replaces an attachment.
   *
   * Uses the v1 endpoint because v2 has no attachment write API. PUT is
   * deliberate: it updates an existing attachment with the same filename
   * instead of creating a duplicate on every push.
   */
  async uploadAttachment(pageId, filename, data, contentType) {
    const boundary = `----ObsidianConfluencePush${Math.random().toString(36).slice(2)}`;
    const encoder = new TextEncoder();
    const header = encoder.encode(
      `--${boundary}\r
Content-Disposition: form-data; name="file"; filename="${filename.replace(/"/g, "")}"\r
Content-Type: ${contentType}\r
\r
`
    );
    const middle = encoder.encode(
      `\r
--${boundary}\r
Content-Disposition: form-data; name="minorEdit"\r
\r
true\r
--${boundary}--\r
`
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
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      },
      body: payload.buffer,
      throw: false
    });
    if (res.status < 200 || res.status >= 300) {
      throw new ConfluenceError(
        `Uploading "${filename}" failed: ${this.describeError(res, String(res.status))}`,
        res.status
      );
    }
  }
};

// node_modules/marked/lib/marked.esm.js
function _getDefaults() {
  return {
    async: false,
    breaks: false,
    extensions: null,
    gfm: true,
    hooks: null,
    pedantic: false,
    renderer: null,
    silent: false,
    tokenizer: null,
    walkTokens: null
  };
}
var _defaults = _getDefaults();
function changeDefaults(newDefaults) {
  _defaults = newDefaults;
}
var escapeTest = /[&<>"']/;
var escapeReplace = new RegExp(escapeTest.source, "g");
var escapeTestNoEncode = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
var escapeReplaceNoEncode = new RegExp(escapeTestNoEncode.source, "g");
var escapeReplacements = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};
var getEscapeReplacement = (ch) => escapeReplacements[ch];
function escape$1(html2, encode) {
  if (encode) {
    if (escapeTest.test(html2)) {
      return html2.replace(escapeReplace, getEscapeReplacement);
    }
  } else {
    if (escapeTestNoEncode.test(html2)) {
      return html2.replace(escapeReplaceNoEncode, getEscapeReplacement);
    }
  }
  return html2;
}
var unescapeTest = /&(#(?:\d+)|(?:#x[0-9A-Fa-f]+)|(?:\w+));?/ig;
function unescape(html2) {
  return html2.replace(unescapeTest, (_, n) => {
    n = n.toLowerCase();
    if (n === "colon")
      return ":";
    if (n.charAt(0) === "#") {
      return n.charAt(1) === "x" ? String.fromCharCode(parseInt(n.substring(2), 16)) : String.fromCharCode(+n.substring(1));
    }
    return "";
  });
}
var caret = /(^|[^\[])\^/g;
function edit(regex, opt) {
  let source = typeof regex === "string" ? regex : regex.source;
  opt = opt || "";
  const obj = {
    replace: (name, val) => {
      let valSource = typeof val === "string" ? val : val.source;
      valSource = valSource.replace(caret, "$1");
      source = source.replace(name, valSource);
      return obj;
    },
    getRegex: () => {
      return new RegExp(source, opt);
    }
  };
  return obj;
}
function cleanUrl(href) {
  try {
    href = encodeURI(href).replace(/%25/g, "%");
  } catch (e) {
    return null;
  }
  return href;
}
var noopTest = { exec: () => null };
function splitCells(tableRow, count) {
  const row = tableRow.replace(/\|/g, (match, offset, str) => {
    let escaped = false;
    let curr = offset;
    while (--curr >= 0 && str[curr] === "\\")
      escaped = !escaped;
    if (escaped) {
      return "|";
    } else {
      return " |";
    }
  }), cells = row.split(/ \|/);
  let i = 0;
  if (!cells[0].trim()) {
    cells.shift();
  }
  if (cells.length > 0 && !cells[cells.length - 1].trim()) {
    cells.pop();
  }
  if (count) {
    if (cells.length > count) {
      cells.splice(count);
    } else {
      while (cells.length < count)
        cells.push("");
    }
  }
  for (; i < cells.length; i++) {
    cells[i] = cells[i].trim().replace(/\\\|/g, "|");
  }
  return cells;
}
function rtrim(str, c, invert) {
  const l = str.length;
  if (l === 0) {
    return "";
  }
  let suffLen = 0;
  while (suffLen < l) {
    const currChar = str.charAt(l - suffLen - 1);
    if (currChar === c && !invert) {
      suffLen++;
    } else if (currChar !== c && invert) {
      suffLen++;
    } else {
      break;
    }
  }
  return str.slice(0, l - suffLen);
}
function findClosingBracket(str, b) {
  if (str.indexOf(b[1]) === -1) {
    return -1;
  }
  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "\\") {
      i++;
    } else if (str[i] === b[0]) {
      level++;
    } else if (str[i] === b[1]) {
      level--;
      if (level < 0) {
        return i;
      }
    }
  }
  return -1;
}
function outputLink(cap, link2, raw, lexer2) {
  const href = link2.href;
  const title = link2.title ? escape$1(link2.title) : null;
  const text = cap[1].replace(/\\([\[\]])/g, "$1");
  if (cap[0].charAt(0) !== "!") {
    lexer2.state.inLink = true;
    const token = {
      type: "link",
      raw,
      href,
      title,
      text,
      tokens: lexer2.inlineTokens(text)
    };
    lexer2.state.inLink = false;
    return token;
  }
  return {
    type: "image",
    raw,
    href,
    title,
    text: escape$1(text)
  };
}
function indentCodeCompensation(raw, text) {
  const matchIndentToCode = raw.match(/^(\s+)(?:```)/);
  if (matchIndentToCode === null) {
    return text;
  }
  const indentToCode = matchIndentToCode[1];
  return text.split("\n").map((node) => {
    const matchIndentInNode = node.match(/^\s+/);
    if (matchIndentInNode === null) {
      return node;
    }
    const [indentInNode] = matchIndentInNode;
    if (indentInNode.length >= indentToCode.length) {
      return node.slice(indentToCode.length);
    }
    return node;
  }).join("\n");
}
var _Tokenizer = class {
  options;
  rules;
  // set by the lexer
  lexer;
  // set by the lexer
  constructor(options2) {
    this.options = options2 || _defaults;
  }
  space(src) {
    const cap = this.rules.block.newline.exec(src);
    if (cap && cap[0].length > 0) {
      return {
        type: "space",
        raw: cap[0]
      };
    }
  }
  code(src) {
    const cap = this.rules.block.code.exec(src);
    if (cap) {
      const text = cap[0].replace(/^ {1,4}/gm, "");
      return {
        type: "code",
        raw: cap[0],
        codeBlockStyle: "indented",
        text: !this.options.pedantic ? rtrim(text, "\n") : text
      };
    }
  }
  fences(src) {
    const cap = this.rules.block.fences.exec(src);
    if (cap) {
      const raw = cap[0];
      const text = indentCodeCompensation(raw, cap[3] || "");
      return {
        type: "code",
        raw,
        lang: cap[2] ? cap[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : cap[2],
        text
      };
    }
  }
  heading(src) {
    const cap = this.rules.block.heading.exec(src);
    if (cap) {
      let text = cap[2].trim();
      if (/#$/.test(text)) {
        const trimmed = rtrim(text, "#");
        if (this.options.pedantic) {
          text = trimmed.trim();
        } else if (!trimmed || / $/.test(trimmed)) {
          text = trimmed.trim();
        }
      }
      return {
        type: "heading",
        raw: cap[0],
        depth: cap[1].length,
        text,
        tokens: this.lexer.inline(text)
      };
    }
  }
  hr(src) {
    const cap = this.rules.block.hr.exec(src);
    if (cap) {
      return {
        type: "hr",
        raw: cap[0]
      };
    }
  }
  blockquote(src) {
    const cap = this.rules.block.blockquote.exec(src);
    if (cap) {
      let text = cap[0].replace(/\n {0,3}((?:=+|-+) *)(?=\n|$)/g, "\n    $1");
      text = rtrim(text.replace(/^ *>[ \t]?/gm, ""), "\n");
      const top = this.lexer.state.top;
      this.lexer.state.top = true;
      const tokens = this.lexer.blockTokens(text);
      this.lexer.state.top = top;
      return {
        type: "blockquote",
        raw: cap[0],
        tokens,
        text
      };
    }
  }
  list(src) {
    let cap = this.rules.block.list.exec(src);
    if (cap) {
      let bull = cap[1].trim();
      const isordered = bull.length > 1;
      const list2 = {
        type: "list",
        raw: "",
        ordered: isordered,
        start: isordered ? +bull.slice(0, -1) : "",
        loose: false,
        items: []
      };
      bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;
      if (this.options.pedantic) {
        bull = isordered ? bull : "[*+-]";
      }
      const itemRegex = new RegExp(`^( {0,3}${bull})((?:[	 ][^\\n]*)?(?:\\n|$))`);
      let raw = "";
      let itemContents = "";
      let endsWithBlankLine = false;
      while (src) {
        let endEarly = false;
        if (!(cap = itemRegex.exec(src))) {
          break;
        }
        if (this.rules.block.hr.test(src)) {
          break;
        }
        raw = cap[0];
        src = src.substring(raw.length);
        let line = cap[2].split("\n", 1)[0].replace(/^\t+/, (t) => " ".repeat(3 * t.length));
        let nextLine = src.split("\n", 1)[0];
        let indent = 0;
        if (this.options.pedantic) {
          indent = 2;
          itemContents = line.trimStart();
        } else {
          indent = cap[2].search(/[^ ]/);
          indent = indent > 4 ? 1 : indent;
          itemContents = line.slice(indent);
          indent += cap[1].length;
        }
        let blankLine = false;
        if (!line && /^ *$/.test(nextLine)) {
          raw += nextLine + "\n";
          src = src.substring(nextLine.length + 1);
          endEarly = true;
        }
        if (!endEarly) {
          const nextBulletRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`);
          const hrRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`);
          const fencesBeginRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:\`\`\`|~~~)`);
          const headingBeginRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}#`);
          while (src) {
            const rawLine = src.split("\n", 1)[0];
            nextLine = rawLine;
            if (this.options.pedantic) {
              nextLine = nextLine.replace(/^ {1,4}(?=( {4})*[^ ])/g, "  ");
            }
            if (fencesBeginRegex.test(nextLine)) {
              break;
            }
            if (headingBeginRegex.test(nextLine)) {
              break;
            }
            if (nextBulletRegex.test(nextLine)) {
              break;
            }
            if (hrRegex.test(src)) {
              break;
            }
            if (nextLine.search(/[^ ]/) >= indent || !nextLine.trim()) {
              itemContents += "\n" + nextLine.slice(indent);
            } else {
              if (blankLine) {
                break;
              }
              if (line.search(/[^ ]/) >= 4) {
                break;
              }
              if (fencesBeginRegex.test(line)) {
                break;
              }
              if (headingBeginRegex.test(line)) {
                break;
              }
              if (hrRegex.test(line)) {
                break;
              }
              itemContents += "\n" + nextLine;
            }
            if (!blankLine && !nextLine.trim()) {
              blankLine = true;
            }
            raw += rawLine + "\n";
            src = src.substring(rawLine.length + 1);
            line = nextLine.slice(indent);
          }
        }
        if (!list2.loose) {
          if (endsWithBlankLine) {
            list2.loose = true;
          } else if (/\n *\n *$/.test(raw)) {
            endsWithBlankLine = true;
          }
        }
        let istask = null;
        let ischecked;
        if (this.options.gfm) {
          istask = /^\[[ xX]\] /.exec(itemContents);
          if (istask) {
            ischecked = istask[0] !== "[ ] ";
            itemContents = itemContents.replace(/^\[[ xX]\] +/, "");
          }
        }
        list2.items.push({
          type: "list_item",
          raw,
          task: !!istask,
          checked: ischecked,
          loose: false,
          text: itemContents,
          tokens: []
        });
        list2.raw += raw;
      }
      list2.items[list2.items.length - 1].raw = raw.trimEnd();
      list2.items[list2.items.length - 1].text = itemContents.trimEnd();
      list2.raw = list2.raw.trimEnd();
      for (let i = 0; i < list2.items.length; i++) {
        this.lexer.state.top = false;
        list2.items[i].tokens = this.lexer.blockTokens(list2.items[i].text, []);
        if (!list2.loose) {
          const spacers = list2.items[i].tokens.filter((t) => t.type === "space");
          const hasMultipleLineBreaks = spacers.length > 0 && spacers.some((t) => /\n.*\n/.test(t.raw));
          list2.loose = hasMultipleLineBreaks;
        }
      }
      if (list2.loose) {
        for (let i = 0; i < list2.items.length; i++) {
          list2.items[i].loose = true;
        }
      }
      return list2;
    }
  }
  html(src) {
    const cap = this.rules.block.html.exec(src);
    if (cap) {
      const token = {
        type: "html",
        block: true,
        raw: cap[0],
        pre: cap[1] === "pre" || cap[1] === "script" || cap[1] === "style",
        text: cap[0]
      };
      return token;
    }
  }
  def(src) {
    const cap = this.rules.block.def.exec(src);
    if (cap) {
      const tag2 = cap[1].toLowerCase().replace(/\s+/g, " ");
      const href = cap[2] ? cap[2].replace(/^<(.*)>$/, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "";
      const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : cap[3];
      return {
        type: "def",
        tag: tag2,
        raw: cap[0],
        href,
        title
      };
    }
  }
  table(src) {
    const cap = this.rules.block.table.exec(src);
    if (!cap) {
      return;
    }
    if (!/[:|]/.test(cap[2])) {
      return;
    }
    const headers = splitCells(cap[1]);
    const aligns = cap[2].replace(/^\||\| *$/g, "").split("|");
    const rows = cap[3] && cap[3].trim() ? cap[3].replace(/\n[ \t]*$/, "").split("\n") : [];
    const item = {
      type: "table",
      raw: cap[0],
      header: [],
      align: [],
      rows: []
    };
    if (headers.length !== aligns.length) {
      return;
    }
    for (const align of aligns) {
      if (/^ *-+: *$/.test(align)) {
        item.align.push("right");
      } else if (/^ *:-+: *$/.test(align)) {
        item.align.push("center");
      } else if (/^ *:-+ *$/.test(align)) {
        item.align.push("left");
      } else {
        item.align.push(null);
      }
    }
    for (const header of headers) {
      item.header.push({
        text: header,
        tokens: this.lexer.inline(header)
      });
    }
    for (const row of rows) {
      item.rows.push(splitCells(row, item.header.length).map((cell) => {
        return {
          text: cell,
          tokens: this.lexer.inline(cell)
        };
      }));
    }
    return item;
  }
  lheading(src) {
    const cap = this.rules.block.lheading.exec(src);
    if (cap) {
      return {
        type: "heading",
        raw: cap[0],
        depth: cap[2].charAt(0) === "=" ? 1 : 2,
        text: cap[1],
        tokens: this.lexer.inline(cap[1])
      };
    }
  }
  paragraph(src) {
    const cap = this.rules.block.paragraph.exec(src);
    if (cap) {
      const text = cap[1].charAt(cap[1].length - 1) === "\n" ? cap[1].slice(0, -1) : cap[1];
      return {
        type: "paragraph",
        raw: cap[0],
        text,
        tokens: this.lexer.inline(text)
      };
    }
  }
  text(src) {
    const cap = this.rules.block.text.exec(src);
    if (cap) {
      return {
        type: "text",
        raw: cap[0],
        text: cap[0],
        tokens: this.lexer.inline(cap[0])
      };
    }
  }
  escape(src) {
    const cap = this.rules.inline.escape.exec(src);
    if (cap) {
      return {
        type: "escape",
        raw: cap[0],
        text: escape$1(cap[1])
      };
    }
  }
  tag(src) {
    const cap = this.rules.inline.tag.exec(src);
    if (cap) {
      if (!this.lexer.state.inLink && /^<a /i.test(cap[0])) {
        this.lexer.state.inLink = true;
      } else if (this.lexer.state.inLink && /^<\/a>/i.test(cap[0])) {
        this.lexer.state.inLink = false;
      }
      if (!this.lexer.state.inRawBlock && /^<(pre|code|kbd|script)(\s|>)/i.test(cap[0])) {
        this.lexer.state.inRawBlock = true;
      } else if (this.lexer.state.inRawBlock && /^<\/(pre|code|kbd|script)(\s|>)/i.test(cap[0])) {
        this.lexer.state.inRawBlock = false;
      }
      return {
        type: "html",
        raw: cap[0],
        inLink: this.lexer.state.inLink,
        inRawBlock: this.lexer.state.inRawBlock,
        block: false,
        text: cap[0]
      };
    }
  }
  link(src) {
    const cap = this.rules.inline.link.exec(src);
    if (cap) {
      const trimmedUrl = cap[2].trim();
      if (!this.options.pedantic && /^</.test(trimmedUrl)) {
        if (!/>$/.test(trimmedUrl)) {
          return;
        }
        const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), "\\");
        if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) {
          return;
        }
      } else {
        const lastParenIndex = findClosingBracket(cap[2], "()");
        if (lastParenIndex > -1) {
          const start = cap[0].indexOf("!") === 0 ? 5 : 4;
          const linkLen = start + cap[1].length + lastParenIndex;
          cap[2] = cap[2].substring(0, lastParenIndex);
          cap[0] = cap[0].substring(0, linkLen).trim();
          cap[3] = "";
        }
      }
      let href = cap[2];
      let title = "";
      if (this.options.pedantic) {
        const link2 = /^([^'"]*[^\s])\s+(['"])(.*)\2/.exec(href);
        if (link2) {
          href = link2[1];
          title = link2[3];
        }
      } else {
        title = cap[3] ? cap[3].slice(1, -1) : "";
      }
      href = href.trim();
      if (/^</.test(href)) {
        if (this.options.pedantic && !/>$/.test(trimmedUrl)) {
          href = href.slice(1);
        } else {
          href = href.slice(1, -1);
        }
      }
      return outputLink(cap, {
        href: href ? href.replace(this.rules.inline.anyPunctuation, "$1") : href,
        title: title ? title.replace(this.rules.inline.anyPunctuation, "$1") : title
      }, cap[0], this.lexer);
    }
  }
  reflink(src, links) {
    let cap;
    if ((cap = this.rules.inline.reflink.exec(src)) || (cap = this.rules.inline.nolink.exec(src))) {
      const linkString = (cap[2] || cap[1]).replace(/\s+/g, " ");
      const link2 = links[linkString.toLowerCase()];
      if (!link2) {
        const text = cap[0].charAt(0);
        return {
          type: "text",
          raw: text,
          text
        };
      }
      return outputLink(cap, link2, cap[0], this.lexer);
    }
  }
  emStrong(src, maskedSrc, prevChar = "") {
    let match = this.rules.inline.emStrongLDelim.exec(src);
    if (!match)
      return;
    if (match[3] && prevChar.match(/[\p{L}\p{N}]/u))
      return;
    const nextChar = match[1] || match[2] || "";
    if (!nextChar || !prevChar || this.rules.inline.punctuation.exec(prevChar)) {
      const lLength = [...match[0]].length - 1;
      let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;
      const endReg = match[0][0] === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      endReg.lastIndex = 0;
      maskedSrc = maskedSrc.slice(-1 * src.length + lLength);
      while ((match = endReg.exec(maskedSrc)) != null) {
        rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
        if (!rDelim)
          continue;
        rLength = [...rDelim].length;
        if (match[3] || match[4]) {
          delimTotal += rLength;
          continue;
        } else if (match[5] || match[6]) {
          if (lLength % 3 && !((lLength + rLength) % 3)) {
            midDelimTotal += rLength;
            continue;
          }
        }
        delimTotal -= rLength;
        if (delimTotal > 0)
          continue;
        rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
        const lastCharLength = [...match[0]][0].length;
        const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);
        if (Math.min(lLength, rLength) % 2) {
          const text2 = raw.slice(1, -1);
          return {
            type: "em",
            raw,
            text: text2,
            tokens: this.lexer.inlineTokens(text2)
          };
        }
        const text = raw.slice(2, -2);
        return {
          type: "strong",
          raw,
          text,
          tokens: this.lexer.inlineTokens(text)
        };
      }
    }
  }
  codespan(src) {
    const cap = this.rules.inline.code.exec(src);
    if (cap) {
      let text = cap[2].replace(/\n/g, " ");
      const hasNonSpaceChars = /[^ ]/.test(text);
      const hasSpaceCharsOnBothEnds = /^ /.test(text) && / $/.test(text);
      if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
        text = text.substring(1, text.length - 1);
      }
      text = escape$1(text, true);
      return {
        type: "codespan",
        raw: cap[0],
        text
      };
    }
  }
  br(src) {
    const cap = this.rules.inline.br.exec(src);
    if (cap) {
      return {
        type: "br",
        raw: cap[0]
      };
    }
  }
  del(src) {
    const cap = this.rules.inline.del.exec(src);
    if (cap) {
      return {
        type: "del",
        raw: cap[0],
        text: cap[2],
        tokens: this.lexer.inlineTokens(cap[2])
      };
    }
  }
  autolink(src) {
    const cap = this.rules.inline.autolink.exec(src);
    if (cap) {
      let text, href;
      if (cap[2] === "@") {
        text = escape$1(cap[1]);
        href = "mailto:" + text;
      } else {
        text = escape$1(cap[1]);
        href = text;
      }
      return {
        type: "link",
        raw: cap[0],
        text,
        href,
        tokens: [
          {
            type: "text",
            raw: text,
            text
          }
        ]
      };
    }
  }
  url(src) {
    let cap;
    if (cap = this.rules.inline.url.exec(src)) {
      let text, href;
      if (cap[2] === "@") {
        text = escape$1(cap[0]);
        href = "mailto:" + text;
      } else {
        let prevCapZero;
        do {
          prevCapZero = cap[0];
          cap[0] = this.rules.inline._backpedal.exec(cap[0])?.[0] ?? "";
        } while (prevCapZero !== cap[0]);
        text = escape$1(cap[0]);
        if (cap[1] === "www.") {
          href = "http://" + cap[0];
        } else {
          href = cap[0];
        }
      }
      return {
        type: "link",
        raw: cap[0],
        text,
        href,
        tokens: [
          {
            type: "text",
            raw: text,
            text
          }
        ]
      };
    }
  }
  inlineText(src) {
    const cap = this.rules.inline.text.exec(src);
    if (cap) {
      let text;
      if (this.lexer.state.inRawBlock) {
        text = cap[0];
      } else {
        text = escape$1(cap[0]);
      }
      return {
        type: "text",
        raw: cap[0],
        text
      };
    }
  }
};
var newline = /^(?: *(?:\n|$))+/;
var blockCode = /^( {4}[^\n]+(?:\n(?: *(?:\n|$))*)?)+/;
var fences = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var hr = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var heading = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var bullet = /(?:[*+-]|\d{1,9}[.)])/;
var lheading = edit(/^(?!bull |blockCode|fences|blockquote|heading|html)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html))+?)\n {0,3}(=+|-+) *(?:\n+|$)/).replace(/bull/g, bullet).replace(/blockCode/g, / {4}/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).getRegex();
var _paragraph = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/;
var blockText = /^[^\n]+/;
var _blockLabel = /(?!\s*\])(?:\\.|[^\[\]\\])+/;
var def = edit(/^ {0,3}\[(label)\]: *(?:\n *)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n *)?| *\n *)(title))? *(?:\n+|$)/).replace("label", _blockLabel).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var list = edit(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g, bullet).getRegex();
var _tag = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var _comment = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var html = edit("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n *)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n *)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n *)+\\n|$))", "i").replace("comment", _comment).replace("tag", _tag).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var paragraph = edit(_paragraph).replace("hr", hr).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", _tag).getRegex();
var blockquote = edit(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", paragraph).getRegex();
var blockNormal = {
  blockquote,
  code: blockCode,
  def,
  fences,
  heading,
  hr,
  html,
  lheading,
  list,
  newline,
  paragraph,
  table: noopTest,
  text: blockText
};
var gfmTable = edit("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", hr).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", " {4}[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", _tag).getRegex();
var blockGfm = {
  ...blockNormal,
  table: gfmTable,
  paragraph: edit(_paragraph).replace("hr", hr).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", gfmTable).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", _tag).getRegex()
};
var blockPedantic = {
  ...blockNormal,
  html: edit(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", _comment).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),
  def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
  heading: /^(#{1,6})(.*)(?:\n+|$)/,
  fences: noopTest,
  // fences not supported
  lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
  paragraph: edit(_paragraph).replace("hr", hr).replace("heading", " *#{1,6} *[^\n]").replace("lheading", lheading).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex()
};
var escape = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var inlineCode = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var br = /^( {2,}|\\)\n(?!\s*$)/;
var inlineText = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var _punctuation = "\\p{P}\\p{S}";
var punctuation = edit(/^((?![*_])[\spunctuation])/, "u").replace(/punctuation/g, _punctuation).getRegex();
var blockSkip = /\[[^[\]]*?\]\([^\(\)]*?\)|`[^`]*?`|<[^<>]*?>/g;
var emStrongLDelim = edit(/^(?:\*+(?:((?!\*)[punct])|[^\s*]))|^_+(?:((?!_)[punct])|([^\s_]))/, "u").replace(/punct/g, _punctuation).getRegex();
var emStrongRDelimAst = edit("^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)[punct](\\*+)(?=[\\s]|$)|[^punct\\s](\\*+)(?!\\*)(?=[punct\\s]|$)|(?!\\*)[punct\\s](\\*+)(?=[^punct\\s])|[\\s](\\*+)(?!\\*)(?=[punct])|(?!\\*)[punct](\\*+)(?!\\*)(?=[punct])|[^punct\\s](\\*+)(?=[^punct\\s])", "gu").replace(/punct/g, _punctuation).getRegex();
var emStrongRDelimUnd = edit("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)[punct](_+)(?=[\\s]|$)|[^punct\\s](_+)(?!_)(?=[punct\\s]|$)|(?!_)[punct\\s](_+)(?=[^punct\\s])|[\\s](_+)(?!_)(?=[punct])|(?!_)[punct](_+)(?!_)(?=[punct])", "gu").replace(/punct/g, _punctuation).getRegex();
var anyPunctuation = edit(/\\([punct])/, "gu").replace(/punct/g, _punctuation).getRegex();
var autolink = edit(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var _inlineComment = edit(_comment).replace("(?:-->|$)", "-->").getRegex();
var tag = edit("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", _inlineComment).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var _inlineLabel = /(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/;
var link = edit(/^!?\[(label)\]\(\s*(href)(?:\s+(title))?\s*\)/).replace("label", _inlineLabel).replace("href", /<(?:\\.|[^\n<>\\])+>|[^\s\x00-\x1f]*/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var reflink = edit(/^!?\[(label)\]\[(ref)\]/).replace("label", _inlineLabel).replace("ref", _blockLabel).getRegex();
var nolink = edit(/^!?\[(ref)\](?:\[\])?/).replace("ref", _blockLabel).getRegex();
var reflinkSearch = edit("reflink|nolink(?!\\()", "g").replace("reflink", reflink).replace("nolink", nolink).getRegex();
var inlineNormal = {
  _backpedal: noopTest,
  // only used for GFM url
  anyPunctuation,
  autolink,
  blockSkip,
  br,
  code: inlineCode,
  del: noopTest,
  emStrongLDelim,
  emStrongRDelimAst,
  emStrongRDelimUnd,
  escape,
  link,
  nolink,
  punctuation,
  reflink,
  reflinkSearch,
  tag,
  text: inlineText,
  url: noopTest
};
var inlinePedantic = {
  ...inlineNormal,
  link: edit(/^!?\[(label)\]\((.*?)\)/).replace("label", _inlineLabel).getRegex(),
  reflink: edit(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", _inlineLabel).getRegex()
};
var inlineGfm = {
  ...inlineNormal,
  escape: edit(escape).replace("])", "~|])").getRegex(),
  url: edit(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/, "i").replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),
  _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
  del: /^(~~?)(?=[^\s~])([\s\S]*?[^\s~])\1(?=[^~]|$)/,
  text: /^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/
};
var inlineBreaks = {
  ...inlineGfm,
  br: edit(br).replace("{2,}", "*").getRegex(),
  text: edit(inlineGfm.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex()
};
var block = {
  normal: blockNormal,
  gfm: blockGfm,
  pedantic: blockPedantic
};
var inline = {
  normal: inlineNormal,
  gfm: inlineGfm,
  breaks: inlineBreaks,
  pedantic: inlinePedantic
};
var _Lexer = class __Lexer {
  tokens;
  options;
  state;
  tokenizer;
  inlineQueue;
  constructor(options2) {
    this.tokens = [];
    this.tokens.links = /* @__PURE__ */ Object.create(null);
    this.options = options2 || _defaults;
    this.options.tokenizer = this.options.tokenizer || new _Tokenizer();
    this.tokenizer = this.options.tokenizer;
    this.tokenizer.options = this.options;
    this.tokenizer.lexer = this;
    this.inlineQueue = [];
    this.state = {
      inLink: false,
      inRawBlock: false,
      top: true
    };
    const rules = {
      block: block.normal,
      inline: inline.normal
    };
    if (this.options.pedantic) {
      rules.block = block.pedantic;
      rules.inline = inline.pedantic;
    } else if (this.options.gfm) {
      rules.block = block.gfm;
      if (this.options.breaks) {
        rules.inline = inline.breaks;
      } else {
        rules.inline = inline.gfm;
      }
    }
    this.tokenizer.rules = rules;
  }
  /**
   * Expose Rules
   */
  static get rules() {
    return {
      block,
      inline
    };
  }
  /**
   * Static Lex Method
   */
  static lex(src, options2) {
    const lexer2 = new __Lexer(options2);
    return lexer2.lex(src);
  }
  /**
   * Static Lex Inline Method
   */
  static lexInline(src, options2) {
    const lexer2 = new __Lexer(options2);
    return lexer2.inlineTokens(src);
  }
  /**
   * Preprocessing
   */
  lex(src) {
    src = src.replace(/\r\n|\r/g, "\n");
    this.blockTokens(src, this.tokens);
    for (let i = 0; i < this.inlineQueue.length; i++) {
      const next = this.inlineQueue[i];
      this.inlineTokens(next.src, next.tokens);
    }
    this.inlineQueue = [];
    return this.tokens;
  }
  blockTokens(src, tokens = []) {
    if (this.options.pedantic) {
      src = src.replace(/\t/g, "    ").replace(/^ +$/gm, "");
    } else {
      src = src.replace(/^( *)(\t+)/gm, (_, leading, tabs) => {
        return leading + "    ".repeat(tabs.length);
      });
    }
    let token;
    let lastToken;
    let cutSrc;
    let lastParagraphClipped;
    while (src) {
      if (this.options.extensions && this.options.extensions.block && this.options.extensions.block.some((extTokenizer) => {
        if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          return true;
        }
        return false;
      })) {
        continue;
      }
      if (token = this.tokenizer.space(src)) {
        src = src.substring(token.raw.length);
        if (token.raw.length === 1 && tokens.length > 0) {
          tokens[tokens.length - 1].raw += "\n";
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (token = this.tokenizer.code(src)) {
        src = src.substring(token.raw.length);
        lastToken = tokens[tokens.length - 1];
        if (lastToken && (lastToken.type === "paragraph" || lastToken.type === "text")) {
          lastToken.raw += "\n" + token.raw;
          lastToken.text += "\n" + token.text;
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (token = this.tokenizer.fences(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.heading(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.hr(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.blockquote(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.list(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.html(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.def(src)) {
        src = src.substring(token.raw.length);
        lastToken = tokens[tokens.length - 1];
        if (lastToken && (lastToken.type === "paragraph" || lastToken.type === "text")) {
          lastToken.raw += "\n" + token.raw;
          lastToken.text += "\n" + token.raw;
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else if (!this.tokens.links[token.tag]) {
          this.tokens.links[token.tag] = {
            href: token.href,
            title: token.title
          };
        }
        continue;
      }
      if (token = this.tokenizer.table(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.lheading(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      cutSrc = src;
      if (this.options.extensions && this.options.extensions.startBlock) {
        let startIndex = Infinity;
        const tempSrc = src.slice(1);
        let tempStart;
        this.options.extensions.startBlock.forEach((getStartIndex) => {
          tempStart = getStartIndex.call({ lexer: this }, tempSrc);
          if (typeof tempStart === "number" && tempStart >= 0) {
            startIndex = Math.min(startIndex, tempStart);
          }
        });
        if (startIndex < Infinity && startIndex >= 0) {
          cutSrc = src.substring(0, startIndex + 1);
        }
      }
      if (this.state.top && (token = this.tokenizer.paragraph(cutSrc))) {
        lastToken = tokens[tokens.length - 1];
        if (lastParagraphClipped && lastToken.type === "paragraph") {
          lastToken.raw += "\n" + token.raw;
          lastToken.text += "\n" + token.text;
          this.inlineQueue.pop();
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else {
          tokens.push(token);
        }
        lastParagraphClipped = cutSrc.length !== src.length;
        src = src.substring(token.raw.length);
        continue;
      }
      if (token = this.tokenizer.text(src)) {
        src = src.substring(token.raw.length);
        lastToken = tokens[tokens.length - 1];
        if (lastToken && lastToken.type === "text") {
          lastToken.raw += "\n" + token.raw;
          lastToken.text += "\n" + token.text;
          this.inlineQueue.pop();
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (src) {
        const errMsg = "Infinite loop on byte: " + src.charCodeAt(0);
        if (this.options.silent) {
          console.error(errMsg);
          break;
        } else {
          throw new Error(errMsg);
        }
      }
    }
    this.state.top = true;
    return tokens;
  }
  inline(src, tokens = []) {
    this.inlineQueue.push({ src, tokens });
    return tokens;
  }
  /**
   * Lexing/Compiling
   */
  inlineTokens(src, tokens = []) {
    let token, lastToken, cutSrc;
    let maskedSrc = src;
    let match;
    let keepPrevChar, prevChar;
    if (this.tokens.links) {
      const links = Object.keys(this.tokens.links);
      if (links.length > 0) {
        while ((match = this.tokenizer.rules.inline.reflinkSearch.exec(maskedSrc)) != null) {
          if (links.includes(match[0].slice(match[0].lastIndexOf("[") + 1, -1))) {
            maskedSrc = maskedSrc.slice(0, match.index) + "[" + "a".repeat(match[0].length - 2) + "]" + maskedSrc.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex);
          }
        }
      }
    }
    while ((match = this.tokenizer.rules.inline.blockSkip.exec(maskedSrc)) != null) {
      maskedSrc = maskedSrc.slice(0, match.index) + "[" + "a".repeat(match[0].length - 2) + "]" + maskedSrc.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
    }
    while ((match = this.tokenizer.rules.inline.anyPunctuation.exec(maskedSrc)) != null) {
      maskedSrc = maskedSrc.slice(0, match.index) + "++" + maskedSrc.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
    }
    while (src) {
      if (!keepPrevChar) {
        prevChar = "";
      }
      keepPrevChar = false;
      if (this.options.extensions && this.options.extensions.inline && this.options.extensions.inline.some((extTokenizer) => {
        if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          return true;
        }
        return false;
      })) {
        continue;
      }
      if (token = this.tokenizer.escape(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.tag(src)) {
        src = src.substring(token.raw.length);
        lastToken = tokens[tokens.length - 1];
        if (lastToken && token.type === "text" && lastToken.type === "text") {
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (token = this.tokenizer.link(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.reflink(src, this.tokens.links)) {
        src = src.substring(token.raw.length);
        lastToken = tokens[tokens.length - 1];
        if (lastToken && token.type === "text" && lastToken.type === "text") {
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (token = this.tokenizer.emStrong(src, maskedSrc, prevChar)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.codespan(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.br(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.del(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.autolink(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (!this.state.inLink && (token = this.tokenizer.url(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      cutSrc = src;
      if (this.options.extensions && this.options.extensions.startInline) {
        let startIndex = Infinity;
        const tempSrc = src.slice(1);
        let tempStart;
        this.options.extensions.startInline.forEach((getStartIndex) => {
          tempStart = getStartIndex.call({ lexer: this }, tempSrc);
          if (typeof tempStart === "number" && tempStart >= 0) {
            startIndex = Math.min(startIndex, tempStart);
          }
        });
        if (startIndex < Infinity && startIndex >= 0) {
          cutSrc = src.substring(0, startIndex + 1);
        }
      }
      if (token = this.tokenizer.inlineText(cutSrc)) {
        src = src.substring(token.raw.length);
        if (token.raw.slice(-1) !== "_") {
          prevChar = token.raw.slice(-1);
        }
        keepPrevChar = true;
        lastToken = tokens[tokens.length - 1];
        if (lastToken && lastToken.type === "text") {
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (src) {
        const errMsg = "Infinite loop on byte: " + src.charCodeAt(0);
        if (this.options.silent) {
          console.error(errMsg);
          break;
        } else {
          throw new Error(errMsg);
        }
      }
    }
    return tokens;
  }
};
var _Renderer = class {
  options;
  constructor(options2) {
    this.options = options2 || _defaults;
  }
  code(code, infostring, escaped) {
    const lang = (infostring || "").match(/^\S*/)?.[0];
    code = code.replace(/\n$/, "") + "\n";
    if (!lang) {
      return "<pre><code>" + (escaped ? code : escape$1(code, true)) + "</code></pre>\n";
    }
    return '<pre><code class="language-' + escape$1(lang) + '">' + (escaped ? code : escape$1(code, true)) + "</code></pre>\n";
  }
  blockquote(quote2) {
    return `<blockquote>
${quote2}</blockquote>
`;
  }
  html(html2, block2) {
    return html2;
  }
  heading(text, level, raw) {
    return `<h${level}>${text}</h${level}>
`;
  }
  hr() {
    return "<hr>\n";
  }
  list(body, ordered, start) {
    const type = ordered ? "ol" : "ul";
    const startatt = ordered && start !== 1 ? ' start="' + start + '"' : "";
    return "<" + type + startatt + ">\n" + body + "</" + type + ">\n";
  }
  listitem(text, task, checked) {
    return `<li>${text}</li>
`;
  }
  checkbox(checked) {
    return "<input " + (checked ? 'checked="" ' : "") + 'disabled="" type="checkbox">';
  }
  paragraph(text) {
    return `<p>${text}</p>
`;
  }
  table(header, body) {
    if (body)
      body = `<tbody>${body}</tbody>`;
    return "<table>\n<thead>\n" + header + "</thead>\n" + body + "</table>\n";
  }
  tablerow(content) {
    return `<tr>
${content}</tr>
`;
  }
  tablecell(content, flags) {
    const type = flags.header ? "th" : "td";
    const tag2 = flags.align ? `<${type} align="${flags.align}">` : `<${type}>`;
    return tag2 + content + `</${type}>
`;
  }
  /**
   * span level renderer
   */
  strong(text) {
    return `<strong>${text}</strong>`;
  }
  em(text) {
    return `<em>${text}</em>`;
  }
  codespan(text) {
    return `<code>${text}</code>`;
  }
  br() {
    return "<br>";
  }
  del(text) {
    return `<del>${text}</del>`;
  }
  link(href, title, text) {
    const cleanHref = cleanUrl(href);
    if (cleanHref === null) {
      return text;
    }
    href = cleanHref;
    let out = '<a href="' + href + '"';
    if (title) {
      out += ' title="' + title + '"';
    }
    out += ">" + text + "</a>";
    return out;
  }
  image(href, title, text) {
    const cleanHref = cleanUrl(href);
    if (cleanHref === null) {
      return text;
    }
    href = cleanHref;
    let out = `<img src="${href}" alt="${text}"`;
    if (title) {
      out += ` title="${title}"`;
    }
    out += ">";
    return out;
  }
  text(text) {
    return text;
  }
};
var _TextRenderer = class {
  // no need for block level renderers
  strong(text) {
    return text;
  }
  em(text) {
    return text;
  }
  codespan(text) {
    return text;
  }
  del(text) {
    return text;
  }
  html(text) {
    return text;
  }
  text(text) {
    return text;
  }
  link(href, title, text) {
    return "" + text;
  }
  image(href, title, text) {
    return "" + text;
  }
  br() {
    return "";
  }
};
var _Parser = class __Parser {
  options;
  renderer;
  textRenderer;
  constructor(options2) {
    this.options = options2 || _defaults;
    this.options.renderer = this.options.renderer || new _Renderer();
    this.renderer = this.options.renderer;
    this.renderer.options = this.options;
    this.textRenderer = new _TextRenderer();
  }
  /**
   * Static Parse Method
   */
  static parse(tokens, options2) {
    const parser2 = new __Parser(options2);
    return parser2.parse(tokens);
  }
  /**
   * Static Parse Inline Method
   */
  static parseInline(tokens, options2) {
    const parser2 = new __Parser(options2);
    return parser2.parseInline(tokens);
  }
  /**
   * Parse Loop
   */
  parse(tokens, top = true) {
    let out = "";
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (this.options.extensions && this.options.extensions.renderers && this.options.extensions.renderers[token.type]) {
        const genericToken = token;
        const ret = this.options.extensions.renderers[genericToken.type].call({ parser: this }, genericToken);
        if (ret !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "html", "paragraph", "text"].includes(genericToken.type)) {
          out += ret || "";
          continue;
        }
      }
      switch (token.type) {
        case "space": {
          continue;
        }
        case "hr": {
          out += this.renderer.hr();
          continue;
        }
        case "heading": {
          const headingToken = token;
          out += this.renderer.heading(this.parseInline(headingToken.tokens), headingToken.depth, unescape(this.parseInline(headingToken.tokens, this.textRenderer)));
          continue;
        }
        case "code": {
          const codeToken = token;
          out += this.renderer.code(codeToken.text, codeToken.lang, !!codeToken.escaped);
          continue;
        }
        case "table": {
          const tableToken = token;
          let header = "";
          let cell = "";
          for (let j = 0; j < tableToken.header.length; j++) {
            cell += this.renderer.tablecell(this.parseInline(tableToken.header[j].tokens), { header: true, align: tableToken.align[j] });
          }
          header += this.renderer.tablerow(cell);
          let body = "";
          for (let j = 0; j < tableToken.rows.length; j++) {
            const row = tableToken.rows[j];
            cell = "";
            for (let k = 0; k < row.length; k++) {
              cell += this.renderer.tablecell(this.parseInline(row[k].tokens), { header: false, align: tableToken.align[k] });
            }
            body += this.renderer.tablerow(cell);
          }
          out += this.renderer.table(header, body);
          continue;
        }
        case "blockquote": {
          const blockquoteToken = token;
          const body = this.parse(blockquoteToken.tokens);
          out += this.renderer.blockquote(body);
          continue;
        }
        case "list": {
          const listToken = token;
          const ordered = listToken.ordered;
          const start = listToken.start;
          const loose = listToken.loose;
          let body = "";
          for (let j = 0; j < listToken.items.length; j++) {
            const item = listToken.items[j];
            const checked = item.checked;
            const task = item.task;
            let itemBody = "";
            if (item.task) {
              const checkbox = this.renderer.checkbox(!!checked);
              if (loose) {
                if (item.tokens.length > 0 && item.tokens[0].type === "paragraph") {
                  item.tokens[0].text = checkbox + " " + item.tokens[0].text;
                  if (item.tokens[0].tokens && item.tokens[0].tokens.length > 0 && item.tokens[0].tokens[0].type === "text") {
                    item.tokens[0].tokens[0].text = checkbox + " " + item.tokens[0].tokens[0].text;
                  }
                } else {
                  item.tokens.unshift({
                    type: "text",
                    text: checkbox + " "
                  });
                }
              } else {
                itemBody += checkbox + " ";
              }
            }
            itemBody += this.parse(item.tokens, loose);
            body += this.renderer.listitem(itemBody, task, !!checked);
          }
          out += this.renderer.list(body, ordered, start);
          continue;
        }
        case "html": {
          const htmlToken = token;
          out += this.renderer.html(htmlToken.text, htmlToken.block);
          continue;
        }
        case "paragraph": {
          const paragraphToken = token;
          out += this.renderer.paragraph(this.parseInline(paragraphToken.tokens));
          continue;
        }
        case "text": {
          let textToken = token;
          let body = textToken.tokens ? this.parseInline(textToken.tokens) : textToken.text;
          while (i + 1 < tokens.length && tokens[i + 1].type === "text") {
            textToken = tokens[++i];
            body += "\n" + (textToken.tokens ? this.parseInline(textToken.tokens) : textToken.text);
          }
          out += top ? this.renderer.paragraph(body) : body;
          continue;
        }
        default: {
          const errMsg = 'Token with "' + token.type + '" type was not found.';
          if (this.options.silent) {
            console.error(errMsg);
            return "";
          } else {
            throw new Error(errMsg);
          }
        }
      }
    }
    return out;
  }
  /**
   * Parse Inline Tokens
   */
  parseInline(tokens, renderer) {
    renderer = renderer || this.renderer;
    let out = "";
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (this.options.extensions && this.options.extensions.renderers && this.options.extensions.renderers[token.type]) {
        const ret = this.options.extensions.renderers[token.type].call({ parser: this }, token);
        if (ret !== false || !["escape", "html", "link", "image", "strong", "em", "codespan", "br", "del", "text"].includes(token.type)) {
          out += ret || "";
          continue;
        }
      }
      switch (token.type) {
        case "escape": {
          const escapeToken = token;
          out += renderer.text(escapeToken.text);
          break;
        }
        case "html": {
          const tagToken = token;
          out += renderer.html(tagToken.text);
          break;
        }
        case "link": {
          const linkToken = token;
          out += renderer.link(linkToken.href, linkToken.title, this.parseInline(linkToken.tokens, renderer));
          break;
        }
        case "image": {
          const imageToken = token;
          out += renderer.image(imageToken.href, imageToken.title, imageToken.text);
          break;
        }
        case "strong": {
          const strongToken = token;
          out += renderer.strong(this.parseInline(strongToken.tokens, renderer));
          break;
        }
        case "em": {
          const emToken = token;
          out += renderer.em(this.parseInline(emToken.tokens, renderer));
          break;
        }
        case "codespan": {
          const codespanToken = token;
          out += renderer.codespan(codespanToken.text);
          break;
        }
        case "br": {
          out += renderer.br();
          break;
        }
        case "del": {
          const delToken = token;
          out += renderer.del(this.parseInline(delToken.tokens, renderer));
          break;
        }
        case "text": {
          const textToken = token;
          out += renderer.text(textToken.text);
          break;
        }
        default: {
          const errMsg = 'Token with "' + token.type + '" type was not found.';
          if (this.options.silent) {
            console.error(errMsg);
            return "";
          } else {
            throw new Error(errMsg);
          }
        }
      }
    }
    return out;
  }
};
var _Hooks = class {
  options;
  constructor(options2) {
    this.options = options2 || _defaults;
  }
  static passThroughHooks = /* @__PURE__ */ new Set([
    "preprocess",
    "postprocess",
    "processAllTokens"
  ]);
  /**
   * Process markdown before marked
   */
  preprocess(markdown) {
    return markdown;
  }
  /**
   * Process HTML after marked is finished
   */
  postprocess(html2) {
    return html2;
  }
  /**
   * Process all tokens before walk tokens
   */
  processAllTokens(tokens) {
    return tokens;
  }
};
var Marked = class {
  defaults = _getDefaults();
  options = this.setOptions;
  parse = this.#parseMarkdown(_Lexer.lex, _Parser.parse);
  parseInline = this.#parseMarkdown(_Lexer.lexInline, _Parser.parseInline);
  Parser = _Parser;
  Renderer = _Renderer;
  TextRenderer = _TextRenderer;
  Lexer = _Lexer;
  Tokenizer = _Tokenizer;
  Hooks = _Hooks;
  constructor(...args) {
    this.use(...args);
  }
  /**
   * Run callback for every token
   */
  walkTokens(tokens, callback) {
    let values = [];
    for (const token of tokens) {
      values = values.concat(callback.call(this, token));
      switch (token.type) {
        case "table": {
          const tableToken = token;
          for (const cell of tableToken.header) {
            values = values.concat(this.walkTokens(cell.tokens, callback));
          }
          for (const row of tableToken.rows) {
            for (const cell of row) {
              values = values.concat(this.walkTokens(cell.tokens, callback));
            }
          }
          break;
        }
        case "list": {
          const listToken = token;
          values = values.concat(this.walkTokens(listToken.items, callback));
          break;
        }
        default: {
          const genericToken = token;
          if (this.defaults.extensions?.childTokens?.[genericToken.type]) {
            this.defaults.extensions.childTokens[genericToken.type].forEach((childTokens) => {
              const tokens2 = genericToken[childTokens].flat(Infinity);
              values = values.concat(this.walkTokens(tokens2, callback));
            });
          } else if (genericToken.tokens) {
            values = values.concat(this.walkTokens(genericToken.tokens, callback));
          }
        }
      }
    }
    return values;
  }
  use(...args) {
    const extensions = this.defaults.extensions || { renderers: {}, childTokens: {} };
    args.forEach((pack) => {
      const opts = { ...pack };
      opts.async = this.defaults.async || opts.async || false;
      if (pack.extensions) {
        pack.extensions.forEach((ext) => {
          if (!ext.name) {
            throw new Error("extension name required");
          }
          if ("renderer" in ext) {
            const prevRenderer = extensions.renderers[ext.name];
            if (prevRenderer) {
              extensions.renderers[ext.name] = function(...args2) {
                let ret = ext.renderer.apply(this, args2);
                if (ret === false) {
                  ret = prevRenderer.apply(this, args2);
                }
                return ret;
              };
            } else {
              extensions.renderers[ext.name] = ext.renderer;
            }
          }
          if ("tokenizer" in ext) {
            if (!ext.level || ext.level !== "block" && ext.level !== "inline") {
              throw new Error("extension level must be 'block' or 'inline'");
            }
            const extLevel = extensions[ext.level];
            if (extLevel) {
              extLevel.unshift(ext.tokenizer);
            } else {
              extensions[ext.level] = [ext.tokenizer];
            }
            if (ext.start) {
              if (ext.level === "block") {
                if (extensions.startBlock) {
                  extensions.startBlock.push(ext.start);
                } else {
                  extensions.startBlock = [ext.start];
                }
              } else if (ext.level === "inline") {
                if (extensions.startInline) {
                  extensions.startInline.push(ext.start);
                } else {
                  extensions.startInline = [ext.start];
                }
              }
            }
          }
          if ("childTokens" in ext && ext.childTokens) {
            extensions.childTokens[ext.name] = ext.childTokens;
          }
        });
        opts.extensions = extensions;
      }
      if (pack.renderer) {
        const renderer = this.defaults.renderer || new _Renderer(this.defaults);
        for (const prop in pack.renderer) {
          if (!(prop in renderer)) {
            throw new Error(`renderer '${prop}' does not exist`);
          }
          if (prop === "options") {
            continue;
          }
          const rendererProp = prop;
          const rendererFunc = pack.renderer[rendererProp];
          const prevRenderer = renderer[rendererProp];
          renderer[rendererProp] = (...args2) => {
            let ret = rendererFunc.apply(renderer, args2);
            if (ret === false) {
              ret = prevRenderer.apply(renderer, args2);
            }
            return ret || "";
          };
        }
        opts.renderer = renderer;
      }
      if (pack.tokenizer) {
        const tokenizer = this.defaults.tokenizer || new _Tokenizer(this.defaults);
        for (const prop in pack.tokenizer) {
          if (!(prop in tokenizer)) {
            throw new Error(`tokenizer '${prop}' does not exist`);
          }
          if (["options", "rules", "lexer"].includes(prop)) {
            continue;
          }
          const tokenizerProp = prop;
          const tokenizerFunc = pack.tokenizer[tokenizerProp];
          const prevTokenizer = tokenizer[tokenizerProp];
          tokenizer[tokenizerProp] = (...args2) => {
            let ret = tokenizerFunc.apply(tokenizer, args2);
            if (ret === false) {
              ret = prevTokenizer.apply(tokenizer, args2);
            }
            return ret;
          };
        }
        opts.tokenizer = tokenizer;
      }
      if (pack.hooks) {
        const hooks = this.defaults.hooks || new _Hooks();
        for (const prop in pack.hooks) {
          if (!(prop in hooks)) {
            throw new Error(`hook '${prop}' does not exist`);
          }
          if (prop === "options") {
            continue;
          }
          const hooksProp = prop;
          const hooksFunc = pack.hooks[hooksProp];
          const prevHook = hooks[hooksProp];
          if (_Hooks.passThroughHooks.has(prop)) {
            hooks[hooksProp] = (arg) => {
              if (this.defaults.async) {
                return Promise.resolve(hooksFunc.call(hooks, arg)).then((ret2) => {
                  return prevHook.call(hooks, ret2);
                });
              }
              const ret = hooksFunc.call(hooks, arg);
              return prevHook.call(hooks, ret);
            };
          } else {
            hooks[hooksProp] = (...args2) => {
              let ret = hooksFunc.apply(hooks, args2);
              if (ret === false) {
                ret = prevHook.apply(hooks, args2);
              }
              return ret;
            };
          }
        }
        opts.hooks = hooks;
      }
      if (pack.walkTokens) {
        const walkTokens2 = this.defaults.walkTokens;
        const packWalktokens = pack.walkTokens;
        opts.walkTokens = function(token) {
          let values = [];
          values.push(packWalktokens.call(this, token));
          if (walkTokens2) {
            values = values.concat(walkTokens2.call(this, token));
          }
          return values;
        };
      }
      this.defaults = { ...this.defaults, ...opts };
    });
    return this;
  }
  setOptions(opt) {
    this.defaults = { ...this.defaults, ...opt };
    return this;
  }
  lexer(src, options2) {
    return _Lexer.lex(src, options2 ?? this.defaults);
  }
  parser(tokens, options2) {
    return _Parser.parse(tokens, options2 ?? this.defaults);
  }
  #parseMarkdown(lexer2, parser2) {
    return (src, options2) => {
      const origOpt = { ...options2 };
      const opt = { ...this.defaults, ...origOpt };
      if (this.defaults.async === true && origOpt.async === false) {
        if (!opt.silent) {
          console.warn("marked(): The async option was set to true by an extension. The async: false option sent to parse will be ignored.");
        }
        opt.async = true;
      }
      const throwError = this.#onError(!!opt.silent, !!opt.async);
      if (typeof src === "undefined" || src === null) {
        return throwError(new Error("marked(): input parameter is undefined or null"));
      }
      if (typeof src !== "string") {
        return throwError(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(src) + ", string expected"));
      }
      if (opt.hooks) {
        opt.hooks.options = opt;
      }
      if (opt.async) {
        return Promise.resolve(opt.hooks ? opt.hooks.preprocess(src) : src).then((src2) => lexer2(src2, opt)).then((tokens) => opt.hooks ? opt.hooks.processAllTokens(tokens) : tokens).then((tokens) => opt.walkTokens ? Promise.all(this.walkTokens(tokens, opt.walkTokens)).then(() => tokens) : tokens).then((tokens) => parser2(tokens, opt)).then((html2) => opt.hooks ? opt.hooks.postprocess(html2) : html2).catch(throwError);
      }
      try {
        if (opt.hooks) {
          src = opt.hooks.preprocess(src);
        }
        let tokens = lexer2(src, opt);
        if (opt.hooks) {
          tokens = opt.hooks.processAllTokens(tokens);
        }
        if (opt.walkTokens) {
          this.walkTokens(tokens, opt.walkTokens);
        }
        let html2 = parser2(tokens, opt);
        if (opt.hooks) {
          html2 = opt.hooks.postprocess(html2);
        }
        return html2;
      } catch (e) {
        return throwError(e);
      }
    };
  }
  #onError(silent, async) {
    return (e) => {
      e.message += "\nPlease report this to https://github.com/markedjs/marked.";
      if (silent) {
        const msg = "<p>An error occurred:</p><pre>" + escape$1(e.message + "", true) + "</pre>";
        if (async) {
          return Promise.resolve(msg);
        }
        return msg;
      }
      if (async) {
        return Promise.reject(e);
      }
      throw e;
    };
  }
};
var markedInstance = new Marked();
function marked(src, opt) {
  return markedInstance.parse(src, opt);
}
marked.options = marked.setOptions = function(options2) {
  markedInstance.setOptions(options2);
  marked.defaults = markedInstance.defaults;
  changeDefaults(marked.defaults);
  return marked;
};
marked.getDefaults = _getDefaults;
marked.defaults = _defaults;
marked.use = function(...args) {
  markedInstance.use(...args);
  marked.defaults = markedInstance.defaults;
  changeDefaults(marked.defaults);
  return marked;
};
marked.walkTokens = function(tokens, callback) {
  return markedInstance.walkTokens(tokens, callback);
};
marked.parseInline = markedInstance.parseInline;
marked.Parser = _Parser;
marked.parser = _Parser.parse;
marked.Renderer = _Renderer;
marked.TextRenderer = _TextRenderer;
marked.Lexer = _Lexer;
marked.lexer = _Lexer.lex;
marked.Tokenizer = _Tokenizer;
marked.Hooks = _Hooks;
marked.parse = marked;
var options = marked.options;
var setOptions = marked.setOptions;
var use = marked.use;
var walkTokens = marked.walkTokens;
var parseInline = marked.parseInline;
var parser = _Parser.parse;
var lexer = _Lexer.lex;

// src/storage.ts
var INVALID_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
var NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\xA0",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  minus: "\u2212",
  ldquo: "\u201C",
  rdquo: "\u201D",
  lsquo: "\u2018",
  rsquo: "\u2019",
  laquo: "\xAB",
  raquo: "\xBB",
  bull: "\u2022",
  middot: "\xB7",
  copy: "\xA9",
  reg: "\xAE",
  trade: "\u2122",
  deg: "\xB0",
  times: "\xD7",
  divide: "\xF7",
  plusmn: "\xB1",
  sect: "\xA7",
  para: "\xB6",
  dagger: "\u2020",
  euro: "\u20AC",
  pound: "\xA3",
  yen: "\xA5",
  cent: "\xA2",
  frac12: "\xBD",
  frac14: "\xBC",
  frac34: "\xBE",
  sup2: "\xB2",
  sup3: "\xB3",
  larr: "\u2190",
  rarr: "\u2192",
  harr: "\u2194",
  checkmark: "\u2713"
};
function decodeEntities(s) {
  if (!s.includes("&"))
    return s;
  return s.replace(/&(#\d{1,7}|#[Xx][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 1114111)
        return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named !== void 0 ? named : match;
  });
}
function esc(s) {
  return decodeEntities(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var LANGUAGE_MAP = {
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  c: "cpp",
  "c++": "cpp",
  cpp: "cpp",
  "c#": "c#",
  cs: "c#",
  csharp: "c#",
  css: "css",
  scss: "sass",
  sass: "sass",
  less: "css",
  diff: "diff",
  patch: "diff",
  go: "go",
  golang: "go",
  groovy: "groovy",
  java: "java",
  scala: "scala",
  kotlin: "java",
  js: "js",
  javascript: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  ts: "js",
  typescript: "js",
  tsx: "js",
  json: "js",
  json5: "js",
  html: "xml",
  xhtml: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  md: "text",
  markdown: "text",
  text: "text",
  txt: "text",
  plaintext: "text",
  perl: "perl",
  php: "php",
  powershell: "powershell",
  ps1: "powershell",
  py: "py",
  python: "py",
  rb: "ruby",
  ruby: "ruby",
  sql: "sql",
  mysql: "sql",
  postgres: "sql",
  postgresql: "sql",
  vb: "vb",
  "vb.net": "vb",
  yml: "yaml",
  yaml: "yaml",
  actionscript: "actionscript3",
  applescript: "applescript",
  coldfusion: "coldfusion",
  delphi: "delphi",
  erlang: "erl"
};
var CALLOUT_MAP = {
  note: "info",
  info: "info",
  todo: "info",
  abstract: "info",
  summary: "info",
  tldr: "info",
  question: "info",
  help: "info",
  faq: "info",
  example: "info",
  quote: "info",
  cite: "info",
  tip: "tip",
  hint: "tip",
  important: "tip",
  success: "tip",
  check: "tip",
  done: "tip",
  warning: "note",
  caution: "note",
  attention: "note",
  danger: "warning",
  error: "warning",
  bug: "warning",
  failure: "warning",
  fail: "warning",
  missing: "warning"
};
var HTML_PASSTHROUGH = /^<(br|hr)\s*\/?>$|^<\/?(b|i|u|s|em|strong|sup|sub|code|del|ins)>$/i;
function stripComments(markdown) {
  const lines = markdown.split("\n");
  const out = [];
  let inFence = false;
  let fenceMarker = "";
  let inComment = false;
  for (const line of lines) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence && !inComment) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1][0];
      } else if (fence[1][0] === fenceMarker) {
        inFence = false;
      }
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    let rest = line;
    let result = "";
    while (rest.length > 0) {
      if (inComment) {
        const end = rest.indexOf("%%");
        if (end === -1) {
          rest = "";
        } else {
          inComment = false;
          rest = rest.slice(end + 2);
        }
      } else {
        const start = rest.indexOf("%%");
        if (start === -1) {
          result += rest;
          rest = "";
        } else {
          result += rest.slice(0, start);
          inComment = true;
          rest = rest.slice(start + 2);
        }
      }
    }
    if (result.trim().length > 0 || line.trim().length === 0) {
      out.push(result);
    }
  }
  return out.join("\n");
}
function stripFrontmatter(markdown) {
  if (!markdown.startsWith("---"))
    return markdown;
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}
function buildLexer() {
  return new Marked({
    gfm: true,
    breaks: false,
    extensions: [
      {
        name: "embed",
        level: "inline",
        start(src) {
          const i = src.indexOf("![[");
          return i === -1 ? void 0 : i;
        },
        tokenizer(src) {
          const m = /^!\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/.exec(src);
          if (!m)
            return void 0;
          const token = {
            type: "embed",
            raw: m[0],
            target: m[1].trim(),
            size: m[2] ? m[2].trim() : null
          };
          return token;
        }
      },
      {
        name: "wikilink",
        level: "inline",
        start(src) {
          const i = src.indexOf("[[");
          return i === -1 ? void 0 : i;
        },
        tokenizer(src) {
          const m = /^\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/.exec(src);
          if (!m)
            return void 0;
          const token = {
            type: "wikilink",
            raw: m[0],
            target: m[1].trim(),
            alias: m[2] ? m[2].trim() : null
          };
          return token;
        }
      },
      {
        name: "highlight",
        level: "inline",
        start(src) {
          const i = src.indexOf("==");
          return i === -1 ? void 0 : i;
        },
        tokenizer(src) {
          const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
          if (!m)
            return void 0;
          const token = {
            type: "highlight",
            raw: m[0],
            tokens: this.lexer.inlineTokens(m[1])
          };
          return token;
        }
      }
    ]
  });
}
var StorageConverter = class {
  constructor(ctx) {
    this.attachments = /* @__PURE__ */ new Map();
    this.warnings = [];
    this.ctx = ctx;
    this.lexer = buildLexer();
  }
  convert(markdown, opts = {}) {
    this.attachments = /* @__PURE__ */ new Map();
    this.warnings = [];
    const source = stripComments(stripFrontmatter(markdown)).replace(INVALID_XML_CHARS, "");
    let tokens = this.lexer.lexer(source);
    tokens = this.dropRedundantTitle(tokens, opts.skipFirstHeading);
    const storage = this.renderBlocks(tokens).trim();
    return {
      storage,
      attachments: [...this.attachments.values()],
      warnings: [...this.warnings]
    };
  }
  /**
   * Notes usually open with an H1 repeating the note title. Confluence renders
   * the page title above the body, so keeping it duplicates the heading.
   */
  dropRedundantTitle(tokens, title) {
    if (!title)
      return tokens;
    const first = tokens.find((t) => t.type !== "space");
    if (!first || first.type !== "heading")
      return tokens;
    const heading2 = first;
    if (heading2.depth !== 1)
      return tokens;
    if (heading2.text.trim().toLowerCase() !== title.trim().toLowerCase())
      return tokens;
    return tokens.filter((t) => t !== first);
  }
  warn(message) {
    if (!this.warnings.includes(message))
      this.warnings.push(message);
  }
  // ---------------------------------------------------------------- blocks
  renderBlocks(tokens) {
    let out = "";
    for (const token of tokens) {
      out += this.renderBlock(token);
    }
    return out;
  }
  renderBlock(token) {
    switch (token.type) {
      case "space":
        return "";
      case "heading": {
        const t = token;
        const depth = Math.min(Math.max(t.depth, 1), 6);
        return `<h${depth}>${this.renderInline(t.tokens)}</h${depth}>`;
      }
      case "paragraph": {
        const t = token;
        const inner = this.renderInline(t.tokens);
        if (/^<ac:image[\s\S]*<\/ac:image>$/.test(inner))
          return inner;
        return inner.trim() ? `<p>${inner}</p>` : "";
      }
      case "text": {
        const t = token;
        const inner = t.tokens ? this.renderInline(t.tokens) : esc(t.text);
        return inner.trim() ? `<p>${inner}</p>` : "";
      }
      case "code":
        return this.renderCode(token);
      case "blockquote":
        return this.renderBlockquote(token);
      case "list":
        return this.renderList(token);
      case "table":
        return this.renderTable(token);
      case "hr":
        return "<hr />";
      case "html":
        return this.renderRawHtml(token.raw);
      case "def":
        return "";
      default:
        return `<p>${this.renderInline([token])}</p>`;
    }
  }
  renderCode(token) {
    const lang = (token.lang || "").trim().split(/\s+/)[0].toLowerCase();
    const mapped = LANGUAGE_MAP[lang];
    const params = mapped ? `<ac:parameter ac:name="language">${mapped}</ac:parameter>` : "";
    const body = token.text.replace(/\]\]>/g, "]]]]><![CDATA[>");
    return `<ac:structured-macro ac:name="code" ac:schema-version="1">` + params + `<ac:plain-text-body><![CDATA[${body}]]></ac:plain-text-body></ac:structured-macro>`;
  }
  /** Renders Obsidian callouts as admonition macros, plain quotes as blockquote. */
  renderBlockquote(token) {
    const callout = /^\s*\[!([A-Za-z-]+)\]([+-])?[ \t]*(.*)$/.exec(token.text.split("\n")[0] || "");
    if (!callout) {
      return `<blockquote>${this.renderBlocks(token.tokens)}</blockquote>`;
    }
    const kind = callout[1].toLowerCase();
    const macro = CALLOUT_MAP[kind] || "info";
    const title = callout[3].trim();
    const bodyMarkdown = token.text.split("\n").slice(1).join("\n");
    const bodyTokens = this.lexer.lexer(bodyMarkdown);
    const body = this.renderBlocks(bodyTokens);
    const titleParam = title ? `<ac:parameter ac:name="title">${esc(title)}</ac:parameter>` : "";
    return `<ac:structured-macro ac:name="${macro}" ac:schema-version="1">` + titleParam + `<ac:rich-text-body>${body || "<p />"}</ac:rich-text-body></ac:structured-macro>`;
  }
  /**
   * Checkbox items become Confluence tasks, which are a distinct element from
   * list items. A list mixing both is emitted as alternating runs so neither
   * kind is silently converted into the other.
   */
  renderList(token) {
    const runs = [];
    for (const item of token.items) {
      const isTask = item.task === true;
      const last = runs[runs.length - 1];
      if (last && last.task === isTask)
        last.items.push(item);
      else
        runs.push({ task: isTask, items: [item] });
    }
    let out = "";
    for (const run of runs) {
      if (run.task) {
        out += `<ac:task-list>`;
        for (const item of run.items) {
          const status = item.checked ? "complete" : "incomplete";
          out += `<ac:task><ac:task-status>${status}</ac:task-status>`;
          out += `<ac:task-body>${this.renderListItemBody(item)}</ac:task-body></ac:task>`;
        }
        out += `</ac:task-list>`;
      } else {
        const ordered = token.ordered;
        const startAttr = ordered && typeof token.start === "number" && token.start !== 1 ? ` start="${token.start}"` : "";
        const tag2 = ordered ? "ol" : "ul";
        out += `<${tag2}${startAttr}>`;
        for (const item of run.items) {
          out += `<li>${this.renderListItemBody(item)}</li>`;
        }
        out += `</${tag2}>`;
      }
    }
    return out;
  }
  /**
   * Tight list items hold inline content and must not gain a `<p>`, which would
   * add vertical space Confluence renders as a loose list.
   */
  renderListItemBody(item) {
    const blockTypes = /* @__PURE__ */ new Set([
      "paragraph",
      "list",
      "code",
      "blockquote",
      "table",
      "heading",
      "hr",
      "html"
    ]);
    const hasBlocks = item.tokens.some((t) => blockTypes.has(t.type));
    if (!hasBlocks) {
      const inline2 = item.tokens.flatMap(
        (t) => t.type === "text" && t.tokens ? t.tokens : [t]
      );
      return this.renderInline(inline2);
    }
    let out = "";
    for (const child of item.tokens) {
      if (child.type === "text") {
        const t = child;
        const inline2 = t.tokens ? this.renderInline(t.tokens) : esc(t.text);
        out += inline2.trim() ? inline2 : "";
      } else {
        out += this.renderBlock(child);
      }
    }
    return out;
  }
  renderTable(token) {
    const alignStyle = (i) => {
      const a = token.align[i];
      return a ? ` style="text-align: ${a};"` : "";
    };
    let out = "<table><tbody><tr>";
    token.header.forEach((cell, i) => {
      out += `<th${alignStyle(i)}><p>${this.renderInline(cell.tokens)}</p></th>`;
    });
    out += "</tr>";
    for (const row of token.rows) {
      out += "<tr>";
      row.forEach((cell, i) => {
        out += `<td${alignStyle(i)}><p>${this.renderInline(cell.tokens)}</p></td>`;
      });
      out += "</tr>";
    }
    return out + "</tbody></table>";
  }
  // ---------------------------------------------------------------- inline
  renderInline(tokens) {
    let out = "";
    for (const token of tokens) {
      out += this.renderInlineToken(token);
    }
    return out;
  }
  renderInlineToken(token) {
    switch (token.type) {
      case "text": {
        const t = token;
        return t.tokens ? this.renderInline(t.tokens) : esc(t.text);
      }
      case "escape":
        return esc(token.text);
      case "strong":
        return `<strong>${this.renderInline(token.tokens)}</strong>`;
      case "em":
        return `<em>${this.renderInline(token.tokens)}</em>`;
      case "del":
        return `<s>${this.renderInline(token.tokens)}</s>`;
      case "codespan":
        return `<code>${esc(token.text)}</code>`;
      case "br":
        return "<br />";
      case "link":
        return this.renderLink(token);
      case "image":
        return this.renderImage(token);
      case "html":
        return this.renderRawHtml(token.raw);
      case "highlight":
        return `<span style="background-color: rgb(254,222,200);">${this.renderInline(token.tokens)}</span>`;
      case "wikilink":
        return this.renderWikilink(token);
      case "embed":
        return this.renderEmbed(token);
      default: {
        const generic = token;
        if (generic.tokens)
          return this.renderInline(generic.tokens);
        return esc(generic.raw || "");
      }
    }
  }
  renderLink(token) {
    const text = this.renderInline(token.tokens) || esc(token.href);
    const href = token.href || "";
    if (/^(https?:|mailto:|ftp:|tel:)/i.test(href)) {
      const title = token.title ? ` title="${escAttr(token.title)}"` : "";
      return `<a href="${escAttr(href)}"${title}>${text}</a>`;
    }
    if (href.startsWith("#")) {
      return `<a href="${escAttr(href)}">${text}</a>`;
    }
    const resolved = this.ctx.resolveLink(decodeURIComponent(href.replace(/\.md$/i, "")));
    if (resolved)
      return `<a href="${escAttr(resolved)}">${text}</a>`;
    this.warn(`Link to "${href}" is not published to Confluence; kept as plain text.`);
    return text;
  }
  renderWikilink(token) {
    const [path3, anchor] = token.target.split("#");
    const label = token.alias || token.target.replace("#", " > ");
    const resolved = this.ctx.resolveLink(path3);
    if (resolved) {
      const href = anchor ? `${resolved}#${encodeURIComponent(anchor)}` : resolved;
      return `<a href="${escAttr(href)}">${esc(label)}</a>`;
    }
    this.warn(`"${path3}" is not published to Confluence; link kept as plain text.`);
    return esc(label);
  }
  renderImage(token) {
    const href = token.href || "";
    if (/^https?:/i.test(href)) {
      return this.imageMacro(`<ri:url ri:value="${escAttr(href)}" />`, token.text, null);
    }
    const attachment = this.ctx.resolveAttachment(decodeURIComponent(href));
    if (!attachment) {
      this.warn(`Image "${href}" was not found in the vault and was skipped.`);
      return esc(token.text || href);
    }
    this.attachments.set(attachment.filename, attachment);
    return this.imageMacro(
      `<ri:attachment ri:filename="${escAttr(attachment.filename)}" />`,
      token.text,
      null
    );
  }
  renderEmbed(token) {
    const attachment = this.ctx.resolveAttachment(token.target);
    if (!attachment) {
      const resolved = this.ctx.resolveLink(token.target.split("#")[0]);
      if (resolved) {
        return `<a href="${escAttr(resolved)}">${esc(token.target)}</a>`;
      }
      this.warn(`Embed "${token.target}" could not be resolved and was skipped.`);
      return esc(`![[${token.target}]]`);
    }
    if (!/\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(attachment.filename)) {
      this.attachments.set(attachment.filename, attachment);
      return `<ac:link><ri:attachment ri:filename="${escAttr(attachment.filename)}" /><ac:plain-text-link-body><![CDATA[${attachment.filename}]]></ac:plain-text-link-body></ac:link>`;
    }
    this.attachments.set(attachment.filename, attachment);
    const width = token.size && /^\d+$/.test(token.size) ? token.size : null;
    return this.imageMacro(
      `<ri:attachment ri:filename="${escAttr(attachment.filename)}" />`,
      token.size && !width ? token.size : "",
      width
    );
  }
  imageMacro(resource, alt, width) {
    const altAttr = alt ? ` ac:alt="${escAttr(alt)}"` : "";
    const widthAttr = width ? ` ac:width="${escAttr(width)}"` : "";
    return `<ac:image${altAttr}${widthAttr}>${resource}</ac:image>`;
  }
  /**
   * Raw HTML is only forwarded when it is known to be well-formed XHTML.
   * Anything else is escaped, since a single unclosed tag rejects the page.
   */
  renderRawHtml(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
      return "";
    if (HTML_PASSTHROUGH.test(trimmed)) {
      return trimmed.replace(/^<(br|hr)\s*\/?>$/i, "<$1 />");
    }
    if (/^<!--[\s\S]*-->$/.test(trimmed))
      return "";
    this.warn("Raw HTML was escaped to text so the page stays valid XHTML.");
    return esc(trimmed);
  }
};

// src/vault.ts
function frontmatterOf(app, file) {
  return app.metadataCache.getFileCache(file)?.frontmatter ?? {};
}
function frontmatterString(app, file, key) {
  const value = frontmatterOf(app, file)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// src/comments.ts
var BLOCK_TAGS = ["p", "li", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"];
var MARKER_PATTERNS = [
  /<ac:inline-comment-marker\s+ac:ref="([^"]+)"[^>]*>([\s\S]*?)<\/ac:inline-comment-marker>/gi,
  /<span\b[^>]*\bdata-annotation-id="([^"]+)"[^>]*>([\s\S]*?)<\/span>/gi
];
var ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};
function decodeEntity(name) {
  if (ENTITIES[name])
    return ENTITIES[name];
  const dec = /^#(\d+)$/.exec(name);
  if (dec)
    return String.fromCodePoint(Number(dec[1]));
  const hex = /^#[xX]([0-9a-fA-F]+)$/.exec(name);
  if (hex)
    return String.fromCodePoint(parseInt(hex[1], 16));
  return null;
}
function mapText(markup) {
  const map = { text: "", starts: [], ends: [] };
  let i = 0;
  while (i < markup.length) {
    const ch = markup[i];
    if (ch === "<") {
      const close = markup.indexOf(">", i);
      i = close < 0 ? markup.length : close + 1;
      continue;
    }
    if (ch === "&") {
      const semi = markup.indexOf(";", i);
      if (semi > i && semi - i <= 10) {
        const decoded = decodeEntity(markup.slice(i + 1, semi));
        if (decoded !== null) {
          map.text += decoded;
          map.starts.push(i);
          map.ends.push(semi + 1);
          i = semi + 1;
          continue;
        }
      }
    }
    map.text += ch;
    map.starts.push(i);
    map.ends.push(i + 1);
    i++;
  }
  return map;
}
function findClose(markup, tag2, from) {
  const scan = new RegExp(`<(/?)${tag2}\\b[^>]*?(/?)>`, "gi");
  scan.lastIndex = from;
  let depth = 1;
  let m;
  while (m = scan.exec(markup)) {
    if (m[2] === "/")
      continue;
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0)
      return m.index;
  }
  return -1;
}
function findBlocks(markup) {
  const found = [];
  const open = new RegExp(`<(${BLOCK_TAGS.join("|")})\\b[^>]*?(/?)>`, "gi");
  let m;
  while (m = open.exec(markup)) {
    if (m[2] === "/")
      continue;
    const start = m.index + m[0].length;
    const end = findClose(markup, m[1], start);
    if (end < 0)
      continue;
    found.push({ start, end });
  }
  return found.filter(
    (block2) => !found.some((other) => other !== block2 && other.start >= block2.start && other.end <= block2.end)
  );
}
function stripMarkers(storage) {
  let out = storage;
  for (const pattern of MARKER_PATTERNS) {
    out = out.replace(new RegExp(pattern.source, pattern.flags), (full, _ref, inner) => {
      if (full.startsWith("<span") && !/inlineComment/i.test(full))
        return full;
      return inner;
    });
  }
  return out;
}
function extractAnchors(storage) {
  const anchors = [];
  for (const pattern of MARKER_PATTERNS) {
    const scan = new RegExp(pattern.source, pattern.flags);
    let m;
    while (m = scan.exec(storage)) {
      const [full, markerRef, inner] = m;
      if (full.startsWith("<span") && !/inlineComment/i.test(full))
        continue;
      const selection = mapText(inner).text;
      if (!selection)
        continue;
      const before = stripMarkers(storage.slice(0, m.index));
      const clean = stripMarkers(storage);
      const block2 = findBlocks(clean).find(
        (b) => b.start <= before.length && b.end >= before.length
      );
      if (!block2)
        continue;
      const blockMap = mapText(clean.slice(block2.start, block2.end));
      const blockText2 = blockMap.text;
      const offsetInBlock = mapText(clean.slice(block2.start, before.length)).text.length;
      const occurrence = countOccurrences(blockText2.slice(0, offsetInBlock), selection);
      const blockIndex = findBlocks(clean).filter((b) => mapText(clean.slice(b.start, b.end)).text === blockText2).findIndex((b) => b.start === block2.start);
      anchors.push({ markerRef, selection, blockText: blockText2, blockIndex, occurrence });
    }
  }
  return anchors;
}
function countOccurrences(haystack, needle) {
  if (!needle)
    return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count++;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}
function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function reanchorComments(storage, anchors) {
  const reanchored = [];
  const lost = [];
  const edits = [];
  const blocks = findBlocks(storage);
  const blockTexts = blocks.map((b) => mapText(storage.slice(b.start, b.end)).text);
  for (const anchor of anchors) {
    const candidates = blocks.filter((_, i) => blockTexts[i] === anchor.blockText);
    const block2 = candidates[anchor.blockIndex] ?? candidates[0];
    if (!block2) {
      lost.push(anchor);
      continue;
    }
    const inner = storage.slice(block2.start, block2.end);
    const map = mapText(inner);
    let at = -1;
    for (let n = 0; n <= anchor.occurrence; n++) {
      at = map.text.indexOf(anchor.selection, n === 0 ? 0 : at + anchor.selection.length);
      if (at === -1)
        break;
    }
    if (at === -1) {
      lost.push(anchor);
      continue;
    }
    const rawStart = block2.start + map.starts[at];
    const rawEnd = block2.start + map.ends[at + anchor.selection.length - 1];
    if (storage.slice(rawStart, rawEnd).includes("<")) {
      lost.push(anchor);
      continue;
    }
    edits.push({ start: rawStart, end: rawEnd, markerRef: anchor.markerRef });
    reanchored.push(anchor);
  }
  let out = storage;
  for (const edit2 of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit2.start) + `<ac:inline-comment-marker ac:ref="${escapeAttr(edit2.markerRef)}">` + out.slice(edit2.start, edit2.end) + "</ac:inline-comment-marker>" + out.slice(edit2.end);
  }
  return { storage: out, reanchored, lost };
}

// src/push.ts
var MIME_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav"
};
function mimeFor(filename) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPES[ext] || "application/octet-stream";
}
function hash(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function quoteList(values, max = 3) {
  const shown = values.slice(0, max).map((v) => `"${v.length > 60 ? v.slice(0, 57) + "..." : v}"`);
  const rest = values.length - shown.length;
  return shown.join(", ") + (rest > 0 ? `, and ${rest} more` : "");
}
var OverwriteModal = class extends Modal {
  constructor(app, prompt, resolve3) {
    super(app);
    this.decided = false;
    this.prompt = prompt;
    this.resolve = resolve3;
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: this.prompt.heading });
    for (const line of this.prompt.lines) {
      contentEl.createEl("p", { text: line });
    }
    const controls = new Setting(contentEl);
    const url = this.prompt.pageUrl;
    if (url) {
      controls.addButton(
        (b) => b.setButtonText("Open in Confluence").onClick(() => {
          window.open(url, "_blank");
        })
      );
    }
    controls.addButton((b) => b.setButtonText("Cancel").onClick(() => this.decide(false))).addButton(
      (b) => b.setButtonText(this.prompt.confirmLabel).setWarning().onClick(() => this.decide(true))
    );
  }
  decide(overwrite) {
    this.decided = true;
    this.resolve(overwrite);
    this.close();
  }
  onClose() {
    this.contentEl.empty();
    if (!this.decided)
      this.resolve(false);
  }
};
var Pusher = class {
  constructor(app, client, settings, syncState, persist) {
    this.app = app;
    this.client = client;
    this.settings = settings;
    this.syncState = syncState;
    this.persist = persist;
  }
  /** Public so the preview command titles the page the same way a push would. */
  titleFor(file) {
    return frontmatterString(this.app, file, "title") ?? file.basename;
  }
  confirmOverwrite(prompt) {
    return new Promise((resolve3) => new OverwriteModal(this.app, prompt, resolve3).open());
  }
  /**
   * The single prompt covering every reason this update is destructive, or
   * null when there is nothing to ask about.
   *
   * Comments are a separate trigger from the version check on purpose:
   * commenting does not bump the page version, so a page sitting at exactly
   * the version this vault last pushed can still have collected comments that
   * an overwrite would strand.
   */
  buildUpdatePrompt(args) {
    const { title, remote, knownVersion, lostComments } = args;
    const versionMoved = knownVersion !== null && remote.version !== knownVersion;
    const untracked = knownVersion === null;
    if (!versionMoved && !untracked && !lostComments.length)
      return null;
    const lines = [];
    let heading2 = "Inline comments will lose their anchor";
    if (untracked) {
      heading2 = "Page is not tracked by this vault";
      lines.push(
        `"${title}" already exists in Confluence at version ${remote.version}, but this vault has no record of pushing it.`,
        "That happens when the page was published from another machine or by the /confluence skill, so there is no way to tell whether it has been edited since."
      );
    } else if (versionMoved) {
      heading2 = "Page changed in Confluence";
      lines.push(
        `"${title}" is at version ${remote.version} in Confluence, but version ${knownVersion} was the last one pushed from this vault. Someone edited the page directly.`,
        "Pushing replaces the page with your local content. Those edits will not be merged."
      );
    }
    if (lostComments.length) {
      lines.push(
        `${plural(lostComments.length, "inline comment")} cannot be carried over, because the text ${lostComments.length === 1 ? "it marks has" : "they mark have"} changed or gone: ${quoteList(lostComments)}.`,
        "Those comments stay on the page but stop pointing at anything. Comments on text you have not edited are moved across automatically."
      );
    } else if (untracked) {
      lines.push("Pushing replaces the page with your local content.");
    }
    return { heading: heading2, lines, confirmLabel: "Overwrite", pageUrl: remote.webUrl };
  }
  /**
   * Carries inline comment anchors from the live page onto the new markup.
   *
   * Footer comments need no help: they hang off the page rather than sitting
   * inside the body, so replacing the body leaves them alone. Inline comments
   * are anchored in the markup itself and would otherwise be orphaned on every
   * push.
   */
  async preserveInlineComments(pageId, storage) {
    if (!this.settings.preserveInlineComments) {
      return { storage, reanchored: 0, lost: [] };
    }
    const comments = await this.client.getOpenInlineComments(pageId);
    if (!comments.length)
      return { storage, reanchored: 0, lost: [] };
    const current = await this.client.getPageStorage(pageId);
    if (!current) {
      return {
        storage,
        reanchored: 0,
        lost: comments.map((c) => c.originalSelection || "(unknown text)")
      };
    }
    const open = new Set(comments.map((c) => c.markerRef));
    const anchors = extractAnchors(current).filter((a) => open.has(a.markerRef));
    const result = reanchorComments(storage, anchors);
    return {
      storage: result.storage,
      reanchored: result.reanchored.length,
      lost: result.lost.map((a) => a.selection)
    };
  }
  /** Public so the preview command renders with the same resolution rules as a push. */
  buildContext(file) {
    const prop = this.settings.frontmatterProperty;
    return {
      resolveLink: (target) => {
        const dest = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
        if (!dest)
          return null;
        const url = this.app.metadataCache.getFileCache(dest)?.frontmatter?.[prop];
        if (typeof url === "string" && url.trim())
          return url.trim();
        const record = this.syncState[dest.path];
        if (record)
          return this.client.pageUrl(record.spaceKey, record.pageId);
        return null;
      },
      resolveAttachment: (target) => {
        const clean = target.split("#")[0].split("|")[0].trim();
        const dest = this.app.metadataCache.getFirstLinkpathDest(clean, file.path);
        if (!dest || dest.extension === "md")
          return null;
        return { filename: dest.name, vaultPath: dest.path };
      }
    };
  }
  spaceKeyFor(file) {
    const override = frontmatterString(this.app, file, "confluenceSpace");
    return override ? override.toUpperCase() : this.settings.defaultSpaceKey;
  }
  /**
   * The parent the note names for itself, as opposed to the settings default.
   *
   * Kept separate because only an explicit choice is allowed to move a page
   * that already exists. Falling back to the default here would drag every
   * published note in the vault under one parent the first time it was pushed.
   */
  declaredParentId(file) {
    const override = frontmatterString(this.app, file, "confluenceParent");
    if (!override)
      return null;
    return pageIdFromUrl(override) ?? override;
  }
  parentIdFor(file) {
    return this.declaredParentId(file) ?? (this.settings.defaultParentPageId || null);
  }
  /** The page this note is already bound to, from frontmatter or sync state. */
  existingPageId(file) {
    const url = frontmatterString(this.app, file, this.settings.frontmatterProperty);
    if (url) {
      const id = pageIdFromUrl(url);
      if (id)
        return id;
    }
    return this.syncState[file.path]?.pageId ?? null;
  }
  async push(file, opts = {}) {
    const warnings = [];
    const title = this.titleFor(file);
    const spaceKey = this.spaceKeyFor(file);
    if (!this.settings.siteUrl || !this.settings.email || !this.settings.apiToken) {
      throw new Error("Confluence credentials are not configured. Open the plugin settings.");
    }
    if (!spaceKey) {
      throw new Error(
        `No space for "${file.basename}". Set a default space key in settings, or add a confluenceSpace property to the note.`
      );
    }
    const markdown = await this.app.vault.cachedRead(file);
    const converter = new StorageConverter(this.buildContext(file));
    const conversion = converter.convert(markdown, {
      skipFirstHeading: this.settings.skipDuplicateTitleHeading ? title : void 0
    });
    warnings.push(...conversion.warnings);
    if (!conversion.storage.trim()) {
      throw new Error(`"${file.basename}" has no content to publish.`);
    }
    const contentHash = hash(`${title}
${conversion.storage}`);
    const record = this.syncState[file.path];
    const knownPageId = this.existingPageId(file);
    let page;
    let outcome;
    if (knownPageId) {
      const remote = await this.client.getPage(knownPageId);
      if (!remote) {
        warnings.push("The linked Confluence page no longer exists, so a new page was created.");
        page = await this.createPage(file, title, spaceKey, conversion.storage);
        outcome = "created";
      } else {
        const declaredParent = this.declaredParentId(file);
        const moving = declaredParent !== null && declaredParent !== remote.parentId;
        const unchanged = this.settings.skipUnchanged && !opts.force && !moving && record?.contentHash === contentHash && record?.lastPushedVersion === remote.version && record?.title === title;
        if (unchanged) {
          return {
            file,
            outcome: "skipped",
            url: this.client.pageUrl(spaceKey, remote.id),
            warnings,
            attachmentsUploaded: 0
          };
        }
        const preserved = await this.preserveInlineComments(remote.id, conversion.storage);
        if (preserved.reanchored) {
          warnings.push(
            `Carried ${plural(preserved.reanchored, "inline comment")} over to the new content.`
          );
        }
        const knownVersion = record?.lastPushedVersion ?? null;
        const prompt = this.buildUpdatePrompt({
          title,
          remote,
          knownVersion,
          lostComments: preserved.lost
        });
        if (prompt && this.settings.warnOnRemoteEdits && !opts.force) {
          const overwrite = await this.confirmOverwrite(prompt);
          if (!overwrite) {
            return {
              file,
              outcome: "cancelled",
              url: this.client.pageUrl(spaceKey, remote.id),
              warnings,
              attachmentsUploaded: 0
            };
          }
        }
        page = await this.client.updatePage({
          pageId: remote.id,
          title,
          storage: preserved.storage,
          nextVersion: remote.version + 1,
          message: this.settings.versionMessage,
          parentId: moving ? declaredParent : null
        });
        outcome = "updated";
      }
    } else {
      const spaceId = await this.client.getSpaceId(spaceKey);
      const matches = await this.client.findPagesByTitle(spaceId, title);
      const existing = matches[0];
      if (existing) {
        const adopted = await this.preserveInlineComments(existing.id, conversion.storage);
        if (adopted.reanchored) {
          warnings.push(
            `Carried ${plural(adopted.reanchored, "inline comment")} over to the new content.`
          );
        }
        if (this.settings.warnOnRemoteEdits && !opts.force) {
          const lines = [
            `A page titled "${title}" already exists in ${spaceKey} at version ${existing.version}, but it was not published from this vault.`
          ];
          if (matches.length > 1) {
            lines.push(
              "More than one page in this space has this title. Open Confluence and check which one you mean before replacing it."
            );
          }
          lines.push(
            "Pushing adopts that page and replaces its content with this note. Its current content is not backed up locally."
          );
          if (adopted.lost.length) {
            lines.push(
              `${plural(adopted.lost.length, "inline comment")} on that page cannot be carried over: ${quoteList(adopted.lost)}.`
            );
          }
          const overwrite = await this.confirmOverwrite({
            heading: "A page with this title already exists",
            lines,
            confirmLabel: "Adopt and replace",
            pageUrl: existing.webUrl
          });
          if (!overwrite) {
            return {
              file,
              outcome: "cancelled",
              url: this.client.pageUrl(spaceKey, existing.id),
              warnings,
              attachmentsUploaded: 0
            };
          }
        }
        warnings.push(`Adopted the existing Confluence page titled "${title}".`);
        page = await this.client.updatePage({
          pageId: existing.id,
          title,
          storage: adopted.storage,
          nextVersion: existing.version + 1,
          message: this.settings.versionMessage
        });
        outcome = "updated";
      } else {
        page = await this.createPage(file, title, spaceKey, conversion.storage);
        outcome = "created";
      }
    }
    let attachmentsUploaded = 0;
    if (this.settings.uploadAttachments && conversion.attachments.length) {
      for (const attachment of conversion.attachments) {
        try {
          const source = this.app.vault.getAbstractFileByPath(attachment.vaultPath);
          if (!(source instanceof TFile))
            continue;
          const data = await this.app.vault.readBinary(source);
          await this.client.uploadAttachment(
            page.id,
            attachment.filename,
            data,
            mimeFor(attachment.filename)
          );
          attachmentsUploaded++;
        } catch (err) {
          warnings.push(`Attachment "${attachment.filename}" failed: ${err.message}`);
        }
      }
    }
    if (attachmentsUploaded) {
      const refreshed = await this.client.getPage(page.id);
      if (refreshed)
        page = refreshed;
    }
    const url = this.client.pageUrl(spaceKey, page.id);
    this.syncState[file.path] = {
      pageId: page.id,
      spaceKey,
      title,
      lastPushedVersion: page.version,
      lastPushedAt: (/* @__PURE__ */ new Date()).toISOString(),
      contentHash
    };
    await this.persist();
    await this.writeBackUrl(file, url);
    return { file, outcome, url, warnings, attachmentsUploaded };
  }
  async createPage(file, title, spaceKey, storage) {
    const spaceId = await this.client.getSpaceId(spaceKey);
    return this.client.createPage({
      spaceId,
      title,
      storage,
      parentId: this.parentIdFor(file)
    });
  }
  async writeBackUrl(file, url) {
    const prop = this.settings.frontmatterProperty;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[prop] = url;
    });
  }
};

// src/settings.ts
var DEFAULT_SETTINGS = {
  siteUrl: "",
  email: "",
  apiToken: "",
  defaultSpaceKey: "",
  defaultParentPageId: "",
  frontmatterProperty: "confluence",
  uploadAttachments: true,
  skipDuplicateTitleHeading: true,
  warnOnRemoteEdits: true,
  skipUnchanged: true,
  preserveInlineComments: true,
  versionMessage: "Updated from Obsidian"
};

// src/pull.ts
var SIDECAR_SUFFIX = ".confluence.md";
function isSidecarPath(notePath) {
  return notePath.toLowerCase().endsWith(SIDECAR_SUFFIX);
}
function sidecarPathFor(notePath) {
  return notePath.replace(/\.md$/i, "") + SIDECAR_SUFFIX;
}
function yamlString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function sidecarContents(args) {
  const { remote, notePath, url, lastPushedVersion, pulledAt } = args;
  const since = lastPushedVersion === null ? "This vault has no record of publishing the page, so there is nothing to compare against." : lastPushedVersion === remote.version ? `The page is still at version ${remote.version}, the one this vault last pushed, so nobody has edited it since.` : `Version ${lastPushedVersion} was the last one pushed from this vault. Confluence is now at ${remote.version}.`;
  return [
    "---",
    `title: ${yamlString(`${remote.title} (Confluence copy)`)}`,
    `date: ${pulledAt.slice(0, 10)}`,
    "type: reference",
    "tags: [confluence-pull]",
    "status: draft",
    `summary: ${yamlString(
      `Read-only copy of the Confluence version of ${notePath}, pulled ${pulledAt.slice(0, 10)}. Kept for review only. The note is the source of truth.`
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
    ""
  ].join("\n");
}
function shouldWriteSidecar(state, opts) {
  if (state === "drifted")
    return true;
  if (state === "untracked")
    return !opts.sweeping;
  return false;
}
function pullState(args) {
  if (!args.pageId)
    return "not published";
  if (!args.remoteExists)
    return "missing";
  if (args.lastPushedVersion === null)
    return "untracked";
  return args.lastPushedVersion === args.remoteVersion ? "in sync" : "drifted";
}

// src/cli.ts
var PLUGIN_DIR = path2.resolve(__dirname);
var VAULT_ROOT = path2.resolve(PLUGIN_DIR, "../../..");
var DATA_FILE = path2.join(PLUGIN_DIR, "data.json");
var APP_CONFIG = path2.join(VAULT_ROOT, ".obsidian/app.json");
var USAGE = `confluence-push - publish vault notes to Confluence

Usage:
  confluence-push push <note>... [--force] [--parent <id|url>] [--dry-run]
  confluence-push push --all [--force]
  confluence-push move <note>... [--parent <id|url>] [--dry-run]
  confluence-push move --all [--dry-run]
  confluence-push status [<note>...]
  confluence-push pull [<note>...] [--all] [--force] [--dry-run]
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
  --parent     Parent page or folder for notes that do not name one themselves.
  --dry-run    Report what would happen without changing anything.
  --stdout     With pull, print the page instead of writing a review copy.
  --json       Machine-readable output.

pull never writes over a note. It saves what Confluence holds as a separate
<note>.confluence.md review copy, because a page comes back rendered rather than
as the Markdown that was pushed. Read it, copy across what you want, delete it.

A note names its own page title, space and parent through the title,
confluenceSpace and confluenceParent frontmatter properties. The published URL
is written back to the confluence property.
`;
function parseArgs(argv) {
  const args = {
    command: argv[0] ?? "",
    positional: [],
    force: false,
    all: false,
    dryRun: false,
    json: false,
    parent: null,
    stdout: false
  };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force" || arg === "-f")
      args.force = true;
    else if (arg === "--all")
      args.all = true;
    else if (arg === "--dry-run" || arg === "-n")
      args.dryRun = true;
    else if (arg === "--json")
      args.json = true;
    else if (arg === "--stdout")
      args.stdout = true;
    else if (arg === "--parent")
      args.parent = argv[++i] ?? null;
    else if (arg.startsWith("--parent="))
      args.parent = arg.slice("--parent=".length);
    else if (arg.startsWith("-"))
      throw new Error(`Unknown option "${arg}".`);
    else
      args.positional.push(arg);
  }
  return args;
}
function asObsidianFile(file) {
  return file;
}
function fail(message) {
  process.stderr.write(`${message}
`);
  process.exit(1);
}
async function readPluginData() {
  let raw;
  try {
    raw = JSON.parse(await import_fs2.promises.readFile(DATA_FILE, "utf8"));
  } catch {
    fail(`Could not read ${DATA_FILE}. Configure the plugin in Obsidian first.`);
  }
  const settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings ?? {});
  if (!settings.siteUrl || !settings.email || !settings.apiToken) {
    fail("Confluence credentials are not configured. Open the plugin settings in Obsidian.");
  }
  return { settings, sync: raw.sync ?? {} };
}
async function writeSyncState(sync) {
  const raw = JSON.parse(await import_fs2.promises.readFile(DATA_FILE, "utf8"));
  const merged = { ...raw.sync ?? {} };
  for (const [notePath, record] of Object.entries(sync)) {
    const theirs = merged[notePath];
    if (!theirs || record.lastPushedAt >= theirs.lastPushedAt)
      merged[notePath] = record;
  }
  raw.sync = merged;
  await import_fs2.promises.writeFile(DATA_FILE, JSON.stringify(raw, null, 2) + "\n", "utf8");
}
async function ignoredPrefixes() {
  try {
    const config = JSON.parse(await import_fs2.promises.readFile(APP_CONFIG, "utf8"));
    return (config.userIgnoreFilters ?? []).map(
      (prefix) => prefix.endsWith("/") ? prefix : `${prefix}/`
    );
  } catch {
    return [];
  }
}
async function openVault() {
  const vault = await NodeVault.open(VAULT_ROOT, { ignore: await ignoredPrefixes() });
  await vault.warmFrontmatter();
  return vault;
}
function clientFor(settings) {
  return new ConfluenceClient({
    siteUrl: settings.siteUrl,
    email: settings.email,
    apiToken: settings.apiToken
  });
}
function resolveNotes(vault, inputs) {
  return inputs.map((input) => {
    const file = vault.resolve(input);
    if (!file)
      fail(`Not a note in this vault: ${input}`);
    if (file.extension !== "md")
      fail(`Not a Markdown note: ${input}`);
    return file;
  });
}
async function assertOnePageEach(vault, data, files) {
  const claims = /* @__PURE__ */ new Map();
  for (const file of files) {
    const url = (await vault.frontmatter(file))[data.settings.frontmatterProperty];
    const pageId = data.sync[file.path]?.pageId ?? (typeof url === "string" ? pageIdFromUrl(url) : null);
    if (!pageId)
      continue;
    const bucket = claims.get(pageId);
    if (bucket)
      bucket.push(file.path);
    else
      claims.set(pageId, [file.path]);
  }
  const shared = [...claims].filter(([, notes]) => notes.length > 1);
  if (!shared.length)
    return;
  const lines = shared.map(
    ([pageId, notes]) => `  page ${pageId}
${notes.map((n) => `    ${n}`).join("\n")}`
  );
  fail(
    "More than one note is bound to the same Confluence page:\n" + lines.join("\n") + "\n\nClear the confluence property on all but one of each group, then run again."
  );
}
async function publishedNotes(vault, data) {
  const published = [];
  for (const file of vault.markdownFiles()) {
    if (data.sync[file.path]) {
      published.push(file);
      continue;
    }
    const url = (await vault.frontmatter(file))[data.settings.frontmatterProperty];
    if (typeof url === "string" && pageIdFromUrl(url))
      published.push(file);
  }
  return published;
}
function installPromptPolicy() {
  const reasons = [];
  Modal.handler = (modal) => {
    reasons.push(modal.describe().join(" "));
    const cancel = modal.button("Cancel");
    if (cancel)
      cancel.click();
    else
      modal.close();
  };
  return reasons;
}
async function commandPush(args) {
  const data = await readPluginData();
  if (args.parent) {
    const parentId = pageIdFromUrl(args.parent);
    if (!parentId)
      fail(`Could not read a page id from --parent "${args.parent}".`);
    data.settings.defaultParentPageId = parentId;
  }
  const vault = await openVault();
  const files = args.all ? await publishedNotes(vault, data) : resolveNotes(vault, args.positional);
  if (!files.length) {
    fail(args.all ? "No published notes found." : "Name at least one note to push.");
  }
  await assertOnePageEach(vault, data, files);
  if (args.dryRun) {
    for (const file of files) {
      const url = (await vault.frontmatter(file))[data.settings.frontmatterProperty];
      const pageId = data.sync[file.path]?.pageId ?? (typeof url === "string" ? pageIdFromUrl(url) : null);
      process.stdout.write(
        `${pageId ? "would update" : "would create"}  ${file.path}` + (pageId ? `  [${pageId}]` : "") + "\n"
      );
    }
    return;
  }
  const client = clientFor(data.settings);
  const reasons = installPromptPolicy();
  const pusher = new Pusher(
    vault.asApp(),
    client,
    data.settings,
    data.sync,
    () => writeSyncState(data.sync)
  );
  const reports = [];
  for (const file of files) {
    reasons.length = 0;
    try {
      const result = await pusher.push(asObsidianFile(file), { force: args.force });
      reports.push({
        note: file.path,
        outcome: result.outcome,
        url: result.url,
        warnings: result.outcome === "cancelled" ? [...reasons] : result.warnings,
        attachments: result.attachmentsUploaded
      });
    } catch (err) {
      reports.push({
        note: file.path,
        outcome: "failed",
        url: null,
        warnings: [],
        attachments: 0,
        error: err.message
      });
    }
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
  } else {
    for (const report of reports) {
      const suffix = report.attachments ? ` (+${report.attachments} attachments)` : "";
      process.stdout.write(`${report.outcome.padEnd(9)} ${report.note}${suffix}
`);
      if (report.url)
        process.stdout.write(`          ${report.url}
`);
      if (report.error)
        process.stdout.write(`          ${report.error}
`);
      for (const warning of report.warnings)
        process.stdout.write(`          ! ${warning}
`);
    }
    const counts = /* @__PURE__ */ new Map();
    for (const report of reports)
      counts.set(report.outcome, (counts.get(report.outcome) ?? 0) + 1);
    process.stdout.write(
      `
${[...counts].map(([outcome, n]) => `${n} ${outcome}`).join(", ")}
`
    );
  }
  if (reports.some((report) => report.outcome === "failed"))
    process.exit(1);
}
async function commandStatus(args) {
  const data = await readPluginData();
  const vault = await openVault();
  const client = clientFor(data.settings);
  const files = args.positional.length ? resolveNotes(vault, args.positional) : await publishedNotes(vault, data);
  const rows = [];
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
      state: !record ? "untracked by this vault" : record.lastPushedVersion === remote.version ? "in sync" : "edited in Confluence",
      url: client.pageUrl(record?.spaceKey ?? data.settings.defaultSpaceKey, pageId)
    });
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return;
  }
  for (const row of rows)
    process.stdout.write(`${String(row.state).padEnd(24)} ${row.note}
`);
}
async function commandMove(args) {
  const data = await readPluginData();
  const vault = await openVault();
  const client = clientFor(data.settings);
  const override = args.parent ? pageIdFromUrl(args.parent) : null;
  if (args.parent && !override)
    fail(`Could not read a page id from --parent "${args.parent}".`);
  const files = args.all ? await publishedNotes(vault, data) : resolveNotes(vault, args.positional);
  if (!files.length)
    fail(args.all ? "No published notes found." : "Name at least one note to move.");
  await assertOnePageEach(vault, data, files);
  let moved = 0;
  let inPlace = 0;
  let touched = false;
  const problems = [];
  for (const file of files) {
    const frontmatter = await vault.frontmatter(file);
    const url = frontmatter[data.settings.frontmatterProperty];
    const pageId = data.sync[file.path]?.pageId ?? (typeof url === "string" ? pageIdFromUrl(url) : null);
    if (!pageId) {
      problems.push(`${file.path}: not published`);
      continue;
    }
    const declared = frontmatter.confluenceParent;
    const target = override ?? (typeof declared === "string" ? pageIdFromUrl(declared) : null);
    if (!target) {
      problems.push(`${file.path}: no confluenceParent, and no --parent given`);
      continue;
    }
    const remote = await client.getPage(pageId);
    if (!remote) {
      problems.push(`${file.path}: page ${pageId} is missing in Confluence`);
      continue;
    }
    const title = typeof frontmatter.title === "string" && frontmatter.title.trim() ? frontmatter.title.trim() : file.basename;
    const needsMove = remote.parentId !== target;
    const needsTitle = remote.title !== title;
    if (!needsMove && !needsTitle) {
      inPlace++;
      continue;
    }
    const what = [needsMove ? `-> ${target}` : "", needsTitle ? `"${title}"` : ""].filter(Boolean).join("  ");
    if (args.dryRun) {
      process.stdout.write(`would refile  ${file.path}  ${what}
`);
      moved++;
      continue;
    }
    try {
      if (needsTitle) {
        const renamed = await client.retitle({
          pageId,
          title,
          currentVersion: remote.version
        });
        const record = data.sync[file.path];
        if (record) {
          record.lastPushedVersion = renamed.version;
          record.title = title;
          record.lastPushedAt = (/* @__PURE__ */ new Date()).toISOString();
          touched = true;
        }
      }
      if (needsMove)
        await client.moveContent(pageId, target);
      process.stdout.write(`refiled   ${file.path}  ${what}
`);
      moved++;
    } catch (err) {
      problems.push(`${file.path}: ${err.message}`);
    }
  }
  if (touched)
    await writeSyncState(data.sync);
  process.stdout.write(`
${moved} refiled, ${inPlace} already correct, ${problems.length} skipped
`);
  for (const problem of problems)
    process.stdout.write(`  ! ${problem}
`);
  if (problems.length)
    process.exitCode = 1;
}
async function commandPreview(args) {
  const data = await readPluginData();
  const vault = await openVault();
  const [file] = resolveNotes(vault, args.positional.slice(0, 1));
  if (!file)
    fail("Name a note to preview.");
  const pusher = new Pusher(
    vault.asApp(),
    clientFor(data.settings),
    data.settings,
    data.sync,
    async () => {
    }
  );
  const note = asObsidianFile(file);
  const title = pusher.titleFor(note);
  const result = new StorageConverter(pusher.buildContext(note)).convert(await vault.read(file), {
    skipFirstHeading: data.settings.skipDuplicateTitleHeading ? title : void 0
  });
  if (args.json) {
    process.stdout.write(JSON.stringify({ title, ...result }, null, 2) + "\n");
    return;
  }
  for (const warning of result.warnings)
    process.stderr.write(`! ${warning}
`);
  process.stdout.write(result.storage + "\n");
}
async function commandPullToStdout(args) {
  const data = await readPluginData();
  const vault = await openVault();
  const client = clientFor(data.settings);
  const [file] = resolveNotes(vault, args.positional.slice(0, 1));
  if (!file)
    fail("Name a note to pull.");
  const url = (await vault.frontmatter(file))[data.settings.frontmatterProperty];
  const pageId = data.sync[file.path]?.pageId ?? (typeof url === "string" ? pageIdFromUrl(url) : null);
  if (!pageId)
    fail(`"${file.path}" is not published, so there is nothing to pull.`);
  const remote = await client.getPageMarkdown(pageId);
  if (!remote)
    fail(`Page ${pageId} was not found.`);
  const record = data.sync[file.path];
  if (args.json) {
    process.stdout.write(
      JSON.stringify({ ...remote, pageId, lastPushedVersion: record?.lastPushedVersion ?? null }, null, 2) + "\n"
    );
    return;
  }
  const drift = record?.lastPushedVersion === remote.version ? "unchanged since your last push" : record ? `edited since your last push (you pushed v${record.lastPushedVersion})` : "not tracked by this vault, so its history is unknown";
  process.stderr.write(
    `${remote.title}
version ${remote.version}, ${remote.editedAt}
${drift}
${client.pageUrl(record?.spaceKey ?? data.settings.defaultSpaceKey, pageId)}

`
  );
  process.stdout.write(remote.markdown + "\n");
}
async function commandPull(args) {
  if (args.stdout)
    return commandPullToStdout(args);
  const data = await readPluginData();
  const vault = await openVault();
  const client = clientFor(data.settings);
  const pulledAt = (/* @__PURE__ */ new Date()).toISOString();
  const sweeping = !args.positional.length;
  const files = (sweeping ? await publishedNotes(vault, data) : resolveNotes(vault, args.positional)).filter((file) => !isSidecarPath(file.path));
  if (!files.length)
    fail(sweeping ? "No published notes found." : "Name at least one note.");
  const outcomes = [];
  for (const file of files) {
    const record = data.sync[file.path];
    const url = (await vault.frontmatter(file))[data.settings.frontmatterProperty];
    const pageId = record?.pageId ?? (typeof url === "string" ? pageIdFromUrl(url) : null);
    const lastPushedVersion = record?.lastPushedVersion ?? null;
    const remote = pageId ? await client.getPageMarkdown(pageId) : null;
    const state = pullState({
      pageId,
      remoteExists: remote !== null,
      remoteVersion: remote?.version ?? null,
      lastPushedVersion
    });
    const outcome = {
      notePath: file.path,
      state,
      pageId,
      remoteVersion: remote?.version ?? null,
      lastPushedVersion,
      sidecarPath: null,
      url: pageId ? client.pageUrl(record?.spaceKey ?? data.settings.defaultSpaceKey, pageId) : null
    };
    if (remote && (shouldWriteSidecar(state, { sweeping }) || args.force) && !args.dryRun) {
      outcome.sidecarPath = sidecarPathFor(file.path);
      await import_fs2.promises.writeFile(
        path2.join(VAULT_ROOT, outcome.sidecarPath),
        sidecarContents({
          remote,
          notePath: file.path,
          url: outcome.url ?? "",
          lastPushedVersion,
          pulledAt
        }),
        "utf8"
      );
    } else if (remote && (shouldWriteSidecar(state, { sweeping }) || args.force)) {
      outcome.sidecarPath = sidecarPathFor(file.path);
    }
    outcomes.push(outcome);
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(outcomes, null, 2) + "\n");
    return;
  }
  let written = 0;
  for (const outcome of outcomes) {
    const versions = outcome.remoteVersion === null ? "" : `  v${outcome.lastPushedVersion ?? "?"} -> v${outcome.remoteVersion}`;
    process.stdout.write(`${outcome.state.padEnd(14)} ${outcome.notePath}${versions}
`);
    if (outcome.sidecarPath) {
      written++;
      process.stdout.write(`${" ".repeat(14)} ${args.dryRun ? "would write" : "wrote"} ${outcome.sidecarPath}
`);
    }
  }
  const drifted = outcomes.filter((o) => o.state === "drifted").length;
  const untracked = outcomes.filter((o) => o.state === "untracked").length;
  process.stdout.write(
    `
${drifted} drifted, ${written} review ${written === 1 ? "copy" : "copies"} ${args.dryRun ? "would be written" : "written"}
`
  );
  if (untracked && sweeping) {
    process.stdout.write(
      `${untracked} published before this vault kept records, so there is no baseline to compare them against. Pull one by name to see what Confluence holds.
`
    );
  }
}
function renderTree(nodes, rootId, rootTitle) {
  const children = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    const key = node.parentId ?? rootId;
    const bucket = children.get(key);
    if (bucket)
      bucket.push(node);
    else
      children.set(key, [node]);
  }
  const lines = [`${rootTitle}  [${rootId}]`];
  const walk2 = (parentId, depth) => {
    for (const node of children.get(parentId) ?? []) {
      lines.push(
        `${"  ".repeat(depth)}- ${node.title}${node.type === "folder" ? "/" : ""}  [${node.id}]`
      );
      walk2(node.id, depth + 1);
    }
  };
  walk2(rootId, 1);
  return lines.join("\n");
}
async function commandTree(args) {
  const data = await readPluginData();
  const client = clientFor(data.settings);
  const rootId = pageIdFromUrl(args.positional[0] ?? data.settings.defaultParentPageId);
  if (!rootId)
    fail("Name the page to print, or set a default parent page in the plugin settings.");
  const root = await client.getPage(rootId);
  if (!root)
    fail(`Page ${rootId} was not found.`);
  const nodes = await client.descendants(rootId);
  if (args.json) {
    process.stdout.write(JSON.stringify({ root, nodes }, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderTree(nodes, rootId, root.title) + "\n");
}
async function commandMkfolder(args) {
  const data = await readPluginData();
  const title = args.positional.join(" ").trim();
  if (!title)
    fail("Name the folder to create.");
  const parentId = pageIdFromUrl(args.parent ?? data.settings.defaultParentPageId);
  if (!parentId)
    fail("Pass --parent with the page or folder the new folder belongs under.");
  const client = clientFor(data.settings);
  const existing = (await client.directChildren(parentId)).find(
    (node) => node.type === "folder" && node.title === title
  ) ?? await client.findFolderByTitle(data.settings.defaultSpaceKey, title);
  if (existing) {
    process.stdout.write(
      args.json ? JSON.stringify({ ...existing, created: false }, null, 2) + "\n" : `exists  ${existing.title}  [${existing.id}]
`
    );
    return;
  }
  if (args.dryRun) {
    process.stdout.write(`would create  ${title}  under [${parentId}]
`);
    return;
  }
  const spaceId = await client.getSpaceId(data.settings.defaultSpaceKey);
  const folder = await client.createFolder({ spaceId, title, parentId });
  process.stdout.write(
    args.json ? JSON.stringify({ ...folder, created: true }, null, 2) + "\n" : `created ${folder.title}  [${folder.id}]
`
  );
}
async function main() {
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
      fail(`Unknown command "${args.command}".

${USAGE}`);
  }
}
main().catch((err) => fail(err.message));
