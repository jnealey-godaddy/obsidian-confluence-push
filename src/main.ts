import { Menu, Modal, Notice, Plugin, TFile } from "obsidian";
import { ConfluenceClient } from "./confluence";
import { Pusher, PushResult } from "./push";
import { StorageConverter } from "./storage";
import {
	ConfluencePushSettingTab,
	ConfluencePushSettings,
	DEFAULT_SETTINGS,
	PluginData,
} from "./settings";
import { SyncRecord } from "./types";
import { frontmatterString } from "./vault";
import { inPlaceContents, sidecarContents, sidecarPathFor } from "./pull";
import { pageIdFromUrl } from "./confluence";

/** Shows the generated storage markup so conversion issues can be inspected. */
class PreviewModal extends Modal {
	constructor(
		app: import("obsidian").App,
		private readonly title: string,
		private readonly storage: string,
		private readonly warnings: string[]
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("confluence-push-preview");
		contentEl.createEl("h2", { text: `Storage format: ${this.title}` });

		if (this.warnings.length) {
			const list = contentEl.createEl("ul", { cls: "confluence-push-warnings" });
			for (const warning of this.warnings) {
				list.createEl("li", { text: warning });
			}
		}

		const pre = contentEl.createEl("pre", { cls: "confluence-push-code" });
		pre.createEl("code", { text: this.storage });

		const actions = contentEl.createDiv({ cls: "confluence-push-actions" });
		const copy = actions.createEl("button", { text: "Copy to clipboard" });
		copy.addEventListener("click", async () => {
			await navigator.clipboard.writeText(this.storage);
			new Notice("Storage markup copied.");
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Asks before a pull writes over a note.
 *
 * Overwriting is the one thing this plugin does that loses local text, and
 * Obsidian's editor undo does not reach a change made through the vault API,
 * so the only way back is Obsidian's file recovery. That is worth a click.
 */
class ConfirmOverwriteModal extends Modal {
	private confirmed = false;

	constructor(
		app: import("obsidian").App,
		private readonly noteName: string,
		private readonly remoteVersion: number,
		private readonly onConfirm: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: `Overwrite "${this.noteName}"?` });
		contentEl.createEl("p", {
			text:
				`Version ${this.remoteVersion} of the Confluence page will replace this note's body. ` +
				"Its frontmatter is kept, everything below it is not.",
		});
		contentEl.createEl("p", {
			text:
				"The page comes back as Confluence renders it, so absolute links and panels " +
				"land in the note permanently, and a later push sends that version back.",
		});

		const actions = contentEl.createDiv({ cls: "confluence-push-actions" });
		const cancel = actions.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		const confirm = actions.createEl("button", { text: "Overwrite note", cls: "mod-warning" });
		confirm.addEventListener("click", () => {
			this.confirmed = true;
			this.close();
		});
		// Focus Cancel, not Overwrite. The dialog traps focus and a button fires on
		// both Enter and Space, so focusing the destructive action would let one
		// habitual keystroke overwrite the note before the warning above is read.
		cancel.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.confirmed) this.onConfirm();
	}
}

export default class ConfluencePushPlugin extends Plugin {
	data!: PluginData;
	client!: ConfluenceClient;
	/** Same object as `data.settings`, so edits from the settings tab persist together. */
	settings!: ConfluencePushSettings;
	/** Note paths whose sync records this session dropped on purpose. */
	private forgotten = new Set<string>();

	async onload(): Promise<void> {
		await this.loadPluginData();

		this.client = new ConfluenceClient({
			siteUrl: this.settings.siteUrl,
			email: this.settings.email,
			apiToken: this.settings.apiToken,
		});

		this.addSettingTab(new ConfluencePushSettingTab(this.app, this));

		this.addRibbonIcon("upload", "Push to Confluence", () => {
			void this.pushActiveFile();
		});

		this.addCommand({
			id: "push-current-note",
			name: "Push current note to Confluence",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.pushActiveFile();
				return true;
			},
		});

		this.addCommand({
			id: "push-current-note-force",
			name: "Push current note to Confluence (overwrite remote changes)",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.pushActiveFile({ force: true });
				return true;
			},
		});

		this.addCommand({
			id: "push-all-published",
			name: "Push all published notes to Confluence",
			callback: () => {
				void this.pushAllPublished();
			},
		});

		this.addCommand({
			id: "preview-storage-format",
			name: "Preview Confluence storage format for current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.previewActiveFile();
				return true;
			},
		});

		this.addCommand({
			id: "pull-confluence-copy",
			name: "Pull Confluence version of current note for review",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!this.publishedUrl(file)) return false;
				if (!checking) void this.pullToSidecar(file);
				return true;
			},
		});

		this.addCommand({
			id: "pull-confluence-in-place",
			name: "Pull Confluence version over current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!this.publishedUrl(file)) return false;
				if (!checking) void this.pullOverNote(file);
				return true;
			},
		});

		this.addCommand({
			id: "open-confluence-page",
			name: "Open Confluence page for current note",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				const url = this.publishedUrl(file);
				if (!url) return false;
				if (!checking) window.open(url, "_blank");
				return true;
			},
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file) => {
				if (!(file instanceof TFile) || file.extension !== "md") return;
				menu.addItem((item) =>
					item
						.setTitle("Push to Confluence")
						.setIcon("upload")
						.onClick(() => void this.pushFile(file))
				);
				const url = this.publishedUrl(file);
				if (url) {
					// Only offered for a published note: there is nothing to pull back
					// from a note that has never been up there. It asks before writing.
					menu.addItem((item) =>
						item
							.setTitle("Pull from Confluence (overwrite)")
							.setIcon("download")
							.onClick(() => void this.pullOverNote(file))
					);
					menu.addItem((item) =>
						item
							.setTitle("Open in Confluence")
							.setIcon("external-link")
							.onClick(() => window.open(url, "_blank"))
					);
				}
			})
		);

		// Keep sync state pointing at the right note when files move.
		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				const record = this.data.sync[oldPath];
				if (!record) return;
				delete this.data.sync[oldPath];
				this.forget(oldPath);
				this.data.sync[file.path] = record;
				await this.savePluginData();
			})
		);
	}

	async loadPluginData(): Promise<void> {
		const raw = (await this.loadData()) as Partial<PluginData> | null;
		this.data = {
			settings: Object.assign({}, DEFAULT_SETTINGS, raw?.settings ?? {}),
			sync: (raw?.sync ?? {}) as Record<string, SyncRecord>,
		};
		this.settings = this.data.settings;
	}

	/**
	 * Saves plugin data, keeping sync records written by the command-line
	 * pusher since this session loaded.
	 *
	 * `data.json` is shared with a separate process, so a plain overwrite would
	 * forget every push made from the terminal and make those notes look
	 * untracked the next time the plugin saved anything. Records this session
	 * deliberately dropped are held back so a rename or a clear still sticks.
	 */
	async savePluginData(): Promise<void> {
		const onDisk = (await this.loadData()) as Partial<PluginData> | null;
		for (const [notePath, record] of Object.entries(onDisk?.sync ?? {})) {
			if (this.forgotten.has(notePath)) continue;
			const mine = this.data.sync[notePath];
			if (!mine || record.lastPushedAt > mine.lastPushedAt) {
				this.data.sync[notePath] = record;
			}
		}
		await this.saveData(this.data);
	}

	/** Marks sync records as intentionally dropped, so the merge above leaves them out. */
	forget(...notePaths: string[]): void {
		for (const notePath of notePaths) this.forgotten.add(notePath);
	}

	/** Drops every sync record, including any the CLI wrote straight to disk. */
	async forgetAllSyncState(): Promise<void> {
		const onDisk = (await this.loadData()) as Partial<PluginData> | null;
		this.forget(...Object.keys(this.data.sync), ...Object.keys(onDisk?.sync ?? {}));
		this.data.sync = {};
	}

	async saveSettings(): Promise<void> {
		await this.savePluginData();
		this.client.updateCredentials({
			siteUrl: this.settings.siteUrl,
			email: this.settings.email,
			apiToken: this.settings.apiToken,
		});
	}

	private publishedUrl(file: TFile): string | null {
		const url = frontmatterString(this.app, file, this.settings.frontmatterProperty);
		if (url) return url;
		const record = this.data.sync[file.path];
		if (record) return this.client.pageUrl(record.spaceKey, record.pageId);
		return null;
	}

	private newPusher(persist?: () => Promise<void>): Pusher {
		return new Pusher(
			this.app,
			this.client,
			this.settings,
			this.data.sync,
			persist ?? (() => this.savePluginData())
		);
	}

	private async pushActiveFile(opts: { force?: boolean } = {}): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("Open a Markdown note to push it to Confluence.");
			return;
		}
		await this.pushFile(file, opts);
	}

	private async pushFile(file: TFile, opts: { force?: boolean } = {}): Promise<void> {
		const notice = new Notice(`Pushing "${file.basename}" to Confluence...`, 0);
		try {
			const result = await this.newPusher().push(file, opts);
			notice.hide();
			this.reportSingle(result);
		} catch (err) {
			notice.hide();
			new Notice(`Push failed: ${(err as Error).message}`, 12000);
			console.error("[confluence-push] push failed", err);
		}
	}

	private reportSingle(result: PushResult): void {
		const name = result.file.basename;
		if (result.outcome === "cancelled") {
			new Notice(`Push cancelled for "${name}".`, 5000);
			return;
		}
		if (result.outcome === "skipped") {
			new Notice(`"${name}" is already up to date in Confluence.`, 5000);
			return;
		}

		const verb = result.outcome === "created" ? "Created" : "Updated";
		const attachments = result.attachmentsUploaded
			? `, ${result.attachmentsUploaded} attachment${result.attachmentsUploaded === 1 ? "" : "s"}`
			: "";
		new Notice(`${verb} "${name}" in Confluence${attachments}.`, 6000);

		if (result.warnings.length) {
			new Notice(
				`${name}: ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}\n` +
					result.warnings.map((w) => `- ${w}`).join("\n"),
				12000
			);
		}
	}

	private async pushAllPublished(): Promise<void> {
		const prop = this.settings.frontmatterProperty;
		const files = this.app.vault.getMarkdownFiles().filter((file) => {
			if (this.data.sync[file.path]) return true;
			return frontmatterString(this.app, file, prop) !== null;
		});

		if (!files.length) {
			new Notice("No published notes found. Push a note once to start tracking it.");
			return;
		}

		const notice = new Notice(`Pushing 0/${files.length} notes...`, 0);
		// Saving after every note rewrites the whole of data.json each time, and
		// that serialising runs on the main thread, so a long sweep would stutter
		// the editor once per note. Mark it dirty here and save once at the end,
		// which the finally below guarantees even if the sweep breaks partway.
		let dirty = false;
		const pusher = this.newPusher(async () => {
			dirty = true;
		});
		let created = 0;
		let updated = 0;
		let skipped = 0;
		let cancelled = 0;
		const failures: string[] = [];

		try {
			for (let i = 0; i < files.length; i++) {
				notice.setMessage(`Pushing ${i + 1}/${files.length}: ${files[i].basename}`);
				try {
					const result = await pusher.push(files[i]);
					if (result.outcome === "created") created++;
					else if (result.outcome === "updated") updated++;
					else if (result.outcome === "skipped") skipped++;
					else cancelled++;
				} catch (err) {
					failures.push(`${files[i].basename}: ${(err as Error).message}`);
					console.error(`[confluence-push] failed to push ${files[i].path}`, err);
				}
			}
		} finally {
			if (dirty) await this.savePluginData();
		}

		notice.hide();
		const parts = [
			`${updated} updated`,
			`${created} created`,
			`${skipped} unchanged`,
		];
		if (cancelled) parts.push(`${cancelled} cancelled`);
		if (failures.length) parts.push(`${failures.length} failed`);
		new Notice(`Confluence push complete: ${parts.join(", ")}.`, 10000);

		if (failures.length) {
			new Notice(`Failures:\n${failures.map((f) => `- ${f}`).join("\n")}`, 15000);
		}
	}

	/**
	 * Brings what Confluence holds back down, beside the note or over it.
	 *
	 * Confluence renders the Markdown itself, so a page comes back normalised
	 * rather than as the Markdown that was pushed. By default that goes in a
	 * review copy and deciding what to carry across stays with the reader.
	 * In place, the reader has already decided, and is asked to confirm.
	 */
	private async pullToSidecar(file: TFile): Promise<void> {
		return this.pull(file, { inPlace: false });
	}

	private async pullOverNote(file: TFile): Promise<void> {
		return this.pull(file, { inPlace: true });
	}

	private async pull(file: TFile, opts: { inPlace: boolean }): Promise<void> {
		const { inPlace } = opts;
		if (file.extension !== "md") return;

		const record = this.data.sync[file.path];
		const url = frontmatterString(this.app, file, this.settings.frontmatterProperty);
		const pageId = record?.pageId ?? (url ? pageIdFromUrl(url) : null);
		if (!pageId) {
			new Notice(`"${file.basename}" is not published, so there is nothing to pull.`);
			return;
		}

		const notice = new Notice(`Pulling "${file.basename}" from Confluence...`, 0);
		try {
			const remote = await this.client.getPageMarkdown(pageId);
			notice.hide();
			if (!remote) {
				new Notice(`That page no longer exists in Confluence.`, 8000);
				return;
			}

			const drift =
				record && record.lastPushedVersion !== remote.version
					? `Confluence is at version ${remote.version}, you last pushed ${record.lastPushedVersion}.`
					: "";

			if (inPlace) {
				new ConfirmOverwriteModal(this.app, file.basename, remote.version, () => {
					void (async () => {
						const existing = await this.app.vault.read(file);
						await this.app.vault.modify(file, inPlaceContents({ existing, remote }));
						// The note now holds what Confluence holds, so it should stop
						// reporting as drifted. contentHash is left alone on purpose: this
						// body renders to different markup than the one last pushed, and
						// stamping the hash would make the next push skip as a no-op and
						// leave the page stale.
						if (record) {
							this.data.sync[file.path] = { ...record, lastPushedVersion: remote.version };
							await this.savePluginData();
						}
						new Notice(`Overwrote "${file.basename}" with the Confluence version.`, 8000);
					})();
				}).open();
				return;
			}

			const target = sidecarPathFor(file.path);
			const contents = sidecarContents({
				remote,
				notePath: file.path,
				url: this.client.pageUrl(record?.spaceKey ?? this.settings.defaultSpaceKey, pageId),
				lastPushedVersion: record?.lastPushedVersion ?? null,
				pulledAt: new Date().toISOString(),
			});

			const existing = this.app.vault.getAbstractFileByPath(target);
			if (existing instanceof TFile) await this.app.vault.modify(existing, contents);
			else await this.app.vault.create(target, contents);

			await this.app.workspace.openLinkText(target, "", true);
			new Notice(`Saved a review copy beside the note. ${drift}`.trim(), 8000);
		} catch (err) {
			notice.hide();
			new Notice(`Pull failed: ${(err as Error).message}`, 12000);
			console.error("[confluence-push] pull failed", err);
		}
	}

	private async previewActiveFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") return;

		const markdown = await this.app.vault.cachedRead(file);

		// Reuse the pusher's title and vault-resolution rules so the preview
		// matches a real push.
		const pusher = this.newPusher();
		const title = pusher.titleFor(file);
		const context = pusher.buildContext(file);

		const result = new StorageConverter(context).convert(markdown, {
			skipFirstHeading: this.settings.skipDuplicateTitleHeading ? title : undefined,
		});
		new PreviewModal(this.app, title, result.storage, result.warnings).open();
	}
}
