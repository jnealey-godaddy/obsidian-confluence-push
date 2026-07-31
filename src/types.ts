/** A local file that must be uploaded to the Confluence page as an attachment. */
export interface AttachmentRef {
	/** Filename as it will exist on the Confluence page. */
	filename: string;
	/** Vault-relative path of the source file. */
	vaultPath: string;
}

/** Hooks the converter uses to reach back into the vault. */
export interface ConversionContext {
	/**
	 * Resolve a wikilink target to an absolute URL.
	 * Returns null when the target note has not been published, in which case
	 * the link is flattened to plain text.
	 */
	resolveLink(target: string): string | null;
	/**
	 * Resolve an embedded/linked local file to an attachment.
	 * Returns null when the file cannot be found in the vault.
	 */
	resolveAttachment(target: string): AttachmentRef | null;
}

export interface ConversionResult {
	/** Confluence storage-format (XHTML) markup. */
	storage: string;
	/** Local files that need uploading, de-duplicated by filename. */
	attachments: AttachmentRef[];
	/** Non-fatal problems worth surfacing to the user. */
	warnings: string[];
}

/** Per-note sync state, persisted in the plugin's data.json (not in the note). */
export interface SyncRecord {
	pageId: string;
	spaceKey: string;
	title: string;
	/** Version number Confluence reported after our last successful push. */
	lastPushedVersion: number;
	/** ISO timestamp of the last successful push. */
	lastPushedAt: string;
	/** Hash of the storage markup we last pushed, used to skip no-op pushes. */
	contentHash: string;
}
