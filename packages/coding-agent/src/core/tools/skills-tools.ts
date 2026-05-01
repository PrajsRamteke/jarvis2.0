/**
 * Skills tools — agent self-learning: save/search/list/delete.
 * Ported from Jarvis (harness) skills implementation.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.js";
import { defineTool } from "../extensions/types.js";

// ── Storage ──────────────────────────────────────────────────────────────────

const SKILL_DIR = join(homedir(), ".config", "pi-agent");
const SKILL_FILE = join(SKILL_DIR, "skills.json");

interface SkillRecord {
	id: number;
	task: string;
	lesson: string;
	tags: string[];
	ts: number;
	hits: number;
}

interface SkillStore {
	skills: SkillRecord[];
	nextId: number;
}

const MAX_STORE = 200;

function ensureDir(): void {
	if (!existsSync(SKILL_DIR)) mkdirSync(SKILL_DIR, { recursive: true });
}

function load(): SkillStore {
	ensureDir();
	if (!existsSync(SKILL_FILE)) return { skills: [], nextId: 1 };
	try {
		const data = JSON.parse(readFileSync(SKILL_FILE, "utf-8"));
		return { skills: data.skills ?? [], nextId: data.nextId ?? 1 };
	} catch {
		return { skills: [], nextId: 1 };
	}
}

function save(store: SkillStore): void {
	ensureDir();
	if (store.skills.length > MAX_STORE) {
		store.skills.sort((a, b) => (a.hits - b.hits) || (a.ts - b.ts));
		store.skills = store.skills.slice(-MAX_STORE);
	}
	writeFileSync(SKILL_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function tokens(text: string): Set<string> {
	return new Set(text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean));
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const skillSaveTool: ToolDefinition = defineTool({
	name: "skill_save",
	label: "Save Agent Skill",
	description:
		"Save a durable LESSON you learned solving the current task, so future " +
		"similar tasks cost less. Use when: you discovered a non-obvious " +
		"solution, a gotcha, a shortcut, a working command, or a reusable " +
		"pattern. Do NOT save ephemeral details. Keep `task` as a short pattern, " +
		"`lesson` as the actionable takeaway. Separate from personal user memory.",
	promptSnippet: "Save a lesson learned for future reference",
	parameters: Type.Object({
		task: Type.String({ description: "Short pattern describing the kind of task" }),
		lesson: Type.String({ description: "The actionable takeaway / solution / gotcha" }),
		tags: Type.Optional(Type.Array(Type.String(), { description: "Keywords for retrieval, e.g. ['git','rebase']" })),
	}),
	execute: async (_toolCallId, params: { task: string; lesson: string; tags?: string[] }, _signal, _onUpdate, _ctx) => {
		const task = params.task.trim();
		const lesson = params.lesson.trim();
		if (!task || !lesson) throw new Error("task and lesson are required");
		const tags = [...new Set((params.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].sort();
		const store = load();
		const existing = store.skills.find((s) => s.task.toLowerCase() === task.toLowerCase() && s.lesson.toLowerCase() === lesson.toLowerCase());
		if (existing) {
			existing.tags = [...new Set([...existing.tags, ...tags])].sort();
			existing.ts = Math.floor(Date.now() / 1000);
			save(store);
			const tagStr = existing.tags.length > 0 ? ` [${existing.tags.join(", ")}]` : "";
			return { content: [{ type: "text" as const, text: `updated skill #${existing.id}${tagStr}: ${existing.task} → ${existing.lesson}` }], details: undefined };
		}
		const skill: SkillRecord = {
			id: store.nextId, task, lesson, tags,
			ts: Math.floor(Date.now() / 1000), hits: 0,
		};
		store.skills.push(skill);
		store.nextId++;
		save(store);
		const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";
		return { content: [{ type: "text" as const, text: `saved skill #${skill.id}${tagStr}: ${skill.task} → ${skill.lesson}` }], details: undefined };
	},
});

export const skillSearchTool: ToolDefinition = defineTool({
	name: "skill_search",
	label: "Search Agent Skills",
	description:
		"Search your saved skills for lessons relevant to the current task " +
		"BEFORE diving in. Call this at the start of any non-trivial task.",
	promptSnippet: "Search saved skills for relevant lessons",
	parameters: Type.Object({
		query: Type.String({ description: "Keywords describing the current task" }),
		limit: Type.Optional(Type.Number({ default: 5, description: "Max results (default 5)" })),
	}),
	execute: async (_toolCallId, params: { query: string; limit?: number }, _signal, _onUpdate, _ctx) => {
		const q = tokens(params.query);
		const limit = params.limit ?? 5;
		if (q.size === 0) {
			return { content: [{ type: "text" as const, text: "(no matching skills)" }], details: undefined };
		}
		const store = load();
		const scored: Array<{ score: number; hits: number; skill: SkillRecord }> = [];
		for (const skill of store.skills) {
			const hay = new Set([...tokens(skill.task), ...tokens(skill.lesson), ...skill.tags]);
			const overlap = [...q].filter((t) => hay.has(t)).length;
			if (overlap > 0) {
				scored.push({ score: overlap, hits: skill.hits, skill });
			}
		}
		scored.sort((a, b) => b.score - a.score || b.hits - a.hits);
		const top = scored.slice(0, limit);
		if (top.length === 0) {
			return { content: [{ type: "text" as const, text: "(no matching skills)" }], details: undefined };
		}
		for (const { skill } of top) skill.hits++;
		save(store);
		const lines = top.map(({ skill }) => {
			const tagStr = skill.tags.length > 0 ? ` [${skill.tags.join(", ")}]` : "";
			return `#${skill.id}${tagStr} ${skill.task} → ${skill.lesson}`;
		});
		return { content: [{ type: "text" as const, text: lines.join("\n") }], details: undefined };
	},
});

export const skillListTool: ToolDefinition = defineTool({
	name: "skill_list",
	label: "List All Skills",
	description: "List every saved skill with hit counts. Rarely needed — prefer skill_search.",
	promptSnippet: "List all saved skills",
	parameters: Type.Object({}),
	execute: async (_toolCallId, _params: {}, _signal, _onUpdate, _ctx) => {
		const store = load();
		if (store.skills.length === 0) {
			return { content: [{ type: "text" as const, text: "(no skills saved)" }], details: undefined };
		}
		const lines = store.skills.map((s) => {
			const tagStr = s.tags.length > 0 ? ` [${s.tags.join(", ")}]` : "";
			return `#${s.id} hits=${s.hits}${tagStr} ${s.task} → ${s.lesson}`;
		});
		return { content: [{ type: "text" as const, text: lines.join("\n") }], details: undefined };
	},
});

export const skillDeleteTool: ToolDefinition = defineTool({
	name: "skill_delete",
	label: "Delete Skill",
	description: "Delete a saved skill by id (e.g. when it's wrong or outdated).",
	promptSnippet: "Delete a skill by ID",
	parameters: Type.Object({
		id: Type.Integer({ description: "Numeric ID of the skill to delete" }),
	}),
	execute: async (_toolCallId, params: { id: number }, _signal, _onUpdate, _ctx) => {
		const store = load();
		const before = store.skills.length;
		store.skills = store.skills.filter((s) => s.id !== params.id);
		if (store.skills.length === before) throw new Error(`no skill #${params.id}`);
		save(store);
		return { content: [{ type: "text" as const, text: `deleted skill #${params.id}` }], details: undefined };
	},
});

export const skillsTools: ToolDefinition[] = [skillSaveTool, skillSearchTool, skillListTool, skillDeleteTool];
