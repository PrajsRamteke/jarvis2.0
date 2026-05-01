# Development Rules

## Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Code Quality

- No `any` types unless absolutely necessary
- Check node_modules for external API type definitions instead of guessing
- **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask before removing functionality or code that appears to be intentional
- Do not preserve backward compatibility unless the user explicitly asks for it
- Never hardcode key checks with, eg. `matchesKey(keyData, "ctrl+x")`. All keybindings must be configurable. Add default to matching object (`DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`)

## Commands

- After code changes (not documentation changes): `npm run check` (get full output, no tail). Fix all errors, warnings, and infos before committing.
- Note: `npm run check` does not run tests.
- NEVER run: `npm run dev`, `npm run build`, `npm test`
- Only run specific tests if user instructs: `npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts`
- Run tests from the package root, not the repo root.
- If you create or modify a test file, you MUST run that test file and iterate until it passes.
- When writing tests, run them, identify issues in either the test or implementation, and iterate until fixed.
- For `packages/jarvis-coding-agent/test/suite/`, use `test/suite/harness.ts` plus the faux provider. Do not use real provider APIs, real API keys, or paid tokens.
- Put issue-specific regressions under `packages/jarvis-coding-agent/test/suite/regressions/` and name them `<issue-number>-<short-slug>.test.ts`.
- NEVER commit unless user asks

## Contribution Gate

- New issues from new contributors are auto-closed by `.github/workflows/issue-gate.yml`
- New PRs from new contributors without PR rights are auto-closed by `.github/workflows/pr-gate.yml`
- Maintainer approval comments are handled by `.github/workflows/approve-contributor.yml`
- Maintainers review auto-closed issues daily
- Issues that do not meet the quality bar in `CONTRIBUTING.md` are not reopened and do not receive a reply
- `lgtmi` approves future issues
- `lgtm` approves future issues and rights to submit PRs

When creating issues:

- Add `pkg:*` labels to indicate which package(s) the issue affects
  - Available labels: `pkg:jarvis-agent`, `pkg:jarvis-ai`, `pkg:jarvis-coding-agent`, `pkg:jarvis-tui`, `pkg:jarvis-web-ui`
- If an issue spans multiple packages, add all relevant labels

When posting issue/PR comments:

- Write the full comment to a temp file and use `gh issue comment --body-file` or `gh pr comment --body-file`
- Never pass multi-line markdown directly via `--body` in shell commands
- Preview the exact comment text before posting
- Post exactly one final comment unless the user explicitly asks for multiple comments
- If a comment is malformed, delete it immediately, then post one corrected comment
- Keep comments concise, technical, and in the user's tone

When closing issues via commit:

- Include `fixes #<number>` or `closes #<number>` in the commit message
- This automatically closes the issue when the commit is merged

## PR Workflow

- Analyze PRs without pulling locally first
- If the user approves: create a feature branch, pull PR, rebase on main, apply adjustments, commit, merge into main, push, close PR, and leave a comment in the user's tone
- You never open PRs yourself. We work in feature branches until everything is according to the user's requirements, then merge into main, and push.

## Testing Jarvis 2.0 Interactive Mode with tmux

To test Jarvis's TUI in a controlled terminal environment:

```bash
# Create tmux session with specific dimensions
tmux new-session -d -s jarvis-test -x 80 -y 24

# Start jarvis from source
tmux send-keys -t jarvis-test "cd /Users/prajwal/Desktop/Pi/pi-mono-main && ./jarvis-test.sh" Enter

# Wait for startup, then capture output
sleep 3 && tmux capture-pane -t jarvis-test -p

# Send input
tmux send-keys -t jarvis-test "your prompt here" Enter

# Send special keys
tmux send-keys -t jarvis-test Escape
tmux send-keys -t jarvis-test C-o  # ctrl+o

# Cleanup
tmux kill-session -t jarvis-test
```

## Changelog

Location: `packages/*/CHANGELOG.md` (each package has its own)

### Format

Use these sections under `## [Unreleased]`:

- `### Breaking Changes` - API changes requiring migration
- `### Added` - New features
- `### Changed` - Changes to existing functionality
- `### Fixed` - Bug fixes
- `### Removed` - Removed features

### Rules

- Before adding entries, read the full `[Unreleased]` section to see which subsections already exist
- New entries ALWAYS go under `## [Unreleased]` section
- Append to existing subsections (e.g., `### Fixed`), do not create duplicates
- NEVER modify already-released version sections (e.g., `## [0.12.2]`)
- Each version section is immutable once released

### Attribution

- **Internal changes (from issues)**: `Fixed foo bar ([#123](https://github.com/PrajsRamteke/jarvis2.0/issues/123))`
- **External contributions**: `Added feature X ([#456](https://github.com/PrajsRamteke/jarvis2.0/pull/456) by [@username](https://github.com/username))`

## Adding a New LLM Provider (packages/jarvis-ai)

Adding a new provider requires changes across multiple files:

### 1. Core Types (`packages/jarvis-ai/src/types.ts`)

- Add API identifier to `Api` type union (e.g., `"bedrock-converse-stream"`)
- Create options interface extending `StreamOptions`
- Add mapping to `ApiOptionsMap`
- Add provider name to `KnownProvider` type union

### 2. Provider Implementation (`packages/jarvis-ai/src/providers/`)

Create provider file exporting:

- `stream<Provider>()` function returning `AssistantMessageEventStream`
- `streamSimple<Provider>()` function returning `AssistantMessageEventStream`
- `getModel<Provider>()` returning `Model<Provider>`
- Register in `providers/index.ts`

### 3. Tests (`packages/jarvis-ai/test/`)

Create provider test file and add to CI.

## Adding a New Built-in Tool (packages/jarvis-coding-agent)

### 1. Implementation (`packages/jarvis-coding-agent/src/core/tools/`)

- Create tool file with schema (TypeBox), operations interface, createTool / createToolDefinition functions
- Add render function (format*Call / format*Result)

### 2. Registration (`packages/jarvis-coding-agent/src/core/tools/index.ts`)

- Add to `allToolNames` set
- Export from index
- Add to `createToolDefinition` / `createTool` switch
- Add to `createAllToolDefinitions` / `createAllTools`

### 3. SDK (`packages/jarvis-coding-agent/src/core/sdk.ts`)

- Add to imports and exports
