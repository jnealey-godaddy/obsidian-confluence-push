import { Marked, Token, Tokens } from "marked";
import { AttachmentRef, ConversionContext, ConversionResult } from "./types";

/**
 * Converts Obsidian-flavoured Markdown into Confluence storage format (XHTML).
 *
 * Storage format is parsed as XML by Confluence, so every emitted string has to
 * be well-formed: unbalanced tags or stray entities make the whole page request
 * fail with a 400 rather than degrading gracefully. Everything below therefore
 * escapes by default and only emits tags this file opened itself.
 */

/** Characters XML 1.0 forbids outright; Confluence rejects the document if present. */
const INVALID_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

/**
 * Named entities decoded back to characters before re-escaping.
 *
 * Storage format is XML with no DTD, so only the five XML entities are legal.
 * Anything else, including a `&nbsp;` typed by hand, has to become a literal
 * character or Confluence rejects the document as undefined-entity XML.
 */
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
	hellip: "…", mdash: "—", ndash: "–", minus: "−",
	ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
	laquo: "«", raquo: "»", bull: "•", middot: "·",
	copy: "©", reg: "®", trade: "™", deg: "°",
	times: "×", divide: "÷", plusmn: "±", sect: "§",
	para: "¶", dagger: "†", euro: "€", pound: "£",
	yen: "¥", cent: "¢", frac12: "½", frac14: "¼",
	frac34: "¾", sup2: "²", sup3: "³", larr: "←",
	rarr: "→", harr: "↔", checkmark: "✓",
};

/**
 * Reverses entity encoding so escaping can be applied exactly once.
 * marked escapes text tokens itself, so without this every `&` would end up
 * as `&amp;amp;` in the published page.
 */
function decodeEntities(s: string): string {
	if (!s.includes("&")) return s;
	return s.replace(/&(#\d{1,7}|#[Xx][0-9A-Fa-f]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/g, (match, body: string) => {
		if (body[0] === "#") {
			const code =
				body[1] === "x" || body[1] === "X"
					? parseInt(body.slice(2), 16)
					: parseInt(body.slice(1), 10);
			if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
			try {
				return String.fromCodePoint(code);
			} catch {
				return match;
			}
		}
		const named = NAMED_ENTITIES[body];
		return named !== undefined ? named : match;
	});
}

function esc(s: string): string {
	return decodeEntities(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
	return esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * Markdown fences accept any label; the code macro only renders a fixed set.
 * Anything unmapped falls back to plain text so the block still renders.
 */
const LANGUAGE_MAP: Record<string, string> = {
	bash: "bash", sh: "bash", shell: "bash", zsh: "bash", console: "bash",
	c: "cpp", "c++": "cpp", cpp: "cpp", "c#": "c#", cs: "c#", csharp: "c#",
	css: "css", scss: "sass", sass: "sass", less: "css",
	diff: "diff", patch: "diff",
	go: "go", golang: "go",
	groovy: "groovy", java: "java", scala: "scala", kotlin: "java",
	js: "js", javascript: "js", jsx: "js", mjs: "js", cjs: "js",
	ts: "js", typescript: "js", tsx: "js",
	json: "js", json5: "js",
	html: "xml", xhtml: "xml", xml: "xml", svg: "xml", vue: "xml",
	md: "text", markdown: "text", text: "text", txt: "text", plaintext: "text",
	perl: "perl", php: "php",
	powershell: "powershell", ps1: "powershell",
	py: "py", python: "py",
	rb: "ruby", ruby: "ruby",
	sql: "sql", mysql: "sql", postgres: "sql", postgresql: "sql",
	vb: "vb", "vb.net": "vb",
	yml: "yaml", yaml: "yaml",
	actionscript: "actionscript3", applescript: "applescript",
	coldfusion: "coldfusion", delphi: "delphi", erlang: "erl",
};

/** Obsidian callout types mapped onto the four Confluence admonition macros. */
const CALLOUT_MAP: Record<string, string> = {
	note: "info", info: "info", todo: "info", abstract: "info",
	summary: "info", tldr: "info", question: "info", help: "info",
	faq: "info", example: "info", quote: "info", cite: "info",
	tip: "tip", hint: "tip", important: "tip",
	success: "tip", check: "tip", done: "tip",
	warning: "note", caution: "note", attention: "note",
	danger: "warning", error: "warning", bug: "warning",
	failure: "warning", fail: "warning", missing: "warning",
};

/**
 * Raw HTML that may pass through untouched. Everything else is escaped to
 * visible text, because a stray `<div>` would make the XML parse fail.
 */
const HTML_PASSTHROUGH = /^<(br|hr)\s*\/?>$|^<\/?(b|i|u|s|em|strong|sup|sub|code|del|ins)>$/i;

interface WikilinkToken extends Tokens.Generic {
	type: "wikilink";
	target: string;
	alias: string | null;
}

interface EmbedToken extends Tokens.Generic {
	type: "embed";
	target: string;
	size: string | null;
}

interface HighlightToken extends Tokens.Generic {
	type: "highlight";
	tokens: Token[];
}

/**
 * Strips `%%...%%` comments while leaving fenced code blocks alone.
 * Done as a pre-pass because Obsidian comments can span block boundaries,
 * which an inline tokenizer cannot express.
 */
export function stripComments(markdown: string): string {
	const lines = markdown.split("\n");
	const out: string[] = [];
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
		// A line that held only a comment is dropped so it does not create an
		// empty paragraph; a line that had other content keeps its place.
		if (result.trim().length > 0 || line.trim().length === 0) {
			out.push(result);
		}
	}
	return out.join("\n");
}

/** Removes a leading YAML frontmatter block. */
export function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---")) return markdown;
	const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(markdown);
	return match ? markdown.slice(match[0].length) : markdown;
}

function buildLexer(): Marked {
	return new Marked({
		gfm: true,
		breaks: false,
		extensions: [
			{
				name: "embed",
				level: "inline",
				start(src: string) {
					const i = src.indexOf("![[");
					return i === -1 ? undefined : i;
				},
				tokenizer(src: string) {
					const m = /^!\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/.exec(src);
					if (!m) return undefined;
					const token: EmbedToken = {
						type: "embed",
						raw: m[0],
						target: m[1].trim(),
						size: m[2] ? m[2].trim() : null,
					};
					return token;
				},
			},
			{
				name: "wikilink",
				level: "inline",
				start(src: string) {
					const i = src.indexOf("[[");
					return i === -1 ? undefined : i;
				},
				tokenizer(src: string) {
					const m = /^\[\[([^\]\n|]+?)(?:\|([^\]\n]*))?\]\]/.exec(src);
					if (!m) return undefined;
					const token: WikilinkToken = {
						type: "wikilink",
						raw: m[0],
						target: m[1].trim(),
						alias: m[2] ? m[2].trim() : null,
					};
					return token;
				},
			},
			{
				name: "highlight",
				level: "inline",
				start(src: string) {
					const i = src.indexOf("==");
					return i === -1 ? undefined : i;
				},
				tokenizer(this: { lexer: { inlineTokens(s: string): Token[] } }, src: string) {
					const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
					if (!m) return undefined;
					const token: HighlightToken = {
						type: "highlight",
						raw: m[0],
						tokens: this.lexer.inlineTokens(m[1]),
					};
					return token;
				},
			},
		],
	});
}

export class StorageConverter {
	private readonly ctx: ConversionContext;
	private readonly lexer: Marked;
	private attachments = new Map<string, AttachmentRef>();
	private warnings: string[] = [];

	constructor(ctx: ConversionContext) {
		this.ctx = ctx;
		this.lexer = buildLexer();
	}

	convert(markdown: string, opts: { skipFirstHeading?: string } = {}): ConversionResult {
		this.attachments = new Map();
		this.warnings = [];

		const source = stripComments(stripFrontmatter(markdown)).replace(INVALID_XML_CHARS, "");
		let tokens = this.lexer.lexer(source) as Token[];
		tokens = this.dropRedundantTitle(tokens, opts.skipFirstHeading);

		const storage = this.renderBlocks(tokens).trim();
		return {
			storage,
			attachments: [...this.attachments.values()],
			warnings: [...this.warnings],
		};
	}

	/**
	 * Notes usually open with an H1 repeating the note title. Confluence renders
	 * the page title above the body, so keeping it duplicates the heading.
	 */
	private dropRedundantTitle(tokens: Token[], title?: string): Token[] {
		if (!title) return tokens;
		const first = tokens.find((t) => t.type !== "space");
		if (!first || first.type !== "heading") return tokens;
		const heading = first as Tokens.Heading;
		if (heading.depth !== 1) return tokens;
		if (heading.text.trim().toLowerCase() !== title.trim().toLowerCase()) return tokens;
		return tokens.filter((t) => t !== first);
	}

	private warn(message: string): void {
		if (!this.warnings.includes(message)) this.warnings.push(message);
	}

	// ---------------------------------------------------------------- blocks

	private renderBlocks(tokens: Token[]): string {
		let out = "";
		for (const token of tokens) {
			out += this.renderBlock(token);
		}
		return out;
	}

	private renderBlock(token: Token): string {
		switch (token.type) {
			case "space":
				return "";
			case "heading": {
				const t = token as Tokens.Heading;
				const depth = Math.min(Math.max(t.depth, 1), 6);
				return `<h${depth}>${this.renderInline(t.tokens)}</h${depth}>`;
			}
			case "paragraph": {
				const t = token as Tokens.Paragraph;
				const inner = this.renderInline(t.tokens);
				// A paragraph holding only an image should not be wrapped, so the
				// image macro sits at block level where Confluence sizes it properly.
				if (/^<ac:image[\s\S]*<\/ac:image>$/.test(inner)) return inner;
				return inner.trim() ? `<p>${inner}</p>` : "";
			}
			case "text": {
				const t = token as Tokens.Text;
				const inner = t.tokens ? this.renderInline(t.tokens) : esc(t.text);
				return inner.trim() ? `<p>${inner}</p>` : "";
			}
			case "code":
				return this.renderCode(token as Tokens.Code);
			case "blockquote":
				return this.renderBlockquote(token as Tokens.Blockquote);
			case "list":
				return this.renderList(token as Tokens.List);
			case "table":
				return this.renderTable(token as Tokens.Table);
			case "hr":
				return "<hr />";
			case "html":
				return this.renderRawHtml((token as Tokens.HTML).raw);
			case "def":
				// Link reference definitions produce no output of their own.
				return "";
			default:
				return `<p>${this.renderInline([token])}</p>`;
		}
	}

	private renderCode(token: Tokens.Code): string {
		const lang = (token.lang || "").trim().split(/\s+/)[0].toLowerCase();
		const mapped = LANGUAGE_MAP[lang];
		const params = mapped ? `<ac:parameter ac:name="language">${mapped}</ac:parameter>` : "";
		// CDATA cannot contain the terminator itself; split it across two sections.
		const body = token.text.replace(/\]\]>/g, "]]]]><![CDATA[>");
		return (
			`<ac:structured-macro ac:name="code" ac:schema-version="1">` +
			params +
			`<ac:plain-text-body><![CDATA[${body}]]></ac:plain-text-body>` +
			`</ac:structured-macro>`
		);
	}

	/** Renders Obsidian callouts as admonition macros, plain quotes as blockquote. */
	private renderBlockquote(token: Tokens.Blockquote): string {
		const callout = /^\s*\[!([A-Za-z-]+)\]([+-])?[ \t]*(.*)$/.exec(token.text.split("\n")[0] || "");
		if (!callout) {
			return `<blockquote>${this.renderBlocks(token.tokens)}</blockquote>`;
		}

		const kind = callout[1].toLowerCase();
		const macro = CALLOUT_MAP[kind] || "info";
		const title = callout[3].trim();

		// Re-lex the body without the `[!type]` marker line so the callout's own
		// Markdown (lists, code, nested emphasis) renders correctly.
		const bodyMarkdown = token.text.split("\n").slice(1).join("\n");
		const bodyTokens = this.lexer.lexer(bodyMarkdown) as Token[];
		const body = this.renderBlocks(bodyTokens);

		const titleParam = title
			? `<ac:parameter ac:name="title">${esc(title)}</ac:parameter>`
			: "";
		return (
			`<ac:structured-macro ac:name="${macro}" ac:schema-version="1">` +
			titleParam +
			`<ac:rich-text-body>${body || "<p />"}</ac:rich-text-body>` +
			`</ac:structured-macro>`
		);
	}

	/**
	 * Checkbox items become Confluence tasks, which are a distinct element from
	 * list items. A list mixing both is emitted as alternating runs so neither
	 * kind is silently converted into the other.
	 */
	private renderList(token: Tokens.List): string {
		const runs: { task: boolean; items: Tokens.ListItem[] }[] = [];
		for (const item of token.items) {
			const isTask = item.task === true;
			const last = runs[runs.length - 1];
			if (last && last.task === isTask) last.items.push(item);
			else runs.push({ task: isTask, items: [item] });
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
				const startAttr =
					ordered && typeof token.start === "number" && token.start !== 1
						? ` start="${token.start}"`
						: "";
				const tag = ordered ? "ol" : "ul";
				out += `<${tag}${startAttr}>`;
				for (const item of run.items) {
					out += `<li>${this.renderListItemBody(item)}</li>`;
				}
				out += `</${tag}>`;
			}
		}
		return out;
	}

	/**
	 * Tight list items hold inline content and must not gain a `<p>`, which would
	 * add vertical space Confluence renders as a loose list.
	 */
	private renderListItemBody(item: Tokens.ListItem): string {
		const blockTypes = new Set([
			"paragraph", "list", "code", "blockquote", "table", "heading", "hr", "html",
		]);
		const hasBlocks = item.tokens.some((t) => blockTypes.has(t.type));
		if (!hasBlocks) {
			const inline = item.tokens.flatMap((t) =>
				t.type === "text" && (t as Tokens.Text).tokens ? (t as Tokens.Text).tokens! : [t]
			);
			return this.renderInline(inline);
		}

		let out = "";
		for (const child of item.tokens) {
			if (child.type === "text") {
				const t = child as Tokens.Text;
				const inline = t.tokens ? this.renderInline(t.tokens) : esc(t.text);
				out += inline.trim() ? inline : "";
			} else {
				out += this.renderBlock(child);
			}
		}
		return out;
	}

	private renderTable(token: Tokens.Table): string {
		const alignStyle = (i: number): string => {
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

	private renderInline(tokens: Token[]): string {
		let out = "";
		for (const token of tokens) {
			out += this.renderInlineToken(token);
		}
		return out;
	}

	private renderInlineToken(token: Token): string {
		switch (token.type) {
			case "text": {
				const t = token as Tokens.Text;
				return t.tokens ? this.renderInline(t.tokens) : esc(t.text);
			}
			case "escape":
				return esc((token as Tokens.Escape).text);
			case "strong":
				return `<strong>${this.renderInline((token as Tokens.Strong).tokens)}</strong>`;
			case "em":
				return `<em>${this.renderInline((token as Tokens.Em).tokens)}</em>`;
			case "del":
				return `<s>${this.renderInline((token as Tokens.Del).tokens)}</s>`;
			case "codespan":
				return `<code>${esc((token as Tokens.Codespan).text)}</code>`;
			case "br":
				return "<br />";
			case "link":
				return this.renderLink(token as Tokens.Link);
			case "image":
				return this.renderImage(token as Tokens.Image);
			case "html":
				return this.renderRawHtml((token as Tokens.Tag).raw);
			case "highlight":
				return (
					`<span style="background-color: rgb(254,222,200);">` +
					`${this.renderInline((token as HighlightToken).tokens)}</span>`
				);
			case "wikilink":
				return this.renderWikilink(token as WikilinkToken);
			case "embed":
				return this.renderEmbed(token as EmbedToken);
			default: {
				const generic = token as Tokens.Generic;
				if (generic.tokens) return this.renderInline(generic.tokens);
				return esc(generic.raw || "");
			}
		}
	}

	private renderLink(token: Tokens.Link): string {
		const text = this.renderInline(token.tokens) || esc(token.href);
		const href = token.href || "";

		if (/^(https?:|mailto:|ftp:|tel:)/i.test(href)) {
			const title = token.title ? ` title="${escAttr(token.title)}"` : "";
			return `<a href="${escAttr(href)}"${title}>${text}</a>`;
		}
		if (href.startsWith("#")) {
			// Same-page anchor; Confluence generates its own heading anchors.
			return `<a href="${escAttr(href)}">${text}</a>`;
		}

		// A relative path pointing at another note.
		const resolved = this.ctx.resolveLink(decodeURIComponent(href.replace(/\.md$/i, "")));
		if (resolved) return `<a href="${escAttr(resolved)}">${text}</a>`;

		this.warn(`Link to "${href}" is not published to Confluence; kept as plain text.`);
		return text;
	}

	private renderWikilink(token: WikilinkToken): string {
		const [path, anchor] = token.target.split("#");
		const label = token.alias || token.target.replace("#", " > ");
		const resolved = this.ctx.resolveLink(path);
		if (resolved) {
			const href = anchor ? `${resolved}#${encodeURIComponent(anchor)}` : resolved;
			return `<a href="${escAttr(href)}">${esc(label)}</a>`;
		}
		this.warn(`"${path}" is not published to Confluence; link kept as plain text.`);
		return esc(label);
	}

	private renderImage(token: Tokens.Image): string {
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

	private renderEmbed(token: EmbedToken): string {
		const attachment = this.ctx.resolveAttachment(token.target);
		if (!attachment) {
			// Note transclusion has no storage-format equivalent; link to the page
			// instead so the reader can still reach the content.
			const resolved = this.ctx.resolveLink(token.target.split("#")[0]);
			if (resolved) {
				return `<a href="${escAttr(resolved)}">${esc(token.target)}</a>`;
			}
			this.warn(`Embed "${token.target}" could not be resolved and was skipped.`);
			return esc(`![[${token.target}]]`);
		}

		if (!/\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(attachment.filename)) {
			// Non-image attachments render as a download link.
			this.attachments.set(attachment.filename, attachment);
			return (
				`<ac:link><ri:attachment ri:filename="${escAttr(attachment.filename)}" />` +
				`<ac:plain-text-link-body><![CDATA[${attachment.filename}]]></ac:plain-text-link-body>` +
				`</ac:link>`
			);
		}

		this.attachments.set(attachment.filename, attachment);
		const width = token.size && /^\d+$/.test(token.size) ? token.size : null;
		return this.imageMacro(
			`<ri:attachment ri:filename="${escAttr(attachment.filename)}" />`,
			token.size && !width ? token.size : "",
			width
		);
	}

	private imageMacro(resource: string, alt: string, width: string | null): string {
		const altAttr = alt ? ` ac:alt="${escAttr(alt)}"` : "";
		const widthAttr = width ? ` ac:width="${escAttr(width)}"` : "";
		return `<ac:image${altAttr}${widthAttr}>${resource}</ac:image>`;
	}

	/**
	 * Raw HTML is only forwarded when it is known to be well-formed XHTML.
	 * Anything else is escaped, since a single unclosed tag rejects the page.
	 */
	private renderRawHtml(raw: string): string {
		const trimmed = raw.trim();
		if (!trimmed) return "";
		if (HTML_PASSTHROUGH.test(trimmed)) {
			return trimmed.replace(/^<(br|hr)\s*\/?>$/i, "<$1 />");
		}
		if (/^<!--[\s\S]*-->$/.test(trimmed)) return "";
		this.warn("Raw HTML was escaped to text so the page stays valid XHTML.");
		return esc(trimmed);
	}
}
