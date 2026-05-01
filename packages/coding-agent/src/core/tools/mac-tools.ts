/**
 * macOS GUI automation tools.
 * Ported from Jarvis (harness) mac tools — app lifecycle, UI reading,
 * clipboard, AppleScript, keystrokes, notifications, TTS.
 */

import { execSync, execFileSync, spawnSync } from "node:child_process";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.js";
import { defineTool } from "../extensions/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function osa(script: string, timeout = 30): string {
	try {
		const r = execSync(`osascript -e ${JSON.stringify(script)}`, {
			encoding: "utf-8",
			timeout: timeout * 1000,
			maxBuffer: 1024 * 1024,
		}).trim();
		return r || "OK";
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return `ERROR: ${msg}`;
	}
}

function osaJxa(script: string, args: string[], timeout = 25): string {
	try {
		const fullScript = script + "\n" + args.map((a) => JSON.stringify(a)).join("\n");
		const r = execSync(`osascript -l JavaScript -e ${JSON.stringify(fullScript)}`, {
			encoding: "utf-8",
			timeout: timeout * 1000,
			maxBuffer: 2 * 1024 * 1024,
		}).trim();
		return r || "(empty result)";
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return `ERROR: ${msg}`;
	}
}

/** JXA script for reading the accessibility UI tree */
const READ_UI_JXA = `
function run() {
    var app = Arguments[0] || "";
    var maxDepth = parseInt(Arguments[1]) || 7;
    var maxLines = parseInt(Arguments[2]) || 400;
    var system = Application("System Events");
    var target = app ? system.processes.byName(app) : system.processes.whose({ frontmost: true })[0];
    if (!target) return "ERROR: app not found";
    var lines = [];
    function walk(el, depth) {
        if (lines.length >= maxLines) return;
        if (depth > maxDepth) return;
        try {
            var role = el.role() || "";
            var name = el.name() || "";
            var value = el.value() || "";
            var desc = el.description() || "";
            var pos = el.position();
            var size = el.size();
            var indent = "  ".repeat(depth);
            var coords = pos && size ? " [" + Math.round(pos.x + size.width/2) + "," + Math.round(pos.y + size.height/2) + "]" : "";
            var parts = [indent + role + coords];
            if (name) parts.push(' "' + name + '"');
            if (value && value !== name) parts.push('=' + value);
            if (desc && desc !== name) parts.push(' (' + desc + ')');
            lines.push(parts.join(""));
            var children = el.elements();
            for (var i = 0; i < children.length; i++) walk(children[i], depth + 1);
        } catch(e) {}
    }
    walk(target, 0);
    return lines.join("\\n");
}
`.trim();

/** JXA script for finding and clicking an element by text */
const FIND_CLICK_JXA = `
function run() {
    var app = Arguments[0];
    var query = Arguments[1].toLowerCase();
    var roleFilter = Arguments[2].toLowerCase();
    var nth = parseInt(Arguments[3]) || 1;
    var system = Application("System Events");
    var target = system.processes.byName(app);
    if (!target) return "ERROR: app not found";
    var matches = [];
    function walk(el) {
        try {
            var role = (el.role() || "").toLowerCase();
            var name = (el.name() || "").toLowerCase();
            var value = (el.value() || "").toLowerCase();
            var desc = (el.description() || "").toLowerCase();
            if (name.includes(query) || value.includes(query) || desc.includes(query)) {
                if (!roleFilter || role === roleFilter) matches.push(el);
            }
            var children = el.elements();
            for (var i = 0; i < children.length; i++) walk(children[i]);
        } catch(e) {}
    }
    walk(target);
    if (matches.length === 0) return "ERROR: no element found matching \\"" + Arguments[1] + "\\"";
    if (nth > matches.length) nth = matches.length;
    var el = matches[nth - 1];
    try { el.clickAt(el.position()); return "clicked #" + nth + " " + (el.role() || "") + ' "' + (el.name() || "") + '"'; }
    catch(e) { return "ERROR: click failed: " + e.message; }
}
`.trim();

// ── Tools ────────────────────────────────────────────────────────────────────

export const launchAppTool: ToolDefinition = defineTool({
	name: "launch_app",
	label: "Launch App",
	description:
		"Launch a Mac app by name (e.g. 'WhatsApp', 'Safari'). " +
		"Waits for the process to register and brings it to front.",
	promptSnippet: "Launch a Mac application by name",
	parameters: Type.Object({ name: Type.String() }),
	execute: async (_toolCallId, params: { name: string }, _signal, _onUpdate, _ctx) => {
		const { name } = params;
		const r = spawnSync("open", ["-a", name], { encoding: "utf-8", timeout: 10_000 });
		if (r.status !== 0) {
			throw new Error(r.stderr?.trim() || "could not open " + name);
		}
		for (let i = 0; i < 15; i++) {
			try {
				const probe = execSync(
					`osascript -e 'tell application "System Events" to exists (process "${name}")'`,
					{ encoding: "utf-8", timeout: 3000 },
				).trim();
				if (probe === "true") break;
			} catch {}
		}
		osa(`tell application "${name}" to activate`);
		return { content: [{ type: "text" as const, text: `launched and focused ${name}` }], details: undefined };
	},
});

export const focusAppTool: ToolDefinition = defineTool({
	name: "focus_app",
	label: "Focus App",
	description: "Bring a running Mac app to front / activate it.",
	promptSnippet: "Bring a running Mac app to front",
	parameters: Type.Object({ name: Type.String() }),
	execute: async (_toolCallId, params: { name: string }, _signal, _onUpdate, _ctx) => {
		return { content: [{ type: "text" as const, text: osa(`tell application "${params.name}" to activate`) }], details: undefined };
	},
});

export const quitAppTool: ToolDefinition = defineTool({
	name: "quit_app",
	label: "Quit App",
	description: "Quit a Mac app gracefully.",
	promptSnippet: "Quit a running Mac app",
	parameters: Type.Object({ name: Type.String() }),
	execute: async (_toolCallId, params: { name: string }, _signal, _onUpdate, _ctx) => {
		return { content: [{ type: "text" as const, text: osa(`tell application "${params.name}" to quit`) }], details: undefined };
	},
});

export const listAppsTool: ToolDefinition = defineTool({
	name: "list_apps",
	label: "List Running Apps",
	description: "List visible running Mac applications.",
	promptSnippet: "List running Mac applications",
	parameters: Type.Object({}),
	execute: async (_toolCallId, _params: {}, _signal, _onUpdate, _ctx) => {
		return {
			content: [{ type: "text" as const, text: osa('tell application "System Events" to get name of (every process whose background only is false)') }],
			details: undefined,
		};
	},
});

export const frontmostAppTool: ToolDefinition = defineTool({
	name: "frontmost_app",
	label: "Frontmost App",
	description: "Get the name of the frontmost (active) Mac app.",
	promptSnippet: "Get the frontmost Mac app name",
	parameters: Type.Object({}),
	execute: async (_toolCallId, _params: {}, _signal, _onUpdate, _ctx) => {
		return {
			content: [{ type: "text" as const, text: osa('tell application "System Events" to get name of first process whose frontmost is true') }],
			details: undefined,
		};
	},
});

export const applescriptTool: ToolDefinition = defineTool({
	name: "applescript",
	label: "AppleScript Runner",
	description:
		"Run arbitrary AppleScript. Highest-leverage Mac automation. " +
		"Use for Messages, Mail, Safari, Finder, Music, Notes, Reminders, Calendar, System Events.",
	promptSnippet: "Run arbitrary AppleScript code",
	promptGuidelines: [
		"Use applescript for Messages, Mail, Safari, Finder, Music, Notes, Reminders, Calendar",
		"Prefer applescript over multiple click/type steps for structured tasks",
	],
	parameters: Type.Object({
		code: Type.String({ description: "AppleScript code to execute" }),
		timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default 60)" })),
	}),
	execute: async (_toolCallId, params: { code: string; timeout?: number }, _signal, _onUpdate, _ctx) => {
		const timeout = params.timeout ?? 60;
		return { content: [{ type: "text" as const, text: osa(params.code, timeout) }], details: undefined };
	},
});

export const readUiTool: ToolDefinition = defineTool({
	name: "read_ui",
	label: "Read UI Tree",
	description:
		"Read the accessibility UI tree of an app as text (no screenshot, no OCR). " +
		"Hierarchical dump of every visible element: role, name, value, description, and center coordinates. " +
		"Use this to SEE the screen before deciding what to click or type.",
	promptSnippet: "Read accessibility UI tree of an app as text",
	parameters: Type.Object({
		app: Type.Optional(Type.String({ description: "App name; blank = frontmost" })),
		maxDepth: Type.Optional(Type.Number({ description: "Max tree depth (default 7)" })),
		maxLines: Type.Optional(Type.Number({ description: "Max lines (default 400)" })),
		maxChars: Type.Optional(Type.Number({ description: "Max output chars (default 14000)" })),
	}),
	execute: async (_toolCallId, params: { app?: string; maxDepth?: number; maxLines?: number; maxChars?: number }, _signal, _onUpdate, _ctx) => {
		const app = params.app ?? "";
		const maxDepth = params.maxDepth ?? 7;
		const maxLines = params.maxLines ?? 400;
		const maxChars = params.maxChars ?? 14000;
		const result = osaJxa(READ_UI_JXA, [app, String(maxDepth), String(maxLines)]);
		const truncated = result.length > maxChars ? result.slice(0, maxChars) + `\n… [truncated, ${result.length} chars total]` : result;
		return { content: [{ type: "text" as const, text: truncated }], details: undefined };
	},
});

export const clickElementTool: ToolDefinition = defineTool({
	name: "click_element",
	label: "Click UI Element",
	description:
		"Find a UI element by text (matches name/value/description, case-insensitive) and click it. " +
		"Much more reliable than click_at. Optional role filter ('button', 'row', 'textfield', 'link', …).",
	promptSnippet: "Click a UI element by text match",
	parameters: Type.Object({
		app: Type.String({ description: "App name" }),
		query: Type.String({ description: "Text to match (name/value/description)" }),
		role: Type.Optional(Type.String({ description: "Role filter e.g. 'button', 'row'" })),
		nth: Type.Optional(Type.Number({ description: "Match index (1-based, default 1)" })),
	}),
	execute: async (_toolCallId, params: { app: string; query: string; role?: string; nth?: number }, _signal, _onUpdate, _ctx) => {
		const result = osaJxa(FIND_CLICK_JXA, [params.app, params.query, params.role ?? "", String(params.nth ?? 1)]);
		return { content: [{ type: "text" as const, text: result }], details: undefined };
	},
});

export const waitTool: ToolDefinition = defineTool({
	name: "wait",
	label: "Wait / Sleep",
	description: "Sleep N seconds to let the UI settle after a click/keystroke before reading it again.",
	promptSnippet: "Wait for UI to settle",
	parameters: Type.Object({
		seconds: Type.Number({ description: "Number of seconds to sleep (0.1 - 30)" }),
	}),
	execute: async (_toolCallId, params: { seconds: number }, _signal, _onUpdate, _ctx) => {
		const seconds = Math.max(0.1, Math.min(30, params.seconds));
		await new Promise((r) => setTimeout(r, seconds * 1000));
		return { content: [{ type: "text" as const, text: `waited ${seconds}s` }], details: undefined };
	},
});

export const checkPermissionsTool: ToolDefinition = defineTool({
	name: "check_permissions",
	label: "Check Accessibility Permissions",
	description: "Verify macOS Accessibility permission is granted to the terminal. Call this first if UI tools are failing.",
	promptSnippet: "Check macOS accessibility permissions",
	parameters: Type.Object({}),
	execute: async (_toolCallId, _params: {}, _signal, _onUpdate, _ctx) => {
		try {
			const r = execSync(
				`osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`,
				{ encoding: "utf-8", timeout: 5000 },
			).trim();
			return { content: [{ type: "text" as const, text: `Accessibility OK. Frontmost app: ${r}` }], details: undefined };
		} catch {
			throw new Error("Accessibility permission denied. Enable it in System Settings → Privacy & Security → Accessibility.");
		}
	},
});

export const typeTextTool: ToolDefinition = defineTool({
	name: "type_text",
	label: "Type Text",
	description: "Type a string into the frontmost app via keystroke simulation.",
	promptSnippet: "Type text into the frontmost app",
	parameters: Type.Object({ text: Type.String() }),
	execute: async (_toolCallId, params: { text: string }, _signal, _onUpdate, _ctx) => {
		const escaped = params.text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		return { content: [{ type: "text" as const, text: osa(`tell application "System Events" to keystroke "${escaped}"`) }], details: undefined };
	},
});

const KEYCODES: Record<string, number> = {
	return: 36, enter: 36, tab: 48, space: 49, delete: 51, backspace: 51,
	escape: 53, esc: 53, left: 123, right: 124, down: 125, up: 126,
	home: 115, end: 119, pageup: 116, pagedown: 121,
	f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98,
	f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
};

export const keyPressTool: ToolDefinition = defineTool({
	name: "key_press",
	label: "Press Key",
	description:
		"Press a key or chord into the frontmost app, e.g. 'return', 'cmd+f', 'cmd+shift+t', 'down'.",
	promptSnippet: "Press a key or keyboard shortcut",
	parameters: Type.Object({ keys: Type.String({ description: "Key or chord, e.g. 'return', 'cmd+f', 'down'" }) }),
	execute: async (_toolCallId, params: { keys: string }, _signal, _onUpdate, _ctx) => {
		const parts = params.keys.toLowerCase().split("+");
		const mods: Record<string, string> = {
			cmd: "command down", command: "command down",
			shift: "shift down", opt: "option down", option: "option down",
			alt: "option down", ctrl: "control down", control: "control down",
		};
		const modFlags = parts.filter((p) => mods[p]).map((p) => mods[p]);
		const key = parts.filter((p) => !mods[p]);
		if (key.length !== 1) throw new Error(`bad key spec: ${params.keys}`);

		const k = key[0];
		const using = modFlags.length > 0 ? ` using {${modFlags.join(", ")}}` : "";
		let script: string;
		if (k in KEYCODES) {
			script = `tell application "System Events" to key code ${KEYCODES[k]}${using}`;
		} else {
			const esc = k.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
			script = `tell application "System Events" to keystroke "${esc}"${using}`;
		}
		return { content: [{ type: "text" as const, text: osa(script) }], details: undefined };
	},
});

export const clickMenuTool: ToolDefinition = defineTool({
	name: "click_menu",
	label: "Click Menu Item",
	description: "Click a menu item by path, e.g. app='Safari', path=['File', 'New Window'].",
	promptSnippet: "Click a menu bar item",
	parameters: Type.Object({
		app: Type.String(),
		path: Type.Array(Type.String(), { description: "Menu path e.g. ['File', 'New Window']" }),
	}),
	execute: async (_toolCallId, params: { app: string; path: string[] }, _signal, _onUpdate, _ctx) => {
		const { app, path } = params;
		if (path.length === 0) throw new Error("path required");
		if (path.length === 1) {
			return { content: [{ type: "text" as const, text: osa(`tell application "System Events" to tell process "${app}" to click menu bar item "${path[0]}" of menu bar 1`) }], details: undefined };
		}
		let ref = `menu item "${path[path.length - 1]}"`;
		for (let i = path.length - 2; i > 0; i--) {
			ref = `${ref} of menu "${path[i]}" of menu item "${path[i]}"`;
		}
		ref = `${ref} of menu "${path[0]}" of menu bar item "${path[0]}" of menu bar 1`;
		return { content: [{ type: "text" as const, text: osa(`tell application "System Events" to tell process "${app}" to click ${ref}`) }], details: undefined };
	},
});

export const clickAtTool: ToolDefinition = defineTool({
	name: "click_at",
	label: "Click at Coordinates",
	description: "Click at absolute screen coordinates (last resort — prefer click_element).",
	promptSnippet: "Click at screen coordinates",
	parameters: Type.Object({
		x: Type.Integer({ description: "X coordinate" }),
		y: Type.Integer({ description: "Y coordinate" }),
	}),
	execute: async (_toolCallId, params: { x: number; y: number }, _signal, _onUpdate, _ctx) => {
		return { content: [{ type: "text" as const, text: osa(`tell application "System Events" to click at {${params.x}, ${params.y}}`) }], details: undefined };
	},
});

export const clipboardGetTool: ToolDefinition = defineTool({
	name: "clipboard_get",
	label: "Get Clipboard",
	description: "Return current macOS clipboard text content.",
	promptSnippet: "Get text from clipboard",
	parameters: Type.Object({}),
	execute: async (_toolCallId, _params: {}, _signal, _onUpdate, _ctx) => {
		try {
			const text = execSync("pbpaste", { encoding: "utf-8", timeout: 5000 });
			return { content: [{ type: "text" as const, text: text || "(clipboard is empty)" }], details: undefined };
		} catch {
			throw new Error("could not read clipboard");
		}
	},
});

export const clipboardSetTool: ToolDefinition = defineTool({
	name: "clipboard_set",
	label: "Set Clipboard",
	description: "Set the macOS clipboard text content.",
	promptSnippet: "Set clipboard text",
	parameters: Type.Object({ text: Type.String() }),
	execute: async (_toolCallId, params: { text: string }, _signal, _onUpdate, _ctx) => {
		try {
			const proc = spawnSync("pbcopy", { input: params.text, encoding: "utf-8", timeout: 5000 });
			if (proc.status !== 0) throw new Error(proc.stderr);
			return { content: [{ type: "text" as const, text: `clipboard set (${params.text.length} chars)` }], details: undefined };
		} catch (err: unknown) {
			throw new Error(err instanceof Error ? err.message : String(err));
		}
	},
});

export const openUrlTool: ToolDefinition = defineTool({
	name: "open_url",
	label: "Open URL",
	description: "Open a URL or file path in the default macOS handler (e.g. 'https://…', 'whatsapp://send?phone=…').",
	promptSnippet: "Open URL in default handler",
	parameters: Type.Object({ url: Type.String() }),
	execute: async (_toolCallId, params: { url: string }, _signal, _onUpdate, _ctx) => {
		try {
			execFileSync("open", [params.url], { timeout: 5000 });
			return { content: [{ type: "text" as const, text: "opened" }], details: undefined };
		} catch (err: unknown) {
			throw new Error(err instanceof Error ? err.message : String(err));
		}
	},
});

export const notifyTool: ToolDefinition = defineTool({
	name: "notify",
	label: "Show Notification",
	description: "Show a macOS notification banner.",
	promptSnippet: "Show macOS notification",
	parameters: Type.Object({
		title: Type.String(),
		message: Type.Optional(Type.String()),
	}),
	execute: async (_toolCallId, params: { title: string; message?: string }, _signal, _onUpdate, _ctx) => {
		const title = params.title.replace(/"/g, '\\"');
		const msg = (params.message || "").replace(/"/g, '\\"');
		return { content: [{ type: "text" as const, text: osa(`display notification "${msg}" with title "${title}"`) }], details: undefined };
	},
});

export const speckTool: ToolDefinition = defineTool({
	name: "speck",
	label: "Speak Text Aloud (TTS)",
	description:
		"Speak text aloud using macOS Text-to-Speech (the \`say\` command). " +
		"Use only for brief, human-style utterances — a few words, not a paragraph. " +
		"Optional voice, optional rate (words/min, 0=default).",
	promptSnippet: "Speak text aloud via macOS TTS (brief only)",
	parameters: Type.Object({
		text: Type.String({ description: "A handful of words or one very short sentence" }),
		voice: Type.Optional(Type.String({ description: "Voice name; omit for default. Run 'say -v \"?\"' to list" })),
		rate: Type.Optional(Type.Number({ description: "Speech rate in words per minute; 0 = default" })),
	}),
	execute: async (_toolCallId, params: { text: string; voice?: string; rate?: number }, _signal, _onUpdate, _ctx) => {
		const text = params.text.trim();
		if (!text) throw new Error("text is empty");
		if (text.length > 500) throw new Error("text too long (max 500 chars for TTS)");

		const cmd = ["say"];
		if (params.voice) cmd.push("-v", params.voice);
		if (params.rate && params.rate > 0) cmd.push("-r", String(params.rate));

		try {
			const proc = spawnSync(cmd[0], cmd.slice(1), { input: text, encoding: "utf-8", timeout: Math.min(600_000, Math.max(30_000, text.length * 50)) });
			if (proc.status !== 0) throw new Error(proc.stderr?.trim() || "say failed");
			return { content: [{ type: "text" as const, text: "spoke" }], details: undefined };
		} catch (err: unknown) {
			throw new Error(err instanceof Error ? err.message : String(err));
		}
	},
});

export const shortcutRunTool: ToolDefinition = defineTool({
	name: "shortcut_run",
	label: "Run Shortcut",
	description: "Run an Apple Shortcut by name, optionally with text input.",
	promptSnippet: "Run an Apple Shortcut",
	parameters: Type.Object({
		name: Type.String(),
		inputText: Type.Optional(Type.String()),
	}),
	execute: async (_toolCallId, params: { name: string; inputText?: string }, _signal, _onUpdate, _ctx) => {
		try {
			const proc = spawnSync("shortcuts", ["run", params.name], { input: params.inputText ?? "", encoding: "utf-8", timeout: 120_000 });
			const out = proc.stdout + (proc.stderr ? `\n[stderr]\n${proc.stderr}` : "");
			return { content: [{ type: "text" as const, text: out.trim() || "OK" }], details: undefined };
		} catch (err: unknown) {
			throw new Error(err instanceof Error ? err.message : String(err));
		}
	},
});

export const macControlTool: ToolDefinition = defineTool({
	name: "mac_control",
	label: "Mac System Control",
	description:
		"System controls. action ∈ {volume, mute, unmute, battery, wifi_on, wifi_off, sleep, lock, dark_mode, light_mode, toggle_dark}.",
	promptSnippet: "Control macOS system settings",
	parameters: Type.Object({
		action: Type.String({ description: "Action: volume, mute, unmute, battery, wifi_on, wifi_off, sleep, lock, dark_mode, light_mode, toggle_dark" }),
		value: Type.Optional(Type.String({ description: "Optional value (e.g. volume level)" })),
	}),
	execute: async (_toolCallId, params: { action: string; value?: string }, _signal, _onUpdate, _ctx) => {
		const a = params.action.toLowerCase();
		const v = params.value ?? "";
		let result: string;

		switch (a) {
			case "volume":
				result = osa(`set volume output volume ${parseInt(v) || 50}`);
				break;
			case "mute":
				result = osa("set volume with output muted");
				break;
			case "unmute":
				result = osa("set volume without output muted");
				break;
			case "battery": {
				try {
					result = execSync("pmset -g batt | tail -1", { encoding: "utf-8", timeout: 5000 }).trim();
				} catch { result = "ERROR: could not read battery status"; }
				break;
			}
			case "wifi_on": {
				try { execSync("networksetup -setairportpower en0 on", { timeout: 5000 }); result = "wifi on"; }
				catch { result = "ERROR: could not enable wifi"; }
				break;
			}
			case "wifi_off": {
				try { execSync("networksetup -setairportpower en0 off", { timeout: 5000 }); result = "wifi off"; }
				catch { result = "ERROR: could not disable wifi"; }
				break;
			}
			case "sleep":
				try { execSync("pmset sleepnow", { timeout: 3000 }); result = "sleeping"; }
				catch { result = "ERROR: could not sleep"; }
				break;
			case "lock":
				result = osa('tell application "System Events" to keystroke "q" using {control down, command down}');
				break;
			case "dark_mode":
				result = osa('tell application "System Events" to tell appearance preferences to set dark mode to true');
				break;
			case "light_mode":
				result = osa('tell application "System Events" to tell appearance preferences to set dark mode to false');
				break;
			case "toggle_dark":
				result = osa('tell application "System Events" to tell appearance preferences to set dark mode to not dark mode');
				break;
			default:
				result = `ERROR: unknown action ${a}`;
		}

		return { content: [{ type: "text" as const, text: result }], details: undefined };
	},
});

export const macTools: ToolDefinition[] = [
	launchAppTool, focusAppTool, quitAppTool, listAppsTool, frontmostAppTool,
	applescriptTool, readUiTool, clickElementTool, waitTool, checkPermissionsTool,
	typeTextTool, keyPressTool, clickMenuTool, clickAtTool,
	clipboardGetTool, clipboardSetTool,
	openUrlTool, notifyTool, speckTool, shortcutRunTool, macControlTool,
];
