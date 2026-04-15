# Hooks

Agent harness integration — Claude Code hooks, Pi extensions, and Codex hooks push structured events to devbench via HTTP API, reducing reliance on terminal scraping for status, naming, MR detection, and session tracking.

## Architecture

Polling-based monitors ([[monitoring]]) remain the fallback, but hook events take priority when available.

Terminal sessions always poll; Claude Code and Pi can run hooks-only, while Codex stays hybrid because its hooks only expose Bash tool details today.

### Disable Polling

The `polling_disabled` setting in [[database#Schema#Settings]] disables terminal-scraping pollers for agent status and auto-rename.

When enabled, hook events drive status and naming instead of terminal polling. MR link scanning is the exception: it always runs regardless of this setting because hook-based MR detection has gaps (tail-truncated JSON from piped commands, shorthand `glab mr list` output, URLs only in agent text responses). Terminal scanning is the reliable fallback. The toggle is in the Settings UI under Agent Extensions and applies to new sessions.

### Communication Channel

Agents call devbench's HTTP REST API on `localhost:DEVBENCH_PORT`. Session identification uses `DEVBENCH_SESSION_ID`. Both are exported into the shell via `tmux send-keys` before the agent command runs during session creation in [[server/terminal.ts]].

## Hook API

The [[server/routes/hooks.ts]] module exposes seven endpoints:

- **`POST /api/hooks/session-start`** — agent session/thread started or resumed. Persists the agent's own session ID so future revive flows can resume the correct conversation.
- **`POST /api/hooks/prompt`** — agent received a user prompt. Sets status to "working" and triggers [[monitoring#Auto-Rename]] from the prompt text.
- **`POST /api/hooks/working`** — agent is actively working (e.g. about to invoke a tool). Sets status to "working" without triggering rename. Acts as a recovery signal when `UserPromptSubmit` doesn't fire — notably plan-mode refinement, where the user response is routed into the `ExitPlanMode` tool continuation rather than submitted as a fresh prompt.
- **`POST /api/hooks/idle`** — agent finished working. Sets status to "waiting" and triggers [[monitoring#Notifications]].
- **`POST /api/hooks/mr`** — MR/PR URL detected. Feeds into the [[monitoring#MR Link Detection]] pipeline.
- **`POST /api/hooks/changes`** — agent wrote/edited a file. Sets `has_changes` flag on the session, scoped to files inside the session's working directory (see [[hooks#Changes Tracking]]).
- **`POST /api/hooks/committed`** — agent pushed via git. Clears `has_changes` flag on the session.

All endpoints accept JSON with `sessionId` (number) as a required field.

## Hook Event Processing

The [[server/monitor-manager.ts]] module provides dispatch functions for hook events:

- [[server/monitor-manager.ts#handleHookSessionStart]] — persists the agent's own session/thread ID via [[database#Schema#Sessions]]
- [[server/monitor-manager.ts#handleHookPrompt]] — sets agent status to "working" via [[server/agent-status.ts#setStatusFromHook]], triggers rename via [[server/auto-rename.ts#nameFromPrompt]]
- [[server/monitor-manager.ts#handleHookWorking]] — sets agent status to "working" without triggering rename; idempotent recovery signal used by `PreToolUse`
- [[server/monitor-manager.ts#handleHookIdle]] — sets agent status to "waiting", triggers notification flow
- [[server/monitor-manager.ts#handleHookMrUrl]] — feeds URL into existing MR link pipeline
- [[server/monitor-manager.ts#handleHookChanges]] — sets `has_changes` on session (scoped to files inside `cwd` via [[server/monitor-manager.ts#isPathInsideCwd]]), broadcasts event
- [[server/monitor-manager.ts#handleHookCommitted]] — clears `has_changes` on session, broadcasts event

## Extension Manager

The [[server/extension-manager.ts]] module manages installation, uninstallation, and version checking of agent extensions.

### Bundled Extensions

Extensions are bundled in `server/extensions/` and copied to global locations on install:

- **Claude Code** — [[server/extensions/claude-hook.js]] → `~/.claude/hooks/devbench-hook.js`, plus shared skills → `~/.claude/skills/`
- **Pi** — [[server/extensions/pi-extension.ts]] → `~/.pi/agent/extensions/devbench.ts`
- **Codex** — [[server/extensions/codex-hook.js]] → `~/.codex/hooks/devbench-hook.js`, plus shared skills → `~/.codex/skills/`

Shared skills (e.g. `git-commit-and-push`) are bundled in `server/extensions/skills/` and installed to both Claude and Codex skill directories from a single canonical source.

### Version Tracking

Each extension has a version comment (e.g., `// devbench-hook v2`). The manager compares installed vs bundled versions.

When an update is available, the [[client#Sidebar]] shows an amber indicator dot on the settings gear icon; it clears immediately when the extension is updated via [[client/src/components/SettingsModal.tsx]].

### Claude Code Settings Merging

Installing the Claude Code hook adds entries to `~/.claude/settings.json` for five event types and installs bundled skills to `~/.claude/skills/`.

Uninstalling removes only devbench entries and bundled skills without clobbering other hooks or user-installed skills.

The uninstall filter matches any entry whose command contains `devbench-hook`, so new event types are cleaned up automatically without a version-aware migration.

### Codex Hooks Merging

Installing the Codex extension copies the hook script and bundled skills into `~/.codex/`.

It also merges devbench entries into `~/.codex/hooks.json` and enables `codex_hooks` in `~/.codex/config.toml`.

Uninstalling removes the devbench hook entries, script, and bundled skill. The feature flag is left enabled so unrelated Codex hooks keep working.

## Extension Routes

The [[server/routes/extensions.ts]] module provides:

- **`GET /api/extensions/status`** — returns install status and version for each agent
- **`POST /api/extensions/install`** — install or update extensions
- **`POST /api/extensions/uninstall`** — remove extensions

## Claude Code Hook

The [[server/extensions/claude-hook.js]] is a self-contained Node.js script (requires only `http` and `fs`). It:

- Reads `DEVBENCH_PORT` and `DEVBENCH_SESSION_ID` from environment
- Exits silently when not running inside devbench
- Handles `UserPromptSubmit` → reads `prompt` field from stdin JSON → `POST /api/hooks/prompt`
- Handles `Stop` → `POST /api/hooks/idle`, then scans the conversation transcript (via `data.transcript_path`) for MR/PR URLs in the last assistant message and posts each to `POST /api/hooks/mr`. This catches URLs the agent mentions in its text output that never appeared in a Bash `tool_response` — e.g. when `but pr new --json | tail` truncates the JSON, or the agent summarises MR links from `glab mr list` shorthand.
- Handles `Notification` → `POST /api/hooks/idle`, then scans the transcript for MR/PR URLs (same logic as Stop). Fires when Claude Code needs user input (permission prompts, plan-mode approval via `ExitPlanMode`, idle-timeout). Scanning on Notification is critical for long-running orchestrator sessions that may never fire Stop — the agent mentions the MR URL in its text output when it finishes a task but remains waiting for the next prompt.
- Handles `PreToolUse` (all tools, no matcher) → `POST /api/hooks/working` — fires before every tool invocation as a recovery signal. Critical for plan-mode refinement: when the user types a refinement, Claude Code routes it into the `ExitPlanMode` tool continuation without firing `UserPromptSubmit`, so `PreToolUse` is the only reliable way to detect the resumed work and transition back to "working".
- Handles `PostToolUse` for Write/Edit/MultiEdit/NotebookEdit → `POST /api/hooks/changes` with `filePath` (from `tool_response.filePath`, falling back to `tool_input.file_path`) and `cwd`. Skipping when `filePath` is absent doubles as an error/blocked-response guard. Including `cwd` lets the server drop writes outside the project — notably Claude Code plan-mode plan files under `~/.claude/plans/`.
- Handles `PostToolUse` for Bash → reads `tool_input.command` for `git push` or `but push` → `POST /api/hooks/committed`
- Handles `PostToolUse` for Bash → reads `tool_response.stdout` and `tool_response.stderr` (combined) and pipes through `extractMrUrls` (matches direct `.../pull/N` and `.../-/merge_requests/N` URLs AND reconstructs URLs from GitButler's structured JSON output where `repositoryHttpsUrl` and `number` appear as separate fields) → `POST /api/hooks/mr`. Kept in sync with [[server/mr-links.ts#extractMrUrls]] and [[server/extensions/pi-extension.ts]].

## Pi Extension

The [[server/extensions/pi-extension.ts]] uses Pi's event API:

- `input` event → `POST /api/hooks/prompt`
- `agent_end` event → `POST /api/hooks/idle`
- `tool_call` (any tool) → `POST /api/hooks/working` as a recovery signal. Pi analogue of Claude Code's `PreToolUse`. Critical after a devbench server restart — [[server/monitor-manager.ts#resumeSessionMonitors]] initializes agent-status in "waiting", and Pi's `input` event only fires on fresh user prompts, so without this the indicator would stay stuck on "waiting" for the remainder of the current turn.
- `tool_call` for bash → stores command in a map keyed by `toolCallId`
- `tool_execution_end` for write/edit → `POST /api/hooks/changes`
- `tool_execution_end` for bash → checks stored command for `git push` or `but push` → `POST /api/hooks/committed`
- `tool_execution_end` for bash → scans output via `extractMrUrls` for both direct MR/PR URLs and GitButler JSON (`repositoryHttpsUrl` + `number`) → `POST /api/hooks/mr`. Kept in sync with [[server/mr-links.ts#extractMrUrls]] and [[server/extensions/claude-hook.js]].

## Codex Hook

The [[server/extensions/codex-hook.js]] bridges Codex lifecycle hooks into devbench. It persists the real Codex thread id and forwards prompt, idle, and Bash-derived status/MR events.

- `SessionStart` → `POST /api/hooks/session-start` with Codex's `session_id`, persisting the true thread id for later `codex resume <id>`
- `UserPromptSubmit` → `POST /api/hooks/prompt`
- `PreToolUse` for Bash → `POST /api/hooks/working`
- `PostToolUse` for Bash → checks `tool_input.command` for `git push` or `but push` → `POST /api/hooks/committed`
- `PostToolUse` for Bash → scans `tool_response` via `extractMrUrls` and posts each MR/PR URL to `POST /api/hooks/mr`
- `Stop` → `POST /api/hooks/idle`

### Coverage Limits

Current Codex hooks only expose Bash in `PreToolUse` and `PostToolUse`, so non-Bash tool writes and richer change tracking are not covered by hooks. With `polling_disabled`, these gaps are accepted in exchange for eliminating terminal-scraping noise.

## Changes Tracking

File changes are tracked per-session via the `has_changes` column in [[database#Schema#Sessions]]. Uses tool-use events rather than git, since multiple sessions can share a project directory.

When `has_changes` is true, the sidebar shows a yellow dot on the session. The flag is cleared when the user runs prepare-commit-push (via [[server/routes/sessions.ts]]) or when the agent autonomously runs `git push` (detected by the hooks via the `/api/hooks/committed` endpoint). All archive and close popups ([[client/src/components/KillSessionPopup.tsx]], [[client/src/components/ConfirmPopup.tsx]], [[client/src/components/CloseSessionPopup.tsx]]) show a unified amber warning box with an `alert-triangle` icon when the session has uncommitted changes. Real-time updates are broadcast via the `session-has-changes` WebSocket event.

Codex currently still relies on polling for most file-change detection because its hook API only emits Bash post-tool payloads today.

### Path Scoping

Changes are scoped to the session's working directory so out-of-project writes don't trigger the unsaved-changes indicator. Critical for Claude Code plan mode.

The `/api/hooks/changes` endpoint accepts an optional `filePath` and `cwd`. When both are provided, [[server/monitor-manager.ts#isPathInsideCwd]] checks that the written file is inside the session's working directory before setting the flag. Writes outside `cwd` — notably Claude Code's plan-mode plan file (`~/.claude/plans/*.md` by default) — are silently ignored.

If either field is missing (legacy hook payloads, Pi extension) the containment check is skipped and the flag is set unconditionally, preserving backward compatibility.
