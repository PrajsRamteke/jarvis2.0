/**
 * Fast find tool — Spotlight-based file search (macOS instant indexing).
 * Ported from Jarvis (harness) fast_find implementation.
 */

import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.js";
import { defineTool } from "../extensions/types.js";

export const fastFindTool: ToolDefinition = defineTool({
	name: "fast_find",
	label: "Fast File Find",
	description:
		"Fast file/folder search across the Mac using Spotlight (mdfind) or fd — near-instant (milliseconds), indexed. " +
		"Use this for quick file lookup by name across any directory. " +
		"For code content search, use search_code/grep. For filename patterns, use glob_files.",
	promptSnippet: "Fast file search via Spotlight/fd",
	parameters: Type.Object({
		query: Type.String({ description: "Filename or substring to search for, e.g. 'resume', 'harness', 'qr'" }),
		path: Type.Optional(Type.String({ description: "Optional folder to scope the search (e.g. ~/Desktop). Empty = whole Mac" })),
		kind: Type.Optional(Type.String({ description: "'any' (default), 'file', or 'folder'" })),
		maxResults: Type.Optional(Type.Number({ default: 50, description: "Max results (default 50, max 500)" })),
		ext: Type.Optional(Type.String({ description: "Extension filter, e.g. '.png' or 'png,jpg'" })),
	}),
	execute: async (_toolCallId, params: { query: string; path?: string; kind?: string; maxResults?: number; ext?: string }, _signal, _onUpdate, _ctx) => {
		const query = params.query.trim();
		if (!query) throw new Error("query is required");

		const maxResults = Math.min(params.maxResults ?? 50, 500);
		const kind = params.kind ?? "any";
		const extFilter = (params.ext ?? "").replace(/\s/g, "").split(",").map((e) => (e.startsWith(".") ? e : `.${e}`)).filter(Boolean);
		const extSet = new Set(extFilter.map((e) => e.toLowerCase()));
		const results: string[] = [];

		// Spotlight (mdfind)
		try {
			const cmd = ["mdfind", "-name", query];
			if (params.path) {
				const resolved = resolve(params.path.replace(/^~/, process.env.HOME || ""));
				if (existsSync(resolved)) cmd.push("-onlyin", resolved);
			}
			const out = execSync(cmd.join(" "), { encoding: "utf-8", timeout: 10_000 });
			for (const line of out.split("\n").filter(Boolean)) {
				if (results.length >= maxResults) break;
				try {
					const s = statSync(line);
					if (kind === "file" && !s.isFile()) continue;
					if (kind === "folder" && !s.isDirectory()) continue;
					if (extSet.size > 0 && !extSet.has(extname(line).toLowerCase())) continue;
					results.push(line);
				} catch { /* skip inaccessible */ }
			}
		} catch { /* mdfind failed */ }

		// Fallback to fd
		if (results.length === 0) {
			try {
				const cmd = ["fd", "--hidden", "--no-ignore", query];
				if (kind === "file") cmd.push("-t", "f");
				if (kind === "folder") cmd.push("-t", "d");
				for (const e of extFilter) cmd.push("-e", e.replace(/^\./, ""));
				if (params.path) cmd.push(resolve(params.path.replace(/^~/, process.env.HOME || "")));
				const out = execSync(cmd.join(" "), { encoding: "utf-8", timeout: 15_000 });
				for (const line of out.split("\n").filter(Boolean)) {
					if (results.length >= maxResults) break;
					results.push(line);
				}
			} catch { /* fd not available */ }
		}

		if (results.length === 0) {
			return { content: [{ type: "text" as const, text: `No results found for "${query}".` }], details: undefined };
		}

		return { content: [{ type: "text" as const, text: results.join("\n") }], details: undefined };
	},
});
