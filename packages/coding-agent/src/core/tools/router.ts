/**
 * Dynamic tool router — select only the tool groups likely needed each turn.
 * Ported from Jarvis (harness) router.py.
 *
 * Core file/code tools are always available. Specialized groups (mac, web,
 * ocr, memory, skills) are added based on recent message content and
 * active tool usage, so the agent only pays for the schemas it needs.
 */

// ── Regex triggers for each tool group ──────────────────────────────────────

const WEB_RE = /\b(web|internet|search online|look up|latest|today|news|price|weather|url|https?:\/\/|docs?|documentation)\b/i;
const MAC_RE = /\b(click|type|press|open app|launch|focus|safari|finder|whatsapp|messages|mail|calendar|reminders|clipboard|screen|ui|macos|speak|speck|read aloud|text to speech|tts|aloud|voice|sound|notify)\b/i;
const OCR_RE = /\b(ocr|screenshot|image|photo|picture|png|jpe?g|heic|tiff?|resume|cv|voter|license|licence|passport|id card|personal id)\b/i;
const MEMORY_RE = /\b(remember|memory|forget|my name|preference|about me)\b/i;
const SKILL_RE = /\b(skill|lesson|learned|remember how|same task)\b/i;

// ── Tool name → group mapping ───────────────────────────────────────────────

const TOOL_GROUP_MAP: Record<string, string> = {
	// Core tools: always available
	read_file: "core", read_document: "core", write_file: "core", edit_file: "core",
	list_dir: "core", run_bash: "core", search_code: "core", glob_files: "core",
	rank_files: "core", fast_find: "core",
	git_status: "core", git_diff: "core", git_log: "core",
	// Internet tools
	web_search: "web", fetch_url: "web", verified_search: "web",
	// Mac GUI tools
	launch_app: "mac", focus_app: "mac", quit_app: "mac", list_apps: "mac",
	frontmost_app: "mac", applescript: "mac", read_ui: "mac",
	click_element: "mac", wait: "mac", check_permissions: "mac",
	type_text: "mac", key_press: "mac", click_menu: "mac", click_at: "mac",
	clipboard_get: "mac", clipboard_set: "mac", open_url: "mac", notify: "mac",
	speck: "mac", shortcut_run: "mac", mac_control: "mac",
	// OCR
	read_image_text: "ocr", read_images_text: "ocr",
	// Memory
	memory_save: "memory", memory_list: "memory", memory_delete: "memory",
	// Skills
	skill_save: "skills", skill_search: "skills", skill_list: "skills", skill_delete: "skills",
};

/** Groups that are always included. */
const ALWAYS_INCLUDE = new Set(["core"]);

export interface ToolGroupMap {
	[name: string]: string; // tool name -> group name
}

// ── Tool selection logic ─────────────────────────────────────────────────────

/**
 * Extract plain text from a message content (handles string + block array).
 */
function extractText(content: string | Array<{ type?: string; text?: string }>): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b): b is { type: string; text: string } => b.type === "text" && typeof b.text === "string")
		.map((b) => b.text)
		.join("\n");
}

/**
 * Determine which tool groups should be visible based on recent messages.
 *
 * @param messages - Array of messages with { role, content } format.
 * @param toolNames - Flat array of all tool names available.
 * @param maxMessages - How many recent messages to scan (default 4).
 * @returns Array of tool names that should be available.
 */
export function selectToolsForTurn(
	messages: Array<{ role: string; content: string | Array<{ type?: string; text?: string }> }>,
	_allToolNames: string[],
	maxMessages = 4,
): string[] {
	const recentMessages = messages.slice(-maxMessages);
	const combinedText = recentMessages.map((m) => extractText(m.content)).join("\n");
	const activeGroups = new Set<string>(ALWAYS_INCLUDE);

	// Check message text for triggers
	if (WEB_RE.test(combinedText)) activeGroups.add("web");
	if (MAC_RE.test(combinedText)) activeGroups.add("mac");
	if (OCR_RE.test(combinedText)) activeGroups.add("ocr");
	if (MEMORY_RE.test(combinedText)) activeGroups.add("memory");
	if (SKILL_RE.test(combinedText)) activeGroups.add("skills");

	// Propagate groups from recent tool_use blocks
	for (const msg of recentMessages) {
		const content = msg.content;
		if (Array.isArray(content)) {
			for (const block of content) {
				const b = block as { type?: string; name?: string };
				if (b.type === "tool_use" || b.type === "tool_call") {
					const groupName = TOOL_GROUP_MAP[b.name ?? ""];
					if (groupName && !ALWAYS_INCLUDE.has(groupName)) {
						activeGroups.add(groupName);
					}
				}
			}
		}
	}

	return [...activeGroups];
}

/**
 * Filter a flat list of tool definitions to only those in the selected groups.
 */
export function filterToolsByTurn<T extends { name: string }>(
	tools: T[],
	messages: Array<{ role: string; content: string | Array<{ type?: string; text?: string }> }>,
	allToolNames: string[],
	maxMessages = 4,
): T[] {
	const selectedGroups = new Set(selectToolsForTurn(messages, allToolNames, maxMessages));
	return tools.filter((tool) => {
		const group = TOOL_GROUP_MAP[tool.name];
		return group ? selectedGroups.has(group) : true;
	});
}

export const routerToolGroupMap = TOOL_GROUP_MAP;
export const routerAlwaysInclude = ALWAYS_INCLUDE;
