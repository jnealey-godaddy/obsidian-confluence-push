/**
 * Minimal stand-in for the Obsidian API so `src/confluence.ts` and `src/push.ts`
 * can be exercised outside the app. Tests push canned responses onto `queue`
 * and inspect `calls`.
 */
export const calls = [];
export const queue = [];

export async function requestUrl(options) {
	calls.push(options);
	const next = queue.shift();
	if (!next) throw new Error(`No queued response for ${options.method} ${options.url}`);
	const body = next.json === undefined ? next.text ?? "" : JSON.stringify(next.json);
	return {
		status: next.status ?? 200,
		text: body,
		get json() {
			return JSON.parse(body);
		},
	};
}

export function reset() {
	calls.length = 0;
	queue.length = 0;
	Modal.opened.length = 0;
	Modal.onOpen = null;
}

export class TFile {
	constructor(path) {
		this.path = path;
		this.name = path.split("/").pop();
		this.extension = this.name.includes(".") ? this.name.split(".").pop() : "";
		this.basename = this.name.replace(/\.[^.]+$/, "");
	}
}

export class TFolder {}
export class App {}
export class Component {}
export class Plugin {}
export class PluginSettingTab {}

/** Just enough of the element API for the modals under test. */
function makeEl(tag) {
	const el = {
		tag,
		text: "",
		cls: "",
		children: [],
		settings: [],
		handlers: {},
		createEl(t, opts = {}) {
			const child = makeEl(t);
			child.text = opts.text ?? "";
			child.cls = opts.cls ?? "";
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
		addEventListener(event, fn) {
			el.handlers[event] = fn;
		},
	};
	return el;
}

export class Setting {
	constructor(containerEl) {
		this.containerEl = containerEl;
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
		const button = {
			text: "",
			clickHandler: null,
			setButtonText(t) {
				this.text = t;
				return this;
			},
			setCta() {
				return this;
			},
			setWarning() {
				return this;
			},
			setDisabled() {
				return this;
			},
			setIcon() {
				return this;
			},
			onClick(fn) {
				this.clickHandler = fn;
				return this;
			},
			click() {
				return this.clickHandler?.();
			},
		};
		cb(button);
		this.buttons.push(button);
		return this;
	}
}

export class Modal {
	/** Every modal opened during a test, in order. */
	static opened = [];
	/** Test hook invoked after onOpen so a test can click a button. */
	static onOpen = null;

	constructor(app) {
		this.app = app;
		this.contentEl = makeEl("div");
	}
	open() {
		Modal.opened.push(this);
		this.onOpen();
		Modal.onOpen?.(this);
	}
	close() {
		this.onClose();
	}
	onOpen() {}
	onClose() {}

	/** Finds a rendered button by its label. */
	button(label) {
		for (const setting of this.contentEl.settings) {
			const match = setting.buttons.find((b) => b.text === label);
			if (match) return match;
		}
		return null;
	}
}

export class Notice {
	constructor(message) {
		this.message = message;
	}
	setMessage(message) {
		this.message = message;
	}
	hide() {}
}

export function setIcon() {}
export class Menu {}
