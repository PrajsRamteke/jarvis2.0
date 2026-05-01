# Jarvis 2.0 — macOS Agent + Code Assistant

**Jarvis 2.0** is a personal fork of the pi-mono coding agent, enhanced with the full toolset from the Harness project. It's a macOS-native AI agent with GUI automation, OCR, memory/skills learning, verified web search, and deep code analysis.

## Packages

| Package | Description |
|---|---|
| `@prajwal/jarvis-ai` | Unified LLM API with automatic model discovery and provider configuration |
| `@prajwal/jarvis-agent` | General-purpose agent with transport abstraction and state management |
| `@prajwal/jarvis-coding-agent` | **Coding agent CLI** — the main entry point |
| `@prajwal/jarvis-tui` | Terminal User Interface library |
| `@prajwal/jarvis-web-ui` | Web UI components for AI chat interfaces |

## Quick Start

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run Jarvis
./packages/jarvis-coding-agent/dist/cli.js --help
```

## Features

### Core Coding Tools
- **read** — Read files with line ranges and image support
- **bash** — Execute shell commands
- **edit** — Surgical file edits with diff preview
- **write** — Create or overwrite files
- **grep** — Fast ripgrep-based search
- **find** — File search with glob patterns
- **ls** — Directory listing

### Jarvis 2.0 Enhanced Tools
- **OCR** — macOS Vision framework for text extraction from images (`read_image_text`, `read_images_text`)
- **macOS GUI** — App lifecycle, AppleScript, UI tree reading, clicks, keystrokes, clipboard, TTS, notifications, shortcuts (`launch_app`, `read_ui`, `click_element`, `speck`, and 18 more)
- **Memory** — Persistent user facts (`memory_save`, `memory_list`, `memory_delete`)
- **Skills** — Agent self-learning (`skill_save`, `skill_search`, `skill_list`, `skill_delete`)
- **Web** — DuckDuckGo search, URL fetching, multi-source verified search (`web_search`, `fetch_url`, `verified_search`)
- **Fast Find** — Spotlight/fd instant file search (`fast_find`)
- **File Ranking** — Content-aware relevance ranking (`rank_files`)

### Dynamic Tool Router
Tools are selected per-turn based on message content — your agent only pays for the schemas it needs.

## CLI Usage

```bash
jarvis                      # Start interactive TUI mode
jarvis "fix this bug"       # One-shot prompt (print mode)
jarvis --mode json          # JSON response mode
jarvis --mode rpc           # RPC server mode
```

## SDK Usage

```typescript
import { createAgentSession, createJarvisToolDefinitions } from "@prajwal/jarvis-coding-agent";

const { session } = await createAgentSession({
  customTools: createJarvisToolDefinitions(),
});
```

## License

MIT — originally by Mario Zechner, forked and enhanced by Prajwal Ramteke.
