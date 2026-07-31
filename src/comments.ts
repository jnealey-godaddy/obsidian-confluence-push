/**
 * Inline comments are anchored into the page body rather than stored beside it,
 * so replacing the body unanchors every one of them. Footer comments are
 * separate content and are unaffected.
 *
 * This module lifts the anchors off the body Confluence currently holds and
 * puts them back on freshly converted markup wherever the text they marked
 * still exists.
 *
 * Anchoring on the selected text alone is not enough. A comment on the word
 * "Postgres" in a document that says "Postgres" twenty times has to land on
 * the right one, so each anchor also records the block it sat in and which
 * occurrence within that block it covered.
 */

/** Block-level elements that can hold an inline comment marker. */
const BLOCK_TAGS = ["p", "li", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6"];

/**
 * The two shapes an anchor arrives in. Classic pages use the storage-format
 * element; live docs use an annotation span. Both carry the same marker id,
 * which is what ties the span to the comment.
 */
const MARKER_PATTERNS: RegExp[] = [
	/<ac:inline-comment-marker\s+ac:ref="([^"]+)"[^>]*>([\s\S]*?)<\/ac:inline-comment-marker>/gi,
	/<span\b[^>]*\bdata-annotation-id="([^"]+)"[^>]*>([\s\S]*?)<\/span>/gi,
];

const ENTITIES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

export interface AnchoredComment {
	/** Marker id shared with the comment record in Confluence. */
	markerRef: string;
	/** Exact text the marker wrapped. */
	selection: string;
	/** Plain text of the block the marker sat in, used to find it again. */
	blockText: string;
	/** Which block, when several blocks read identically. */
	blockIndex: number;
	/** Which occurrence of `selection` within that block. */
	occurrence: number;
}

export interface ReanchorResult {
	storage: string;
	/** Markers put back onto the new markup. */
	reanchored: AnchoredComment[];
	/** Markers whose anchor text no longer exists where it used to. */
	lost: AnchoredComment[];
}

function decodeEntity(name: string): string | null {
	if (ENTITIES[name]) return ENTITIES[name];
	const dec = /^#(\d+)$/.exec(name);
	if (dec) return String.fromCodePoint(Number(dec[1]));
	const hex = /^#[xX]([0-9a-fA-F]+)$/.exec(name);
	if (hex) return String.fromCodePoint(parseInt(hex[1], 16));
	return null;
}

/**
 * Plain text of a markup fragment, plus the raw offsets each character came
 * from. The offsets are what let a match on the text be turned back into an
 * edit on the markup.
 */
interface TextMap {
	text: string;
	/** Raw index where text[i] starts. */
	starts: number[];
	/** Raw index just past where text[i] ends. */
	ends: number[];
}

function mapText(markup: string): TextMap {
	const map: TextMap = { text: "", starts: [], ends: [] };
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

/** Index just past the close tag matching an open tag, accounting for nesting. */
function findClose(markup: string, tag: string, from: number): number {
	const scan = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "gi");
	scan.lastIndex = from;
	let depth = 1;
	let m: RegExpExecArray | null;
	while ((m = scan.exec(markup))) {
		if (m[2] === "/") continue; // Self-closing, so it opens nothing.
		depth += m[1] === "/" ? -1 : 1;
		if (depth === 0) return m.index;
	}
	return -1;
}

interface Block {
	/** Raw index of the first character inside the element. */
	start: number;
	end: number;
}

/**
 * Innermost block elements, in document order. Innermost matters because
 * `<li><p>text</p></li>` should yield the paragraph, not the list item.
 */
function findBlocks(markup: string): Block[] {
	const found: Block[] = [];
	const open = new RegExp(`<(${BLOCK_TAGS.join("|")})\\b[^>]*?(/?)>`, "gi");
	let m: RegExpExecArray | null;
	while ((m = open.exec(markup))) {
		if (m[2] === "/") continue;
		const start = m.index + m[0].length;
		const end = findClose(markup, m[1], start);
		if (end < 0) continue;
		found.push({ start, end });
	}
	return found.filter(
		(block) => !found.some((other) => other !== block && other.start >= block.start && other.end <= block.end)
	);
}

/** Removes every inline comment marker, keeping the text it wrapped. */
export function stripMarkers(storage: string): string {
	let out = storage;
	for (const pattern of MARKER_PATTERNS) {
		out = out.replace(new RegExp(pattern.source, pattern.flags), (full, _ref, inner) => {
			// Annotation spans are also used for things that are not comments.
			if (full.startsWith("<span") && !/inlineComment/i.test(full)) return full;
			return inner;
		});
	}
	return out;
}

/**
 * Reads the anchors out of the body Confluence currently holds.
 *
 * Positions are recorded against the marker-free text, because that is the
 * shape the newly converted markup will be in.
 */
export function extractAnchors(storage: string): AnchoredComment[] {
	const anchors: AnchoredComment[] = [];

	for (const pattern of MARKER_PATTERNS) {
		const scan = new RegExp(pattern.source, pattern.flags);
		let m: RegExpExecArray | null;
		while ((m = scan.exec(storage))) {
			const [full, markerRef, inner] = m;
			if (full.startsWith("<span") && !/inlineComment/i.test(full)) continue;

			const selection = mapText(inner).text;
			if (!selection) continue;

			// Re-read the surroundings with markers removed so offsets line up
			// with the markup this will later be applied to.
			const before = stripMarkers(storage.slice(0, m.index));
			const clean = stripMarkers(storage);
			const block = findBlocks(clean).find(
				(b) => b.start <= before.length && b.end >= before.length
			);
			if (!block) continue;

			const blockMap = mapText(clean.slice(block.start, block.end));
			const blockText = blockMap.text;

			// Where the selection starts, measured in the block's plain text.
			const offsetInBlock = mapText(clean.slice(block.start, before.length)).text.length;
			const occurrence = countOccurrences(blockText.slice(0, offsetInBlock), selection);

			const blockIndex = findBlocks(clean)
				.filter((b) => mapText(clean.slice(b.start, b.end)).text === blockText)
				.findIndex((b) => b.start === block.start);

			anchors.push({ markerRef, selection, blockText, blockIndex, occurrence });
		}
	}
	return anchors;
}

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let at = haystack.indexOf(needle);
	while (at !== -1) {
		count++;
		at = haystack.indexOf(needle, at + needle.length);
	}
	return count;
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Puts anchors back onto freshly converted markup.
 *
 * An anchor is only restored when its block still reads exactly as it did and
 * the selection sits inside a single run of text. A selection spanning tags is
 * left alone rather than wrapped, since splitting an element would produce
 * markup Confluence rejects outright.
 */
export function reanchorComments(storage: string, anchors: AnchoredComment[]): ReanchorResult {
	const reanchored: AnchoredComment[] = [];
	const lost: AnchoredComment[] = [];
	// Applied back-to-front so earlier edits do not shift later offsets.
	const edits: { start: number; end: number; markerRef: string }[] = [];

	const blocks = findBlocks(storage);
	const blockTexts = blocks.map((b) => mapText(storage.slice(b.start, b.end)).text);

	for (const anchor of anchors) {
		const candidates = blocks.filter((_, i) => blockTexts[i] === anchor.blockText);
		const block = candidates[anchor.blockIndex] ?? candidates[0];
		if (!block) {
			lost.push(anchor);
			continue;
		}

		const inner = storage.slice(block.start, block.end);
		const map = mapText(inner);

		let at = -1;
		for (let n = 0; n <= anchor.occurrence; n++) {
			at = map.text.indexOf(anchor.selection, n === 0 ? 0 : at + anchor.selection.length);
			if (at === -1) break;
		}
		if (at === -1) {
			lost.push(anchor);
			continue;
		}

		const rawStart = block.start + map.starts[at];
		const rawEnd = block.start + map.ends[at + anchor.selection.length - 1];
		// A selection crossing a tag boundary cannot be wrapped without
		// splitting that element, so leave it for the caller to report.
		if (storage.slice(rawStart, rawEnd).includes("<")) {
			lost.push(anchor);
			continue;
		}

		edits.push({ start: rawStart, end: rawEnd, markerRef: anchor.markerRef });
		reanchored.push(anchor);
	}

	let out = storage;
	for (const edit of edits.sort((a, b) => b.start - a.start)) {
		out =
			out.slice(0, edit.start) +
			`<ac:inline-comment-marker ac:ref="${escapeAttr(edit.markerRef)}">` +
			out.slice(edit.start, edit.end) +
			"</ac:inline-comment-marker>" +
			out.slice(edit.end);
	}

	return { storage: out, reanchored, lost };
}
