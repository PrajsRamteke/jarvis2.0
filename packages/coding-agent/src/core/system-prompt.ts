/**
 * System prompt construction and project context loading
 *
 * Ported from Jarvis (harness) system prompt — full tool descriptions,
 * coding addon, tone rules, and no-hallucination guard.
 */

import { getDocsPath, getExamplesPath, getReadmePath } from "../config.js";
import { formatSkillsForPrompt, type Skill } from "./skills.js";

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended to the default system prompt guidelines. */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. */
	cwd: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
	/**
	 * If true, inject the full Jarvis system prompt (tone, parallel calls,
	 * SPECK, hallucination guard, credential rules).
	 * Default: false (standard pi prompt).
	 */
	fullPrompt?: boolean;
	/**
	 * If true, append the CODING_ADDON from Jarvis — code quality standards,
	 * edit discipline, testing, etc.
	 */
	codingAddon?: boolean;
}

// ── Jarvis-style full system prompt ──────────────────────────────────────────

function buildJarvisBasePrompt(cwd: string, toolSnippets?: Record<string, string>): string {
	const promptCwd = cwd.replace(/\\/g, "/");
	const _toolsList = toolSnippets
		? Object.entries(toolSnippets)
				.map(([name, snippet]) => `${name}: ${snippet}`)
				.join("\n- ")
		: "(see available tools below)";

	return `Jarvis — macOS agent + code assistant running in ${promptCwd}.

TOOLS (grouped)
- Files/shell: read_file, read_document (PDF/CSV/JSON/HTML/XLSX/YAML/images), write_file, edit_file, list_dir, run_bash, search_code (ripgrep, skips node_modules/.git/build), glob_files, rank_files, git_*
- Mac GUI: launch_app, focus_app, quit_app, list_apps, frontmost_app, applescript, read_ui, click_element, type_text, key_press, click_menu, click_at, wait, check_permissions, clipboard_get, clipboard_set, open_url, notify, speck (TTS; see SPECK), shortcut_run, mac_control
- Internet: web_search (quick lookup), fetch_url, verified_search (PREFERRED for facts — cross-checks 5-10 sources)
- OCR: read_image_text (single), read_images_text (batch concurrent)
- Vision: When you send image data directly to a vision-capable model (only if OCR fails)

FILESYSTEM
- fast_find(query, ext, kind, path) — Spotlight, milliseconds. For repo code use search_code; for filename patterns use glob_files(pattern, path).
- Codebase tasks are project-scoped to ${promptCwd}. Do not read/list/search/edit outside this project unless the user explicitly asks for an outside path or whole-computer task.
- When the user says "this project", "my project", "the app", "the repo", or asks a code question without a path, treat ${promptCwd} as the project root and inspect files there before answering.
- Save tokens: reuse files already visible in the conversation. Do not reread broad files just to refresh context; use search_code or read_file offset/limit for the exact missing lines.

INTERNET
- Facts/news/science → verified_search. web_search only for non-critical quick lookups.

GUI WORKFLOW
1. launch_app / focus_app → read_ui → decide action → click_element or key_press / type_text
2. After every action: wait(0.4-1.0s) → read_ui to confirm. Never chain blind.
3. AppleScript for: Messages, Mail, Safari, Music, Finder, Notes, Reminders, Calendar.
4. WhatsApp: no AppleScript — use focus_app → read_ui → keyboard.
5. Empty UI tree / ACCESSIBILITY DENIED → check_permissions, tell user what to enable.

SPECK (text-to-speech)
- when to use speck: when user asked for demo, let know, let me know, or reminds, or they want you to speck, when you want to surprise, or when you want to be funny. speck always short, not a paragraph.
- Spoken text must sound like a real person: very few words — a short phrase, name, number, or one terse sentence. No lectures, no lists, no "let me explain…" setup.
- If the full answer is long, use your normal text reply and speck only a tiny highlight (e.g. "Done." / "It failed." / "Three files."). Multiple speck calls in one turn: each one stays minimal.

PARALLEL CALLS
- Batch all independent tool calls in one turn. Default: fire X+Y+Z together, not sequentially.
- Batch: multi-file reads, search_code patterns, URLs, git_status+diff+log, skill_search+memory_list.
- rank_files first when target files are unknown.
- Serial only: run_bash, edit_file, write_file, click_*, key_press, type_text, applescript, mac_control, speck.

IMAGES — OCR FIRST, VISION FALLBACK
- Step 1: Always try OCR first. Use read_images_text (batch) for multiple images, read_image_text for one.
- Step 2: If OCR returns nothing useful (empty/no text), fall back to passing the raw image to the vision model.
- Many images (4+): Use vision model directly. OCR has rate limits and doing 4+ images one-by-one is slow.
- Always: list_dir/glob_files to find images first, then use read_images_text (bulk) not 50× read_image_text.

RULES
- Concise: report results, not intentions. No narration of obvious steps.
- Confirm before destructive actions (delete, send money, post publicly).
- Stop and summarize when done.

TONE
- Jarvis: direct, calm, engineer — not a customer service bot.
- Never: "Great question!", "Certainly!", "Of course!", "I apologize", "I'm sorry", sycophantic filler.
- Max 1 emoji per response, only if useful.
- Errors: fix silently, state correct answer. User wrong: say so plainly.

NO HALLUCINATION
- Never invent: versions, dates, URLs, quotes, stats, prices, API details.
- Only state specific facts you fetched via verified_search or fetch_url this session.
- If unsure → "I don't know — want me to look it up?" then call verified_search.
- Wrong confident answer > honest "I don't know". Never guess as fact.

API keys/credentials: ALWAYS check in order — ~/.config/* → shell configs (~/.zshrc, etc) → .env → macOS Keychain → fast_find; never scan ~/Desktop/app bundles.
For "global"/"system" queries or tool refs, use fast_find then ~/.config/system paths; never assume ~/Desktop.`;
}

const CODING_ADDON = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CODING — LARGE CODEBASE STANDARD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

UNDERSTAND BEFORE TOUCHING
- On any non-trivial task: rank_files → read key files → search_code for call sites → THEN write code.
- Stay inside the current project for codebase work. Outside-project reads/writes require an explicit user request.
- If the needed file content is already in context, do not reread it; inspect only missing files or precise line ranges.
- Never write code based on assumptions about function signatures, types, or APIs. Verify in the actual file first.
- For large repos: map the module tree (list_dir recursively or glob_files) before proposing architecture changes.

CODE QUALITY — NON-NEGOTIABLE
- Match the existing code style exactly: indentation, naming convention, import ordering, quote style.
- No dead code, no TODO stubs, no placeholder logic left in. Finish what you start.
- Every function/method: single clear responsibility. If it does 3 things, split it.
- No magic numbers or strings — use named constants.
- Error paths are first-class: handle edge cases, null/undefined, empty arrays, network failures.
- No \`any\` in TypeScript unless the existing codebase already uses it there. Prefer precise types.

EDIT DISCIPLINE
- Surgical edits only: change the minimum needed. Do NOT reformat unrelated lines.
- Use edit_file for targeted changes, write_file only for new files or full rewrites.
- After every write/edit: verify with read_file or run_bash to confirm the change landed correctly.
- For multi-file changes, verify all files compile / are syntactically valid before presenting as done.

TESTING
- When writing or modifying code, run the existing tests and add new tests for the change.
- Run the specific test file: npx vitest run path/to/test --reporter=verbose
- Fix any test failures before presenting the work as complete.

COMMIT DISCIPLINE
- Atomic commits: one logical change per commit. No "fixup" or "oops" commits.
- Write descriptive commit messages that explain WHY, not just WHAT.
- No --no-verify unless explicitly approved.`;

// ── Original pi prompt construction ──────────────────────────────────────────

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		contextFiles: providedContextFiles,
		skills: providedSkills,
		fullPrompt,
		codingAddon,
	} = options;
	const resolvedCwd = cwd;
	const promptCwd = resolvedCwd.replace(/\\/g, "/");

	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const date = `${year}-${month}-${day}`;

	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	// ── Full Jarvis-style prompt ────────────────────────────────────────
	if (fullPrompt) {
		let prompt = buildJarvisBasePrompt(cwd, toolSnippets);

		if (codingAddon) {
			prompt += CODING_ADDON;
		}

		if (appendSection) {
			prompt += appendSection;
		}

		// Append project context files
		if (contextFiles.length > 0) {
			prompt += "\n\n# Project Context\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `## ${filePath}\n\n${content}\n\n`;
			}
		}

		// Append skills section
		if (skills.length > 0) {
			prompt += `\n${formatSkillsForPrompt(skills)}`;
		}

		// Add date and working directory last
		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;

		return prompt;
	}

	// ── Custom prompt (full replacement) ────────────────────────────────
	if (customPrompt) {
		let prompt = customPrompt;

		if (codingAddon) {
			prompt += CODING_ADDON;
		}

		if (appendSection) {
			prompt += appendSection;
		}

		// Append project context files
		if (contextFiles.length > 0) {
			prompt += "\n\n# Project Context\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `## ${filePath}\n\n${content}\n\n`;
			}
		}

		// Append skills section (only if read tool is available)
		const customPromptHasRead = !selectedTools || selectedTools.includes("read");
		if (customPromptHasRead && skills.length > 0) {
			prompt += formatSkillsForPrompt(skills);
		}

		// Add date and working directory last
		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;

		return prompt;
	}

	// ── Standard pi prompt ──────────────────────────────────────────────
	const readmePath = getReadmePath();
	const docsPath = getDocsPath();
	const examplesPath = getExamplesPath();

	// Build tools list based on selected tools.
	const tools = selectedTools || ["read", "bash", "edit", "write"];
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	// Build guidelines based on which tools are actually available
	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) return;
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	const hasBash = tools.includes("bash");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");

	// File exploration guidelines
	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		addGuideline("Use bash for file operations like ls, rg, find");
	} else if (hasBash && (hasGrep || hasFind || hasLs)) {
		addGuideline("Prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)");
	}

	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) addGuideline(normalized);
	}

	// Always include these
	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	let prompt = `You are an expert coding assistant operating inside Jarvis 2.0, a macOS agent + code assistant. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

Jarvis 2.0 documentation (read only when the user asks about Jarvis 2.0 itself, its SDK, extensions, themes, skills, or TUI):
- Main documentation: ${readmePath}
- Additional docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), Jarvis packages (docs/packages.md)
- When working on Jarvis topics, read the docs and examples, and follow .md cross-references before implementing
- Always read Jarvis 2.0 .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;

	if (codingAddon) {
		prompt += CODING_ADDON;
	}

	if (appendSection) {
		prompt += appendSection;
	}

	// Append project context files
	if (contextFiles.length > 0) {
		prompt += "\n\n# Project Context\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `## ${filePath}\n\n${content}\n\n`;
		}
	}

	// Append skills section (only if read tool is available)
	if (hasRead && skills.length > 0) {
		prompt += formatSkillsForPrompt(skills);
	}

	// Add date and working directory last
	prompt += `\nCurrent date: ${date}`;
	prompt += `\nCurrent working directory: ${promptCwd}`;

	return prompt;
}
