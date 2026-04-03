# Sessions

Session lifecycle management — creation, types, tmux integration, revival, and archival. Sessions are the core unit of work in devbench.

## Session Types

Four session types are supported, defined in [[shared/session-config.ts]]:

- **Terminal** — plain shell session, no agent
- **Claude Code** — launches `claude --session-id <uuid> --dangerously-skip-permissions`
- **Pi** — launches `pi --session <path>` with a deterministic session file
- **Codex** — launches `codex`

Each type has a label, icon, and keyboard shortcut key for the new-session popup.

## Session Creation

Session creation is handled by the `POST /api/projects/:id/sessions` endpoint in [[server/routes/sessions.ts]]. The flow:

1. Validate project exists and session type is valid
2. Detect source URL type (Jira, Linear, Sentry, etc.) via [[shared/source-utils.ts#detectSourceType]]
3. For non-issue sources, use source label as initial name; for JIRA/Linear, keep the default name
4. Create a detached tmux session via [[server/terminal.ts#createTmuxSession]]
5. Store the session in the database via [[server/db.ts]]
6. Start all [[monitoring]] for the new session
7. For JIRA/Linear sources, schedule background processing after a 3-second boot delay — fetches issue details, renames the session, pastes the prompt (see [[integrations#JIRA API#Session Integration]])

## Tmux Management

Every session runs inside a detached tmux session, providing persistence across page reloads, reconnects, and server restarts. The [[server/terminal.ts]] module manages tmux lifecycle:

- **[[server/terminal.ts#createTmuxSession]]** — creates a detached tmux session with 200×50 dimensions, then sends the agent launch command via `tmux send-keys`
- **[[server/terminal.ts#attachToSession]]** — spawns a node-pty process that runs `tmux attach-session`, bridging WebSocket I/O to the tmux pane
- **[[server/terminal.ts#broadcastControl]]** — sends JSON control messages to all WebSocket clients attached to a specific tmux session

The tmux session naming convention is `devbench_<projectId>_<timestamp>`.

## Agent Session Tracking

Agent sessions are tracked so conversations can be resumed after crashes or archival. The [[server/agent-session-tracker.ts]] module handles this:

- **Claude** — generates a random UUID used as `--session-id`. On resume, uses `--resume <id>`.
- **Pi** — generates a session file path under `~/.pi/agent/sessions/`. On resume, reuses the same `--session <path>`.
- **Codex** — uses `codex resume <id>` on resume.

The [[server/agent-session-tracker.ts#getLaunchInfo]] function is the unified entry point that determines the launch command, agent session ID, and optional prompt file for any session type and scenario (fresh launch vs resume, with or without initial prompt).

### Initial Prompt Injection

When a session has an initial prompt (e.g. from a Linear issue or source URL), it is written to a temp file (`/tmp/devbench-prompt-<uuid>.md`) and passed to the agent:

- Claude: `claude ... -- "$(cat /tmp/devbench-prompt-xxx.md)"`
- Pi: `pi ... @/tmp/devbench-prompt-xxx.md`

The temp file is cleaned up after 60 seconds. For Linear issues, a different mechanism is used: the prompt is pasted into the terminal via `tmux load-buffer` + `paste-buffer` after a 3-second delay, allowing the agent TUI to fully boot first.

## Session Revival

Orphaned or archived sessions can be revived via `POST /api/sessions/:id/revive` in [[server/routes/sessions.ts]]. Revival creates a new tmux session and resumes the agent conversation using the stored `agent_session_id`.

### Orphaned Sessions

Sessions whose tmux died are marked orphaned at startup, preserving them for revival.

Orphaned sessions appear dimmed in the sidebar with a revive button. Managed by [[server/monitor-manager.ts#markOrphaned]].

## Session Archival

Sessions are archived (not deleted) when killed, allowing later recovery. The archive flow:

1. Stop all [[monitoring]] for the session
2. Destroy the tmux session via [[server/tmux-utils.ts#destroyTmuxSession]]
3. Set status to `archived` in the database

When the active session is killed or closed, the UI navigates to the **previous** session in sidebar order (falling back to the next if none exists). This favors landing in the same project, since users typically keep a terminal as the first session per project. Managed by [[client/src/hooks/useSessionActions.ts]].

Archived sessions can be browsed via the archived sessions popup and revived from there.

## Close Session

The `POST /api/sessions/:id/close` endpoint in [[server/routes/sessions.ts]] performs a full session teardown:

1. Merge all open MR/PR URLs via [[server/mr-merge.ts]]
2. Mark the Linear issue as Done (if source is Linear) via [[server/linear.ts#markIssueDone]]; mark the JIRA issue as Done (if source is JIRA) via [[server/jira.ts#markIssueDone]]
3. Archive the session
4. Optionally pull on GitButler and refresh the dashboard cache

## Session Naming

Sessions start with a default name like "Claude Code 1". The [[server/session-naming.ts]] module provides naming utilities.

[[server/session-naming.ts#slugifySessionName]] is the single source of truth for converting text to a kebab-case session name (max 30 chars, truncated at word boundary). It is used by JIRA/Linear issue naming and [[monitoring#Auto-Rename]]. The default name pattern is defined by [[server/session-naming.ts#DEFAULT_NAME_RE]].
