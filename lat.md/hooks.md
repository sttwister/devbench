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

The [[server/routes/hooks.ts]] module exposes four endpoints:

- **`POST /api/hooks/prompt`** — agent received a user prompt. Sets status to "working" and triggers [[monitoring#Auto-Rename]] from the prompt text.
- **`POST /api/hooks/idle`** — agent finished working. Sets status to "waiting" and triggers [[monitoring#Notifications]].
- **`POST /api/hooks/mr`** — MR/PR URL detected. Feeds into the [[monitoring#MR Link Detection]] pipeline.
- **`POST /api/hooks/changes`** — agent wrote/edited a file. Sets `has_changes` flag on the session.

All endpoints accept JSON with `sessionId` (number) as a required field.

## Hook Event Processing

The [[server/monitor-manager.ts]] module provides dispatch functions for hook events:

- [[server/monitor-manager.ts#handleHookPrompt]] — sets agent status to "working" via [[server/agent-status.ts#setStatusFromHook]], triggers rename via [[server/auto-rename.ts#nameFromPrompt]]
- [[server/monitor-manager.ts#handleHookIdle]] — sets agent status to "waiting", triggers notification flow
- [[server/monitor-manager.ts#handleHookMrUrl]] — feeds URL into existing MR link pipeline
- [[server/monitor-manager.ts#handleHookChanges]] — sets `has_changes` on session, broadcasts event

## Extension Manager

The [[server/extension-manager.ts]] module manages installation, uninstallation, and version checking of agent extensions.

### Bundled Extensions

Extensions are bundled in `server/extensions/` and copied to global locations on install:

- **Claude Code** — [[server/extensions/claude-hook.js]] → `~/.claude/hooks/devbench-hook.js`
- **Pi** — [[server/extensions/pi-extension.ts]] → `~/.pi/agent/extensions/devbench.ts`

### Version Tracking

Each extension has a version comment (e.g., `// devbench-hook v1`). The manager compares installed vs bundled versions.

### Claude Code Settings Merging

Installing the Claude Code hook adds entries to `~/.claude/settings.json` for `UserPromptSubmit`, `Stop`, and `PostToolUse` events. Uninstalling removes only devbench entries without clobbering other hooks.

## Extension Routes

The [[server/routes/extensions.ts]] module provides:

- **`GET /api/extensions/status`** — returns install status and version for each agent
- **`POST /api/extensions/install`** — install or update extensions
- **`POST /api/extensions/uninstall`** — remove extensions

## Claude Code Hook

The [[server/extensions/claude-hook.js]] is a self-contained Node.js script with no dependencies. It:

- Reads `DEVBENCH_PORT` and `DEVBENCH_SESSION_ID` from environment
- Exits silently when not running inside devbench
- Handles `UserPromptSubmit` → `POST /api/hooks/prompt`
- Handles `Stop` → `POST /api/hooks/idle`
- Handles `PostToolUse` for Write/Edit → `POST /api/hooks/changes`
- Handles `PostToolUse` for Bash → scans output for MR URLs → `POST /api/hooks/mr`

## Pi Extension

The [[server/extensions/pi-extension.ts]] uses Pi's event API:

- `input` event → `POST /api/hooks/prompt`
- `agent_end` event → `POST /api/hooks/idle`
- `tool_execution_end` for write/edit → `POST /api/hooks/changes`
- `tool_execution_end` for bash → scans output for MR URLs → `POST /api/hooks/mr`

## Changes Tracking

File changes are tracked per-session via the `has_changes` column in [[database#Schema#Sessions]]. Uses tool-use events rather than git, since multiple sessions can share a project directory.

When `has_changes` is true, the sidebar shows a yellow dot on the session. The flag is cleared when the user runs prepare-commit-push (via [[server/routes/sessions.ts]]). All archive and close popups ([[client/src/components/KillSessionPopup.tsx]], [[client/src/components/ConfirmPopup.tsx]], [[client/src/components/CloseSessionPopup.tsx]]) show a unified amber warning box with an `alert-triangle` icon when the session has uncommitted changes. Real-time updates are broadcast via the `session-has-changes` WebSocket event.
