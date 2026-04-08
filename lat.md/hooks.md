# Hooks

Agent harness integration — Claude Code hooks and Pi extensions push structured events to devbench via HTTP API, replacing terminal scraping for status, naming, MR detection, and change tracking.

## Architecture

Dual-mode system: polling-based monitors ([[monitoring]]) continue as fallback, but hook events take priority when available. Terminal sessions and Codex use polling exclusively; Claude Code and Pi use hooks when the extensions are installed.

### Disable Polling

The `polling_disabled` setting in [[database#Schema#Settings]] disables terminal-scraping pollers for agent sessions.

When enabled, only hook events drive status, naming, and MR detection. The toggle is in the Settings UI under Agent Extensions and applies to new sessions. Terminal sessions always poll regardless of this setting.

### Communication Channel

Agents call devbench's HTTP REST API on `localhost:DEVBENCH_PORT`. Session identification uses `DEVBENCH_SESSION_ID`. Both are exported into the shell via `tmux send-keys` before the agent command runs during session creation in [[server/terminal.ts]].

## Hook API

The [[server/routes/hooks.ts]] module exposes six endpoints:

- **`POST /api/hooks/prompt`** — agent received a user prompt. Sets status to "working" and triggers [[monitoring#Auto-Rename]] from the prompt text.
- **`POST /api/hooks/working`** — agent is actively working (e.g. about to invoke a tool). Sets status to "working" without triggering rename. Acts as a recovery signal when `UserPromptSubmit` doesn't fire — notably plan-mode refinement, where the user response is routed into the `ExitPlanMode` tool continuation rather than submitted as a fresh prompt.
- **`POST /api/hooks/idle`** — agent finished working. Sets status to "waiting" and triggers [[monitoring#Notifications]].
- **`POST /api/hooks/mr`** — MR/PR URL detected. Feeds into the [[monitoring#MR Link Detection]] pipeline.
- **`POST /api/hooks/changes`** — agent wrote/edited a file. Sets `has_changes` flag on the session, scoped to files inside the session's working directory (see [[hooks#Changes Tracking]]).
- **`POST /api/hooks/committed`** — agent pushed via git. Clears `has_changes` flag on the session.

All endpoints accept JSON with `sessionId` (number) as a required field.

## Hook Event Processing

The [[server/monitor-manager.ts]] module provides dispatch functions for hook events:

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

- **Claude Code** — [[server/extensions/claude-hook.js]] → `~/.claude/hooks/devbench-hook.js`
- **Pi** — [[server/extensions/pi-extension.ts]] → `~/.pi/agent/extensions/devbench.ts`

### Version Tracking

Each extension has a version comment (e.g., `// devbench-hook v2`). The manager compares installed vs bundled versions.

When an update is available, the [[client#Sidebar]] shows an amber indicator dot on the settings gear icon; it clears immediately when the extension is updated via [[client/src/components/SettingsModal.tsx]].

### Claude Code Settings Merging

Installing the Claude Code hook adds entries to `~/.claude/settings.json` for `UserPromptSubmit`, `Stop`, `Notification`, `PreToolUse`, and `PostToolUse` events. Uninstalling removes only devbench entries without clobbering other hooks.

The uninstall filter matches any entry whose command contains `devbench-hook`, so new event types are cleaned up automatically without a version-aware migration.

## Extension Routes

The [[server/routes/extensions.ts]] module provides:

- **`GET /api/extensions/status`** — returns install status and version for each agent
- **`POST /api/extensions/install`** — install or update extensions
- **`POST /api/extensions/uninstall`** — remove extensions

## Claude Code Hook

The [[server/extensions/claude-hook.js]] is a self-contained Node.js script with no dependencies. It:

- Reads `DEVBENCH_PORT` and `DEVBENCH_SESSION_ID` from environment
- Exits silently when not running inside devbench
- Handles `UserPromptSubmit` → reads `prompt` field from stdin JSON → `POST /api/hooks/prompt`
- Handles `Stop` → `POST /api/hooks/idle`
- Handles `Notification` → `POST /api/hooks/idle` — fires when Claude Code needs user input (permission prompts, plan-mode approval via `ExitPlanMode`, idle-timeout). Without this, plan mode would leave the indicator stuck on "working" while the agent is blocked waiting for approval.
- Handles `PreToolUse` (all tools, no matcher) → `POST /api/hooks/working` — fires before every tool invocation as a recovery signal. Critical for plan-mode refinement: when the user types a refinement, Claude Code routes it into the `ExitPlanMode` tool continuation without firing `UserPromptSubmit`, so `PreToolUse` is the only reliable way to detect the resumed work and transition back to "working".
- Handles `PostToolUse` for Write/Edit/MultiEdit/NotebookEdit → `POST /api/hooks/changes` with `filePath` (from `tool_response.filePath`, falling back to `tool_input.file_path`) and `cwd`. Skipping when `filePath` is absent doubles as an error/blocked-response guard. Including `cwd` lets the server drop writes outside the project — notably Claude Code plan-mode plan files under `~/.claude/plans/`.
- Handles `PostToolUse` for Bash → reads `tool_input.command` for `git push` or `but push` → `POST /api/hooks/committed`
- Handles `PostToolUse` for Bash → reads `tool_response.stdout` and pipes it through `extractMrUrls` (matches direct `.../pull/N` and `.../-/merge_requests/N` URLs AND reconstructs URLs from GitButler's structured JSON output where `repositoryHttpsUrl` and `number` appear as separate fields) → `POST /api/hooks/mr`. Kept in sync with [[server/mr-links.ts#extractMrUrls]] and [[server/extensions/pi-extension.ts]].

## Pi Extension

The [[server/extensions/pi-extension.ts]] uses Pi's event API:

- `input` event → `POST /api/hooks/prompt`
- `agent_end` event → `POST /api/hooks/idle`
- `tool_call` for bash → stores command in a map keyed by `toolCallId`
- `tool_execution_end` for write/edit → `POST /api/hooks/changes`
- `tool_execution_end` for bash → checks stored command for `git push` or `but push` → `POST /api/hooks/committed`
- `tool_execution_end` for bash → scans output via `extractMrUrls` for both direct MR/PR URLs and GitButler JSON (`repositoryHttpsUrl` + `number`) → `POST /api/hooks/mr`. Kept in sync with [[server/mr-links.ts#extractMrUrls]] and [[server/extensions/claude-hook.js]].

## Changes Tracking

File changes are tracked per-session via the `has_changes` column in [[database#Schema#Sessions]]. Uses tool-use events rather than git, since multiple sessions can share a project directory.

When `has_changes` is true, the sidebar shows a yellow dot on the session. The flag is cleared when the user runs prepare-commit-push (via [[server/routes/sessions.ts]]) or when the agent autonomously runs `git push` (detected by the hooks via the `/api/hooks/committed` endpoint). All archive and close popups ([[client/src/components/KillSessionPopup.tsx]], [[client/src/components/ConfirmPopup.tsx]], [[client/src/components/CloseSessionPopup.tsx]]) show a unified amber warning box with an `alert-triangle` icon when the session has uncommitted changes. Real-time updates are broadcast via the `session-has-changes` WebSocket event.

### Path Scoping

Changes are scoped to the session's working directory so out-of-project writes don't trigger the unsaved-changes indicator. Critical for Claude Code plan mode.

The `/api/hooks/changes` endpoint accepts an optional `filePath` and `cwd`. When both are provided, [[server/monitor-manager.ts#isPathInsideCwd]] checks that the written file is inside the session's working directory before setting the flag. Writes outside `cwd` — notably Claude Code's plan-mode plan file (`~/.claude/plans/*.md` by default) — are silently ignored.

If either field is missing (legacy hook payloads, Pi extension) the containment check is skipped and the flag is set unconditionally, preserving backward compatibility.
