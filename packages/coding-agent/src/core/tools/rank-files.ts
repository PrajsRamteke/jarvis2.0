/**
 * Rank files — lightweight content-aware file ranking.
 * Ported from Jarvis (harness) rank_files implementation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.js";
import { defineTool } from "../extensions/types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	".venv",
	"venv",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".ruff_cache",
	"dist",
	"build",
	".next",
]);

const TEXT_EXTS = new Set([
	".py",
	".js",
	".jsx",
	".ts",
	".tsx",
	".json",
	".md",
	".txt",
	".toml",
	".yaml",
	".yml",
	".css",
	".scss",
	".html",
	".sh",
	".sql",
	".prisma",
	".env",
	".ini",
	".cfg",
	".rs",
	".go",
	".java",
	".kt",
	".swift",
]);

const MAX_SNIPPET_CHARS = 240;
const MAX_SCAN_LIMIT = 3000;
const DEFAULT_MAX_FILES = 30;

function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9_]+/)
			.filter(Boolean),
	);
}

function scoreText(text: string, queryTokens: Set<string>): number {
	if (!text || queryTokens.size === 0) return 0;
	const hayTokens = tokenize(text);
	let score = 0;
	for (const token of queryTokens) {
		if (hayTokens.has(token)) {
			score += 1;
			if (text.toLowerCase().includes(token)) score += 2;
		}
	}
	return score;
}

function collectFiles(
	dirPath: string,
	maxFiles: number,
	queryTokens: Set<string>,
	includeSnippets: boolean,
	maxSnippetChars: number,
): Array<{ path: string; score: number; snippet: string }> {
	const results: Array<{ path: string; score: number; snippet: string }> = [];
	const root = resolve(dirPath);
	let scanned = 0;

	function walk(current: string): void {
		if (results.length >= maxFiles || scanned >= MAX_SCAN_LIMIT) return;
		let entries: string[];
		try {
			entries = readdirSync(current);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (results.length >= maxFiles || scanned >= MAX_SCAN_LIMIT) return;
			const fullPath = resolve(current, entry);
			scanned++;
			if (SKIP_DIRS.has(entry)) continue;
			try {
				const s = statSync(fullPath);
				if (s.isDirectory()) {
					walk(fullPath);
				} else if (s.isFile()) {
					const ext = extname(entry).toLowerCase();
					if (!TEXT_EXTS.has(ext)) continue;
					let content = "";
					try {
						content = readFileSync(fullPath, { encoding: "utf-8" }).slice(0, maxSnippetChars);
					} catch {
						continue;
					}
					const nameScore = scoreText(entry, queryTokens);
					const contentScore = scoreText(content, queryTokens);
					const totalScore = nameScore * 3 + contentScore;
					if (totalScore > 0 || includeSnippets) {
						const relPath = relative(root, fullPath);
						results.push({
							path: relPath || entry,
							score: totalScore,
							snippet: includeSnippets ? content.slice(0, maxSnippetChars) : "",
						});
					}
				}
			} catch {
				/* skip inaccessible */
			}
		}
	}

	walk(root);
	results.sort((a, b) => b.score - a.score);
	return results.slice(0, maxFiles);
}

export const rankFilesTool: ToolDefinition = defineTool({
	name: "rank_files",
	label: "Rank Files by Relevance",
	description:
		"Cheaply rank likely relevant files before reading many files. Use this first " +
		"for broad tasks like finding code, resumes, IDs, screenshots, docs, configs, " +
		"or unknown files in a folder. Returns compact paths/scores and optional snippets.",
	promptSnippet: "Rank files by relevance to a query",
	parameters: Type.Object({
		query: Type.String({ description: "What you are trying to find or solve" }),
		path: Type.Optional(Type.String({ description: "Folder to scan. Default current directory" })),
		pattern: Type.Optional(Type.String({ description: "Glob under path. Default **/*" })),
		maxFiles: Type.Optional(
			Type.Number({ default: DEFAULT_MAX_FILES, description: "Max ranked results (default 30, max 100)" }),
		),
		includeSnippets: Type.Optional(
			Type.Boolean({ default: false, description: "Include text previews for scoring" }),
		),
		maxSnippetChars: Type.Optional(
			Type.Number({ default: MAX_SNIPPET_CHARS, description: "Snippet chars per file" }),
		),
	}),
	execute: async (
		_toolCallId,
		params: {
			query: string;
			path?: string;
			pattern?: string;
			maxFiles?: number;
			includeSnippets?: boolean;
			maxSnippetChars?: number;
		},
		_signal,
		_onUpdate,
		_ctx,
	) => {
		const query = params.query.trim();
		if (!query) throw new Error("query is required");

		const maxFiles = Math.min(params.maxFiles ?? DEFAULT_MAX_FILES, 100);
		const includeSnippets = params.includeSnippets ?? false;
		const maxSnippetChars = params.maxSnippetChars ?? MAX_SNIPPET_CHARS;
		const scanDir = params.path ? resolve(params.path) : process.cwd();

		const queryTokens = tokenize(query);
		const files = collectFiles(scanDir, maxFiles, queryTokens, includeSnippets, maxSnippetChars);

		if (files.length === 0) {
			return {
				content: [{ type: "text" as const, text: `No relevant files found for: ${query}` }],
				details: undefined,
			};
		}

		const lines = files.map((f, i) => {
			const scorePct = Math.min(100, Math.round((f.score / Math.max(1, files[0].score)) * 100));
			const snippet =
				includeSnippets && f.snippet ? `\n  ${f.snippet.replace(/\n/g, " ").slice(0, maxSnippetChars)}` : "";
			return `${i + 1}. [${scorePct}%] ${f.path}${snippet}`;
		});

		return { content: [{ type: "text" as const, text: lines.join("\n") }], details: undefined };
	},
});
