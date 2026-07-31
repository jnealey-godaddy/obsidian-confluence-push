import { App, Modal, Setting, TFile } from "obsidian";
import { ConfluenceClient, ConfluencePage, pageIdFromUrl } from "./confluence";
import { StorageConverter } from "./storage";
import { ConfluencePushSettings } from "./settings";
import { AttachmentRef, ConversionContext, SyncRecord } from "./types";
import { frontmatterString } from "./vault";
import { extractAnchors, reanchorComments } from "./comments";

export type PushOutcome = "created" | "updated" | "skipped" | "cancelled";

export interface PushResult {
	file: TFile;
	outcome: PushOutcome;
	url: string | null;
	warnings: string[];
	attachmentsUploaded: number;
}

const MIME_TYPES: Record<string, string> = {
	png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
	svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp", avif: "image/avif",
	pdf: "application/pdf", csv: "text/csv", txt: "text/plain", md: "text/markdown",
	json: "application/json", zip: "application/zip",
	doc: "application/msword",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	ppt: "application/vnd.ms-powerpoint",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav",
};

function mimeFor(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	return MIME_TYPES[ext] || "application/octet-stream";
}

/** FNV-1a, used only to detect "nothing changed since last push". */
function hash(input: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16);
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Comma-separated quotes, trimmed so a long list stays readable. */
function quoteList(values: string[], max = 3): string {
	const shown = values.slice(0, max).map((v) => `"${v.length > 60 ? v.slice(0, 57) + "..." : v}"`);
	const rest = values.length - shown.length;
	return shown.join(", ") + (rest > 0 ? `, and ${rest} more` : "");
}

interface CommentPreservation {
	/** Markup with surviving anchors written back in. */
	storage: string;
	reanchored: number;
	/** Anchor text of comments that will end up pointing at nothing. */
	lost: string[];
}

interface OverwritePrompt {
	heading: string;
	/** One paragraph per entry, in order. */
	lines: string[];
	confirmLabel: string;
	pageUrl: string | null;
}

/** Confirms replacing remote content the user may never have seen. */
class OverwriteModal extends Modal {
	private readonly prompt: OverwritePrompt;
	private readonly resolve: (overwrite: boolean) => void;
	private decided = false;

	constructor(app: App, prompt: OverwritePrompt, resolve: (overwrite: boolean) => void) {
		super(app);
		this.prompt = prompt;
		this.resolve = resolve;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: this.prompt.heading });
		for (const line of this.prompt.lines) {
			contentEl.createEl("p", { text: line });
		}

		const controls = new Setting(contentEl);
		const url = this.prompt.pageUrl;
		if (url) {
			controls.addButton((b) =>
				b.setButtonText("Open in Confluence").onClick(() => {
					window.open(url, "_blank");
				})
			);
		}
		controls
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.decide(false)))
			.addButton((b) =>
				b
					.setButtonText(this.prompt.confirmLabel)
					.setWarning()
					.onClick(() => this.decide(true))
			);
	}

	private decide(overwrite: boolean): void {
		this.decided = true;
		this.resolve(overwrite);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		// Dismissing with Escape or the close button means "do not overwrite".
		if (!this.decided) this.resolve(false);
	}
}

export class Pusher {
	constructor(
		private readonly app: App,
		private readonly client: ConfluenceClient,
		private readonly settings: ConfluencePushSettings,
		private readonly syncState: Record<string, SyncRecord>,
		private readonly persist: () => Promise<void>
	) {}

	/** Public so the preview command titles the page the same way a push would. */
	titleFor(file: TFile): string {
		return frontmatterString(this.app, file, "title") ?? file.basename;
	}

	private confirmOverwrite(prompt: OverwritePrompt): Promise<boolean> {
		return new Promise((resolve) => new OverwriteModal(this.app, prompt, resolve).open());
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
	private buildUpdatePrompt(args: {
		title: string;
		remote: ConfluencePage;
		knownVersion: number | null;
		lostComments: string[];
	}): OverwritePrompt | null {
		const { title, remote, knownVersion, lostComments } = args;
		const versionMoved = knownVersion !== null && remote.version !== knownVersion;
		const untracked = knownVersion === null;
		if (!versionMoved && !untracked && !lostComments.length) return null;

		const lines: string[] = [];
		let heading = "Inline comments will lose their anchor";

		if (untracked) {
			heading = "Page is not tracked by this vault";
			lines.push(
				`"${title}" already exists in Confluence at version ${remote.version}, but this ` +
					"vault has no record of pushing it.",
				"That happens when the page was published from another machine or by the " +
					"/confluence skill, so there is no way to tell whether it has been edited since."
			);
		} else if (versionMoved) {
			heading = "Page changed in Confluence";
			lines.push(
				`"${title}" is at version ${remote.version} in Confluence, but version ` +
					`${knownVersion} was the last one pushed from this vault. Someone edited the ` +
					"page directly.",
				"Pushing replaces the page with your local content. Those edits will not be merged."
			);
		}

		if (lostComments.length) {
			lines.push(
				`${plural(lostComments.length, "inline comment")} cannot be carried over, because ` +
					`the text ${lostComments.length === 1 ? "it marks has" : "they mark have"} ` +
					`changed or gone: ${quoteList(lostComments)}.`,
				"Those comments stay on the page but stop pointing at anything. Comments on text " +
					"you have not edited are moved across automatically."
			);
		} else if (untracked) {
			lines.push("Pushing replaces the page with your local content.");
		}

		return { heading, lines, confirmLabel: "Overwrite", pageUrl: remote.webUrl };
	}

	/**
	 * Carries inline comment anchors from the live page onto the new markup.
	 *
	 * Footer comments need no help: they hang off the page rather than sitting
	 * inside the body, so replacing the body leaves them alone. Inline comments
	 * are anchored in the markup itself and would otherwise be orphaned on every
	 * push.
	 */
	private async preserveInlineComments(
		pageId: string,
		storage: string
	): Promise<CommentPreservation> {
		if (!this.settings.preserveInlineComments) {
			return { storage, reanchored: 0, lost: [] };
		}

		const comments = await this.client.getOpenInlineComments(pageId);
		if (!comments.length) return { storage, reanchored: 0, lost: [] };

		const current = await this.client.getPageStorage(pageId);
		if (!current) {
			return {
				storage,
				reanchored: 0,
				lost: comments.map((c) => c.originalSelection || "(unknown text)"),
			};
		}

		// Only anchors belonging to comments that are still open are worth moving.
		//
		// A comment whose marker is absent from the body is already unanchored,
		// usually by an earlier push. Reporting it would raise the same warning on
		// every push from now on for damage this one is not doing, so only
		// comments losing a live anchor count here.
		const open = new Set(comments.map((c) => c.markerRef));
		const anchors = extractAnchors(current).filter((a) => open.has(a.markerRef));
		const result = reanchorComments(storage, anchors);

		return {
			storage: result.storage,
			reanchored: result.reanchored.length,
			lost: result.lost.map((a) => a.selection),
		};
	}

	/** Public so the preview command renders with the same resolution rules as a push. */
	buildContext(file: TFile): ConversionContext {
		const prop = this.settings.frontmatterProperty;
		return {
			resolveLink: (target: string): string | null => {
				const dest = this.app.metadataCache.getFirstLinkpathDest(target, file.path);
				if (!dest) return null;

				const url = this.app.metadataCache.getFileCache(dest)?.frontmatter?.[prop];
				if (typeof url === "string" && url.trim()) return url.trim();

				// Fall back to sync state for notes published before the property
				// was written, or whose frontmatter was edited away.
				const record = this.syncState[dest.path];
				if (record) return this.client.pageUrl(record.spaceKey, record.pageId);
				return null;
			},
			resolveAttachment: (target: string): AttachmentRef | null => {
				const clean = target.split("#")[0].split("|")[0].trim();
				const dest = this.app.metadataCache.getFirstLinkpathDest(clean, file.path);
				if (!dest || dest.extension === "md") return null;
				return { filename: dest.name, vaultPath: dest.path };
			},
		};
	}

	private spaceKeyFor(file: TFile): string {
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
	private declaredParentId(file: TFile): string | null {
		const override = frontmatterString(this.app, file, "confluenceParent");
		if (!override) return null;
		return pageIdFromUrl(override) ?? override;
	}

	private parentIdFor(file: TFile): string | null {
		return this.declaredParentId(file) ?? (this.settings.defaultParentPageId || null);
	}

	/** The page this note is already bound to, from frontmatter or sync state. */
	private existingPageId(file: TFile): string | null {
		const url = frontmatterString(this.app, file, this.settings.frontmatterProperty);
		if (url) {
			const id = pageIdFromUrl(url);
			if (id) return id;
		}
		return this.syncState[file.path]?.pageId ?? null;
	}

	async push(file: TFile, opts: { force?: boolean } = {}): Promise<PushResult> {
		const warnings: string[] = [];
		const title = this.titleFor(file);
		const spaceKey = this.spaceKeyFor(file);

		if (!this.settings.siteUrl || !this.settings.email || !this.settings.apiToken) {
			throw new Error("Confluence credentials are not configured. Open the plugin settings.");
		}
		if (!spaceKey) {
			throw new Error(
				`No space for "${file.basename}". Set a default space key in settings, ` +
					"or add a confluenceSpace property to the note."
			);
		}

		const markdown = await this.app.vault.cachedRead(file);
		const converter = new StorageConverter(this.buildContext(file));
		const conversion = converter.convert(markdown, {
			skipFirstHeading: this.settings.skipDuplicateTitleHeading ? title : undefined,
		});
		warnings.push(...conversion.warnings);

		if (!conversion.storage.trim()) {
			throw new Error(`"${file.basename}" has no content to publish.`);
		}

		const contentHash = hash(`${title}\n${conversion.storage}`);
		const record = this.syncState[file.path];
		const knownPageId = this.existingPageId(file);

		let page: ConfluencePage;
		let outcome: PushOutcome;

		if (knownPageId) {
			const remote = await this.client.getPage(knownPageId);
			if (!remote) {
				// The page was deleted in Confluence; recreate it rather than fail.
				warnings.push("The linked Confluence page no longer exists, so a new page was created.");
				page = await this.createPage(file, title, spaceKey, conversion.storage);
				outcome = "created";
			} else {
				// A note that names a parent is asking for the page to live there,
				// which is a move when the page currently sits somewhere else.
				const declaredParent = this.declaredParentId(file);
				const moving = declaredParent !== null && declaredParent !== remote.parentId;

				const unchanged =
					this.settings.skipUnchanged &&
					!opts.force &&
					!moving &&
					record?.contentHash === contentHash &&
					record?.lastPushedVersion === remote.version &&
					record?.title === title;

				if (unchanged) {
					return {
						file,
						outcome: "skipped",
						url: this.client.pageUrl(spaceKey, remote.id),
						warnings,
						attachmentsUploaded: 0,
					};
				}

				const preserved = await this.preserveInlineComments(remote.id, conversion.storage);
				if (preserved.reanchored) {
					warnings.push(
						`Carried ${plural(preserved.reanchored, "inline comment")} over to the new content.`
					);
				}

				// A note bound by frontmatter alone has no local version to compare
				// against: it was published from another machine, or by the
				// /confluence skill. Treat unknown as "may have been edited"
				// rather than waving it through.
				const knownVersion = record?.lastPushedVersion ?? null;
				const prompt = this.buildUpdatePrompt({
					title,
					remote,
					knownVersion,
					lostComments: preserved.lost,
				});
				if (prompt && this.settings.warnOnRemoteEdits && !opts.force) {
					const overwrite = await this.confirmOverwrite(prompt);
					if (!overwrite) {
						return {
							file,
							outcome: "cancelled",
							url: this.client.pageUrl(spaceKey, remote.id),
							warnings,
							attachmentsUploaded: 0,
						};
					}
				}

				page = await this.client.updatePage({
					pageId: remote.id,
					title,
					storage: preserved.storage,
					nextVersion: remote.version + 1,
					message: this.settings.versionMessage,
					parentId: moving ? declaredParent : null,
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

				// Adopting replaces a page this vault has never published, so its
				// current content exists nowhere locally. Always ask first.
				if (this.settings.warnOnRemoteEdits && !opts.force) {
					const lines = [
						`A page titled "${title}" already exists in ${spaceKey} at version ${existing.version}, ` +
							"but it was not published from this vault.",
					];
					if (matches.length > 1) {
						lines.push(
							"More than one page in this space has this title. Open Confluence and check " +
								"which one you mean before replacing it."
						);
					}
					lines.push(
						"Pushing adopts that page and replaces its content with this note. Its current " +
							"content is not backed up locally."
					);
					if (adopted.lost.length) {
						lines.push(
							`${plural(adopted.lost.length, "inline comment")} on that page cannot be ` +
								`carried over: ${quoteList(adopted.lost)}.`
						);
					}
					const overwrite = await this.confirmOverwrite({
						heading: "A page with this title already exists",
						lines,
						confirmLabel: "Adopt and replace",
						pageUrl: existing.webUrl,
					});
					if (!overwrite) {
						return {
							file,
							outcome: "cancelled",
							url: this.client.pageUrl(spaceKey, existing.id),
							warnings,
							attachmentsUploaded: 0,
						};
					}
				}

				warnings.push(`Adopted the existing Confluence page titled "${title}".`);
				page = await this.client.updatePage({
					pageId: existing.id,
					title,
					storage: adopted.storage,
					nextVersion: existing.version + 1,
					message: this.settings.versionMessage,
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
					if (!(source instanceof TFile)) continue;
					const data = await this.app.vault.readBinary(source);
					await this.client.uploadAttachment(
						page.id,
						attachment.filename,
						data,
						mimeFor(attachment.filename)
					);
					attachmentsUploaded++;
				} catch (err) {
					warnings.push(`Attachment "${attachment.filename}" failed: ${(err as Error).message}`);
				}
			}
		}

		if (attachmentsUploaded) {
			// Attaching a file can bump the page version. Re-read it so the version
			// we record is the one Confluence actually holds, otherwise the next
			// push reports a conflict that never happened.
			const refreshed = await this.client.getPage(page.id);
			if (refreshed) page = refreshed;
		}

		const url = this.client.pageUrl(spaceKey, page.id);

		this.syncState[file.path] = {
			pageId: page.id,
			spaceKey,
			title,
			lastPushedVersion: page.version,
			lastPushedAt: new Date().toISOString(),
			contentHash,
		};
		await this.persist();
		await this.writeBackUrl(file, url);

		return { file, outcome, url, warnings, attachmentsUploaded };
	}

	private async createPage(
		file: TFile,
		title: string,
		spaceKey: string,
		storage: string
	): Promise<ConfluencePage> {
		const spaceId = await this.client.getSpaceId(spaceKey);
		return this.client.createPage({
			spaceId,
			title,
			storage,
			parentId: this.parentIdFor(file),
		});
	}

	private async writeBackUrl(file: TFile, url: string): Promise<void> {
		const prop = this.settings.frontmatterProperty;
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm[prop] = url;
		});
	}
}
