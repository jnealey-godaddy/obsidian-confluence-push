import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type ConfluencePushPlugin from "./main";
import { SyncRecord } from "./types";

export interface ConfluencePushSettings {
	siteUrl: string;
	email: string;
	apiToken: string;
	defaultSpaceKey: string;
	defaultParentPageId: string;
	/** Frontmatter property holding the published page URL. */
	frontmatterProperty: string;
	uploadAttachments: boolean;
	/** Drop a leading H1 that just repeats the page title. */
	skipDuplicateTitleHeading: boolean;
	/** Ask before replacing remote content this vault did not last write. */
	warnOnRemoteEdits: boolean;
	/** Skip pushing when the generated markup matches the last push. */
	skipUnchanged: boolean;
	/** Carry inline comment anchors from the live page onto the new content. */
	preserveInlineComments: boolean;
	versionMessage: string;
}

export interface PluginData {
	settings: ConfluencePushSettings;
	/** Sync state keyed by vault path, kept out of notes to leave frontmatter clean. */
	sync: Record<string, SyncRecord>;
}

export const DEFAULT_SETTINGS: ConfluencePushSettings = {
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
	versionMessage: "Updated from Obsidian",
};

export class ConfluencePushSettingTab extends PluginSettingTab {
	private plugin: ConfluencePushPlugin;

	constructor(app: App, plugin: ConfluencePushPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Connection").setHeading();

		new Setting(containerEl)
			.setName("Site URL")
			.setDesc("Your Confluence Cloud base URL, for example https://your-org.atlassian.net")
			.addText((text) =>
				text
					.setPlaceholder("https://your-org.atlassian.net")
					.setValue(this.plugin.settings.siteUrl)
					.onChange(async (value) => {
						this.plugin.settings.siteUrl = value.trim().replace(/\/+$/, "");
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Account email")
			.setDesc("The Atlassian account the API token belongs to.")
			.addText((text) =>
				text
					.setPlaceholder("you@example.com")
					.setValue(this.plugin.settings.email)
					.onChange(async (value) => {
						this.plugin.settings.email = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API token")
			.setDesc(
				"Create one at id.atlassian.com under Security > API tokens. " +
					"Stored in this plugin's data.json inside your vault."
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.autocomplete = "off";
				text
					.setPlaceholder("API token")
					.setValue(this.plugin.settings.apiToken)
					.onChange(async (value) => {
						this.plugin.settings.apiToken = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Confirms the credentials and the default space are reachable.")
			.addButton((button) =>
				button
					.setButtonText("Test")
					.setCta()
					.onClick(async () => {
						button.setDisabled(true).setButtonText("Testing...");
						try {
							const who = await this.plugin.client.verifyCredentials();
							let message = `Connected as ${who}.`;
							if (this.plugin.settings.defaultSpaceKey) {
								await this.plugin.client.getSpaceId(this.plugin.settings.defaultSpaceKey);
								message += ` Space ${this.plugin.settings.defaultSpaceKey} is reachable.`;
							}
							new Notice(message, 8000);
						} catch (err) {
							new Notice(`Connection failed: ${(err as Error).message}`, 12000);
						} finally {
							button.setDisabled(false).setButtonText("Test");
						}
					})
			);

		new Setting(containerEl).setName("Publishing target").setHeading();

		new Setting(containerEl)
			.setName("Default space key")
			.setDesc("Space used when a note does not specify one, for example DOCS.")
			.addText((text) =>
				text
					.setPlaceholder("DOCS")
					.setValue(this.plugin.settings.defaultSpaceKey)
					.onChange(async (value) => {
						this.plugin.settings.defaultSpaceKey = value.trim().toUpperCase();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Default parent page ID")
			.setDesc(
				"Optional. New pages are created under this page. " +
					"Find the ID in the page URL after /pages/."
			)
			.addText((text) =>
				text
					.setPlaceholder("123456789")
					.setValue(this.plugin.settings.defaultParentPageId)
					.onChange(async (value) => {
						this.plugin.settings.defaultParentPageId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("URL frontmatter property")
			.setDesc("Property that stores the published page URL in each note.")
			.addText((text) =>
				text
					.setPlaceholder("confluence")
					.setValue(this.plugin.settings.frontmatterProperty)
					.onChange(async (value) => {
						this.plugin.settings.frontmatterProperty = value.trim() || "confluence";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Behaviour").setHeading();

		new Setting(containerEl)
			.setName("Upload attachments")
			.setDesc("Upload embedded images and files to the page so they render in Confluence.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.uploadAttachments).onChange(async (value) => {
					this.plugin.settings.uploadAttachments = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Skip duplicate title heading")
			.setDesc("Drop a leading H1 that repeats the page title, which Confluence shows anyway.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.skipDuplicateTitleHeading)
					.onChange(async (value) => {
						this.plugin.settings.skipDuplicateTitleHeading = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Warn before replacing remote content")
			.setDesc(
				"Ask before overwriting a page whose version changed since your last push, " +
					"one this vault has no record of publishing, or an existing page being " +
					"adopted by title. This push is one-way, so that content would be lost."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.warnOnRemoteEdits).onChange(async (value) => {
					this.plugin.settings.warnOnRemoteEdits = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Skip unchanged notes")
			.setDesc("Avoid creating a new Confluence version when the content has not changed.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.skipUnchanged).onChange(async (value) => {
					this.plugin.settings.skipUnchanged = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Preserve inline comments")
			.setDesc(
				"Re-attach inline comments to the same text after publishing. Comments on text " +
					"you have edited cannot be moved, and you are told which ones before the push. " +
					"Footer comments are never affected."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.preserveInlineComments).onChange(async (value) => {
					this.plugin.settings.preserveInlineComments = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Version message")
			.setDesc("Change note recorded on each Confluence version.")
			.addText((text) =>
				text
					.setPlaceholder("Updated from Obsidian")
					.setValue(this.plugin.settings.versionMessage)
					.onChange(async (value) => {
						this.plugin.settings.versionMessage = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("Sync state").setHeading();

		const tracked = Object.keys(this.plugin.data.sync).length;
		new Setting(containerEl)
			.setName("Tracked notes")
			.setDesc(
				`${tracked} note${tracked === 1 ? "" : "s"} tracked. ` +
					"Clearing forgets page IDs and versions; it does not delete anything in Confluence."
			)
			.addButton((button) =>
				button
					.setButtonText("Clear sync state")
					.setWarning()
					.onClick(async () => {
						await this.plugin.forgetAllSyncState();
						await this.plugin.savePluginData();
						new Notice("Sync state cleared.");
						this.display();
					})
			);
	}
}
