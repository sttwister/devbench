# Monitoring

Per-session background monitors that track agent activity, auto-rename sessions, detect MR/PR links, and poll MR status. All monitors are managed centrally by [[server/monitor-manager.ts]].

## Monitor Lifecycle

The [[server/monitor-manager.ts]] module provides centralized start/stop for all per-session monitors. Two entry points:

- **[[server/monitor-manager.ts#startSessionMonitors]]** — used for newly created or revived sessions. Starts all four monitors.
- **[[server/monitor-manager.ts#resumeSessionMonitors]]** — used at server startup for sessions that were already running. Uses `tryRenameNow` instead of `startAutoRename` to attempt an immediate rename based on existing terminal content.

When a session is killed or archived, [[server/monitor-manager.ts#stopSessionMonitors]] cleans up all monitors.

## Agent Status

The [[server/agent-status.ts]] module tracks whether an agent session is "working" or "waiting" by polling the terminal content every 3 seconds.

It hashes the upper portion of the terminal pane, excluding the bottom 5 lines (the input area). This avoids false positives from user keystrokes — only changes in the conversation/output area trigger a "working" status. After 2 consecutive unchanged polls, the status transitions to "waiting".

The status is exposed via the `/api/status` polling endpoint and displayed in the [[client#Sidebar]] as a spinner (working) or idle indicator (waiting).

## Auto-Rename

The [[server/auto-rename.ts]] module generates descriptive kebab-case session names using Claude Haiku once meaningful terminal activity is detected.

### Rename Triggers

Three triggers, checked in priority order:

1. **Status transition** — when agent status goes from "waiting" to "working" (the user just submitted their first message), the current terminal content is sent to the LLM immediately
2. **Content accumulation** — if 200+ characters of new content appear compared to the baseline, triggers naming
3. **Initial content** — if the terminal already has 30+ meaningful characters when the baseline is first captured (e.g. from an injected prompt), names immediately

### Content Normalization

The [[server/auto-rename.ts#normalizeContentForNaming]] function strips agent boot noise: update notices, skill conflict warnings, Pi/Claude branding, tmux boilerplate, and other non-task content. This ensures the LLM only sees task-relevant content.

### Name Generation

The LLM call uses `claude -p --model haiku` with a prompt that asks for a 2–5 word kebab-case description of the task. The output is sanitized to valid kebab-case characters.

### Resolve Session Work Name

The [[server/auto-rename.ts#resolveSessionWorkName]] function resolves a session's "work name" — used by prepare-commit-push to generate branch names. Priority: manual name > source label > LLM-generated name from terminal content.

## MR Link Detection

The [[server/mr-links.ts]] module scans terminal output every 10 seconds (500 lines of scrollback) for merge request and pull request URLs from GitLab, GitHub, and Bitbucket.

When new MR URLs are detected, the [[server/monitor-manager.ts]] callback:

1. Updates the session's `mr_url` in the database
2. Broadcasts the change to connected WebSocket clients
3. Triggers a [[gitbutler#Dashboard Cache]] refresh
4. Starts [[monitoring#MR Status Polling]] for the new URLs

Users can also manually add or dismiss MR URLs via the edit session popup.

## MR Status Polling

The [[server/mr-status.ts]] module polls GitLab and GitHub APIs every 60 seconds to fetch live MR/PR status: open/merged/closed, draft, approved, changes requested, pipeline status, and auto-merge state.

### Provider Detection

The [[server/mr-status.ts#detectProvider]] function determines whether a URL is a GitLab MR or GitHub PR based on URL patterns.

### API Integration

- **GitLab** — uses the `/api/v4/projects/:encoded/merge_requests/:iid` endpoint with a `PRIVATE-TOKEN` header. Checks approvals via a separate API call.
- **GitHub** — uses the `/repos/:owner/:repo/pulls/:number` endpoint with a Bearer token. Reviews are fetched separately to determine approved/changes-requested state.

Both require API tokens configured in [[database#Schema#Settings]].

### Status Broadcasting

When MR status changes, the callback in [[server/monitor-manager.ts#mrStatusChanged]] broadcasts the update to WebSocket clients. The [[client#Sidebar]] renders color-coded MR badges based on the status.

### Token Change Handling

When a user adds or changes an API token, [[server/monitor-manager.ts#restartMrStatusPollingForProvider]] re-evaluates all active sessions and starts polling for any that have MR URLs matching the updated provider.
