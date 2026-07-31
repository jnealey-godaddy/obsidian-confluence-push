import { App, TFile } from "obsidian";

/** A note's frontmatter, or an empty object when it has none. */
export function frontmatterOf(app: App, file: TFile): Record<string, unknown> {
	return app.metadataCache.getFileCache(file)?.frontmatter ?? {};
}

/** A trimmed, non-empty string property from a note's frontmatter, or null. */
export function frontmatterString(app: App, file: TFile, key: string): string | null {
	const value = frontmatterOf(app, file)[key];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}
