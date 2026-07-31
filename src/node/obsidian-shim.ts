/**
 * Node stand-in for the slice of the Obsidian API that `confluence.ts`,
 * `push.ts` and `vault.ts` depend on.
 *
 * The CLI bundle aliases `obsidian` to this module, so the shared modules run
 * unchanged outside the app and the CLI publishes through exactly the same
 * converter, REST client and conflict rules as the plugin. Anything not needed
 * by those three modules is deliberately absent rather than faked.
 *
 * `test/obsidian-stub.mjs` is the equivalent for the test suite. It queues
 * canned HTTP responses; this one performs real requests.
 */

export interface RequestUrlParam {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string | ArrayBuffer;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	text: string;
	json: unknown;
}

export async function requestUrl(options: RequestUrlParam): Promise<RequestUrlResponse> {
	const res = await fetch(options.url, {
		method: options.method ?? "GET",
		headers: options.headers,
		body: options.body as BodyInit | undefined,
	});
	const text = await res.text();

	if (options.throw !== false && (res.status < 200 || res.status >= 300)) {
		throw new Error(`Request failed, status ${res.status}`);
	}

	return {
		status: res.status,
		text,
		// Lazy so a non-JSON error body does not throw before the caller has
		// had a chance to read `text` instead. Matches Obsidian's behaviour.
		get json(): unknown {
			return JSON.parse(text);
		},
	};
}

export class TFile {
	path: string;
	name: string;
	basename: string;
	extension: string;

	constructor(path: string) {
		this.path = path;
		this.name = path.split("/").pop() ?? path;
		const dot = this.name.lastIndexOf(".");
		this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
		this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
	}
}

export class TFolder {
	constructor(public path: string) {}
}

export class App {}

/** Just enough of the element API for the modals the shared modules render. */
export interface StubEl {
	tag: string;
	text: string;
	children: StubEl[];
	settings: Setting[];
	createEl(tag: string, opts?: { text?: string; cls?: string }): StubEl;
	createDiv(opts?: { text?: string; cls?: string }): StubEl;
	addClass(): void;
	removeClass(): void;
	empty(): void;
	addEventListener(event: string, fn: () => void): void;
}

function makeEl(tag: string): StubEl {
	const el: StubEl = {
		tag,
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
		addClass() {},
		removeClass() {},
		empty() {
			el.children.length = 0;
			el.settings.length = 0;
		},
		addEventListener() {},
	};
	return el;
}

export interface StubButton {
	text: string;
	setButtonText(text: string): StubButton;
	setCta(): StubButton;
	setWarning(): StubButton;
	setDisabled(): StubButton;
	setIcon(): StubButton;
	onClick(fn: () => void): StubButton;
	click(): void;
}

export class Setting {
	readonly buttons: StubButton[] = [];

	constructor(containerEl: StubEl) {
		containerEl.settings.push(this);
	}

	setName(): this {
		return this;
	}
	setDesc(): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
	addText(): this {
		return this;
	}
	addToggle(): this {
		return this;
	}
	addButton(cb: (button: StubButton) => void): this {
		let handler: (() => void) | null = null;
		const button: StubButton = {
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
			},
		};
		cb(button);
		this.buttons.push(button);
		return this;
	}
}

/**
 * A modal with no screen to open on.
 *
 * `Modal.handler` decides what a headless caller does with the rendered
 * prompt. It must always either click a button or close the modal, because the
 * promise the modal resolves is what a push is waiting on.
 */
export class Modal {
	static handler: ((modal: Modal) => void) | null = null;

	contentEl: StubEl = makeEl("div");
	private closed = false;

	constructor(public app: unknown) {}

	open(): void {
		this.onOpen();
		const handler = Modal.handler ?? ((modal: Modal) => modal.button("Cancel")?.click());
		handler(this);
		// A handler that neither clicked a button nor closed the modal would
		// leave the push waiting on a promise nothing will resolve.
		if (!this.closed) this.close();
	}

	close(): void {
		this.closed = true;
		this.onClose();
	}

	onOpen(): void {}
	onClose(): void {}

	/** Finds a rendered button by its label. */
	button(label: string): StubButton | null {
		for (const setting of this.contentEl.settings) {
			const match = setting.buttons.find((b) => b.text === label);
			if (match) return match;
		}
		return null;
	}

	/** Heading and paragraphs as plain lines, for printing to a terminal. */
	describe(): string[] {
		const lines: string[] = [];
		const walk = (el: StubEl): void => {
			if (el.text) lines.push(el.text);
			el.children.forEach(walk);
		};
		this.contentEl.children.forEach(walk);
		return lines;
	}
}

export class Notice {
	constructor(public message: string) {}
	setMessage(message: string): void {
		this.message = message;
	}
	hide(): void {}
}

export class Plugin {}
export class PluginSettingTab {}
export class Menu {}
export function setIcon(): void {}
