/**
 * Memory tools — persistent user facts stored on disk.
 * Ported from Jarvis (harness) memory implementation.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.js";
import { defineTool } from "../extensions/types.js";

// ── Storage ──────────────────────────────────────────────────────────────────

const MEMORY_DIR = join(homedir(), ".config", "pi-agent");
const MEMORY_FILE = join(MEMORY_DIR, "memory.json");

interface Fact {
	id: number;
	text: string;
	ts: number;
}

interface MemoryStore {
	facts: Fact[];
	nextId: number;
}

function ensureDir(): void {
	if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
}

function load(): MemoryStore {
	ensureDir();
	if (!existsSync(MEMORY_FILE)) return { facts: [], nextId: 1 };
	try {
		const data = JSON.parse(readFileSync(MEMORY_FILE, "utf-8"));
		return { facts: data.facts ?? [], nextId: data.nextId ?? 1 };
	} catch {
		return { facts: [], nextId: 1 };
	}
}

function save(store: MemoryStore): void {
	ensureDir();
	writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), "utf-8");
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const memorySaveTool: ToolDefinition = defineTool({
	name: "memory_save",
	label: "Save User Memory",
	description:
		"Save a personal fact about the user to long-term memory " +
		"(name, role, preferences, recurring context). Use only for durable " +
		"facts the user stated explicitly or that are clearly useful across " +
		"sessions. Do NOT save ephemeral task details.",
	promptSnippet: "Save a personal fact about the user to long-term memory",
	parameters: Type.Object({
		text: Type.String({ description: "One short fact, e.g. 'name: Prajwal' or 'prefers concise replies'" }),
	}),
	execute: async (_toolCallId, params: { text: string }, _signal, _onUpdate, _ctx) => {
		const text = params.text.trim();
		if (!text) throw new Error("empty fact");
		const store = load();
		const existing = store.facts.find((f) => f.text.toLowerCase() === text.toLowerCase());
		if (existing) {
			return {
				content: [{ type: "text" as const, text: `already saved #${existing.id}: ${existing.text}` }],
				details: undefined,
			};
		}
		const fact: Fact = { id: store.nextId, text, ts: Math.floor(Date.now() / 1000) };
		store.facts.push(fact);
		store.nextId++;
		save(store);
		return { content: [{ type: "text" as const, text: `saved #${fact.id}: ${fact.text}` }], details: undefined };
	},
});

export const memoryListTool: ToolDefinition = defineTool({
	name: "memory_list",
	label: "List User Memory",
	description: "List every stored personal fact about the user. Use when you need to recall what you know.",
	promptSnippet: "List all stored personal facts",
	parameters: Type.Object({}),
	execute: async (_toolCallId, _params: Record<string, never>, _signal, _onUpdate, _ctx) => {
		const store = load();
		if (store.facts.length === 0) {
			return { content: [{ type: "text" as const, text: "(memory is empty)" }], details: undefined };
		}
		const lines = store.facts.map((f) => `#${f.id}: ${f.text}`);
		return { content: [{ type: "text" as const, text: lines.join("\n") }], details: undefined };
	},
});

export const memoryDeleteTool: ToolDefinition = defineTool({
	name: "memory_delete",
	label: "Delete User Memory",
	description: "Delete a stored personal fact by its numeric id.",
	promptSnippet: "Delete a personal fact by ID",
	parameters: Type.Object({
		id: Type.Integer({ description: "Numeric ID of the fact to delete" }),
	}),
	execute: async (_toolCallId, params: { id: number }, _signal, _onUpdate, _ctx) => {
		const store = load();
		const before = store.facts.length;
		store.facts = store.facts.filter((f) => f.id !== params.id);
		if (store.facts.length === before) {
			throw new Error(`no fact with id #${params.id}`);
		}
		save(store);
		return { content: [{ type: "text" as const, text: `deleted #${params.id}` }], details: undefined };
	},
});

export const memoryTools: ToolDefinition[] = [memorySaveTool, memoryListTool, memoryDeleteTool];
