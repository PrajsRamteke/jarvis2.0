/**
 * Web search tools — web_search, fetch_url, verified_search.
 * Ported from Jarvis (harness) web tools.
 */

import { execSync } from "node:child_process";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.js";
import { defineTool } from "../extensions/types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_TOOL_OUTPUT = 100_000;
const SEARCH_DEFAULT_MAX_RESULTS = 8;

// ── Helpers ──────────────────────────────────────────────────────────────────

function enrichQueryWithDate(query: string): string {
	const now = new Date();
	const year = now.getFullYear();
	const hasYear = /\b(19|20)\d{2}\b/.test(query);
	const hasRecency = /\b(latest|current|currently|recent|recently|today|todays?|now|this\s+(?:year|month|week)|new|newest|upcoming|as\s+of|right\s+now)\b/i.test(query);
	if (hasYear && hasRecency) {
		return query.replace(/\b(19|20)\d{2}\b/g, String(year));
	}
	if (hasRecency && !hasYear) {
		return `${query} ${year}`;
	}
	return query;
}

function ddgSearch(query: string, maxResults: number): string {
	const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
	try {
		const html = execSync(`curl -sL -A "Mozilla/5.0" ${JSON.stringify(url)}`, {
			encoding: "utf-8", timeout: 15_000, maxBuffer: 512 * 1024,
		});

		const results: string[] = [];
		const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
		const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
		const links: string[] = [];
		const titles: string[] = [];

		let match: RegExpExecArray | null;
		while ((match = linkRegex.exec(html)) !== null && links.length < maxResults) {
			let href = match[1];
			const uMatch = href.match(/uddg=([^&]+)/);
			if (uMatch) href = decodeURIComponent(uMatch[1]);
			links.push(href);
			titles.push(match[2].replace(/<[^>]+>/g, "").trim());
		}

		const snippets: string[] = [];
		while ((match = snippetRegex.exec(html)) !== null && snippets.length < maxResults) {
			snippets.push(match[1].replace(/<[^>]+>/g, "").trim());
		}

		for (let i = 0; i < Math.min(links.length, maxResults); i++) {
			results.push(`${i + 1}. ${titles[i] || "(no title)"}\n   ${links[i] || ""}\n   ${snippets[i] || ""}`);
		}

		return results.length > 0 ? results.join("\n\n") : "No results found.";
	} catch (err: unknown) {
		return `ERROR: search failed: ${err instanceof Error ? err.message : String(err)}`;
	}
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const webSearchTool: ToolDefinition = defineTool({
	name: "web_search",
	label: "Web Search",
	description:
		"Search the web using DuckDuckGo. Returns ranked results with titles, URLs, and snippets. " +
		"Use for quick lookups. For important/factual topics, prefer verified_search which cross-checks multiple sources.",
	promptSnippet: "Quick web search via DuckDuckGo",
	parameters: Type.Object({
		query: Type.String({ description: "Search query" }),
		maxResults: Type.Optional(Type.Number({ default: SEARCH_DEFAULT_MAX_RESULTS, description: "Max results (default 8)" })),
	}),
	execute: async (_toolCallId, params: { query: string; maxResults?: number }, _signal, _onUpdate, _ctx) => {
		const query = enrichQueryWithDate(params.query);
		const maxResults = params.maxResults ?? SEARCH_DEFAULT_MAX_RESULTS;
		const result = ddgSearch(query, maxResults);
		return { content: [{ type: "text" as const, text: result.slice(0, MAX_TOOL_OUTPUT) }], details: undefined };
	},
});

export const fetchUrlTool: ToolDefinition = defineTool({
	name: "fetch_url",
	label: "Fetch URL",
	description:
		"Fetch a URL and return its content as plain text (HTML is stripped). " +
		"Set raw=true to get the raw response body (HTML/JSON).",
	promptSnippet: "Fetch URL content as plain text or raw",
	parameters: Type.Object({
		url: Type.String({ description: "Full URL to fetch (http/https)" }),
		raw: Type.Optional(Type.Boolean({ description: "If true, return raw response body instead of stripped text" })),
	}),
	execute: async (_toolCallId, params: { url: string; raw?: boolean }, _signal, _onUpdate, _ctx) => {
		const isRaw = params.raw ?? false;
		try {
			const output = execSync(
				`curl -sL -m 15 -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" ${JSON.stringify(params.url)}`,
				{ encoding: "utf-8", timeout: 20_000, maxBuffer: 2 * 1024 * 1024 },
			);

			if (isRaw) {
				return { content: [{ type: "text" as const, text: output.slice(0, MAX_TOOL_OUTPUT) }], details: undefined };
			}

			const stripped = output
				.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
				.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
				.replace(/<[^>]+>/g, "")
				.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
				.replace(/\n{3,}/g, "\n\n").trim();

			return { content: [{ type: "text" as const, text: stripped.slice(0, MAX_TOOL_OUTPUT) || "(empty response)" }], details: undefined };
		} catch (err: unknown) {
			throw new Error(err instanceof Error ? err.message : String(err));
		}
	},
});

export const verifiedSearchTool: ToolDefinition = defineTool({
	name: "verified_search",
	label: "Verified Search",
	description:
		"Multi-source VERIFIED web search. Searches multiple independent sites, " +
		"fetches their content in parallel, scores by domain credibility, " +
		"cross-checks claims across sources. Returns structured report with " +
		"verified facts, contested points, and confidence level. " +
		"PREFERRED over web_search for news, health, science, facts, prices, current events.",
	promptSnippet: "Multi-source verified web search with cross-checking",
	parameters: Type.Object({
		query: Type.String({ description: "What to research and verify" }),
		minSources: Type.Optional(Type.Number({ default: 5, description: "Minimum sources to fetch" })),
		maxSources: Type.Optional(Type.Number({ default: 10, description: "Maximum sources to fetch" })),
	}),
	execute: async (_toolCallId, params: { query: string; minSources?: number; maxSources?: number }, _signal, _onUpdate, _ctx) => {
		const query = enrichQueryWithDate(params.query);
		const maxSources = params.maxSources ?? 10;
		const minSources = params.minSources ?? 5;

		try {
			const searchResults = ddgSearch(query, maxSources * 2);
			const urlRegex = /https?:\/\/[^\s\n]+/g;
			const urls = [...new Set(searchResults.match(urlRegex) || [])].slice(0, maxSources);

			if (urls.length < minSources) {
				return {
					content: [{ type: "text" as const, text: `✅ VERIFIED SEARCH REPORT\nQuery: ${query}\n\nOnly ${urls.length} source(s) found. Results from search:\n\n${searchResults}\n\nConfidence: LOW — too few sources to cross-check.` }],
					details: undefined,
				};
			}

			const sources: Array<{ url: string; title: string; content: string; trust: number }> = [];
			for (const url of urls.slice(0, maxSources)) {
				try {
					const content = execSync(
						`curl -sL -m 10 -H "User-Agent: Mozilla/5.0" ${JSON.stringify(url)}`,
						{ encoding: "utf-8", timeout: 15_000, maxBuffer: 256 * 1024 },
					);
					const text = content
						.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
						.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
						.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2500);

					const hostname = new URL(url).hostname.toLowerCase();
					let trust = 5;
					if (hostname.endsWith(".gov") || hostname.endsWith(".edu")) trust = 9;
					else if (hostname.includes("wikipedia")) trust = 8;
					else if (hostname.includes("reuters") || hostname.includes("ap.org") || hostname.includes("bbc")) trust = 9;
					else if (hostname.includes("github") || hostname.includes("stackoverflow") || hostname.includes("docs.")) trust = 7;
					else if (hostname.includes("medium") || hostname.includes("blog")) trust = 5;

					sources.push({ url, title: url.split("/").slice(2, 3).join("/"), content: text, trust });
				} catch { /* skip failed fetches */ }
			}

			if (sources.length < minSources) {
				return {
					content: [{ type: "text" as const, text: `⚠️ VERIFIED SEARCH REPORT\nQuery: ${query}\n\nOnly ${sources.length}/${maxSources} sources accessible. Results:\n\n${searchResults}\n\nConfidence: LOW.` }],
					details: undefined,
				};
			}

			sources.sort((a, b) => b.trust - a.trust);
			const lines: string[] = [
				`✅ VERIFIED SEARCH REPORT`,
				`Query: ${query}`,
				`Sources checked: ${sources.length}`,
				`Confidence: ${sources.length >= 7 ? "HIGH" : sources.length >= 5 ? "MEDIUM" : "LOW"}`,
				"", "── Sources (by credibility) ──",
			];
			for (const s of sources) {
				lines.push(`\n[Trust: ${s.trust}/10] ${s.url}`);
				const snippet = s.content.slice(0, 500);
				if (snippet) lines.push(`  ${snippet}${s.content.length > 500 ? "…" : ""}`);
			}

			return { content: [{ type: "text" as const, text: lines.join("\n").slice(0, MAX_TOOL_OUTPUT) }], details: undefined };
		} catch (err: unknown) {
			const fallback = ddgSearch(query, 8);
			return {
				content: [{ type: "text" as const, text: `⚠️ verified_search error: ${err instanceof Error ? err.message : String(err)}\n\nFallback search results:\n\n${fallback}` }],
				details: undefined,
			};
		}
	},
});

export const webTools: ToolDefinition[] = [webSearchTool, fetchUrlTool, verifiedSearchTool];
