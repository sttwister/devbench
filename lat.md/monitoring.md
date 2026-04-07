# Monitoring

Per-session background monitors that track agent activity, auto-rename sessions, and detect MR/PR links. MR status polling uses a global poller. All monitors are managed centrally by [[server/monitor-manager.ts]].

## Monitor Lifecycle

The [[server/monitor-manager.ts]] module provides centralized start/stop for all per-session monitors. Terminal sessions are excluded at the top of both entry points — all monitors are agent-only.

When the `polling_disabled` setting is enabled (see [[hooks#Architecture#Disable Polling]]), per-session pollers are skipped — only hook-driven state is used. Two entry points:

- **[[server/monitor-manager.ts#startSessionMonitors]]** — used for newly created or revived sessions. Starts per-session monitors (agent-status, auto-rename, MR-link detection).
- **[[server/monitor-manager.ts#resumeSessionMonitors]]** — used at server startup for sessions that were already running. Passes `resume: true` to [[server/agent-status.ts#startMonitoring]] so that agent-status begins in "waiting" state, preventing false working→waiting notifications on restart. Uses `tryRenameNow` instead of `startAutoRename` to attempt an immediate rename based on existing terminal content.
- **[[server/monitor-manager.ts#startMrStatusPolling]]** — starts the global MR status poller at server startup.

When a session is killed or archived, [[server/monitor-manager.ts#stopSessionMonitors]] cleans up per-session monitors.

## Agent Status

The [[server/agent-status.ts]] module tracks whether an agent session is "working" or "waiting" by polling the terminal content every 3 seconds. When [[hooks]] are installed, status transitions are also driven by hook events via [[server/agent-status.ts#setStatusFromHook]], providing immediate feedback without polling delay.

It hashes the upper portion of the terminal pane, excluding the bottom 5 lines (the input area). This avoids false positives from user keystrokes — only changes in the conversation/output area trigger a "working" status. After 2 consecutive unchanged polls, the status transitions to "waiting".

When `resume` is true (server restart) or `noPoll` is true (hooks-only mode), the monitor starts in "waiting" state with the stable-count already at the threshold. For resume this prevents false notifications from server restarts; for noPoll it avoids a stuck "working" indicator — since there's no polling loop to detect idle, the status must default to "waiting" and let hook events drive transitions. If an agent is genuinely active, a hash change (polling) or hook event will transition it to "working" and then back to "waiting" with a real notification.

The status is exposed via the `/api/status` polling endpoint and displayed in the [[client#Sidebar]] as a spinner (working) or idle indicator (waiting). When the status transitions from "working" to "waiting", a [[monitoring#Notifications]] notification is created.

## Notifications

Server-governed notification system that alerts users when agent sessions need input. Notifications are tracked via the `notified_at` column on the [[database#Schema#Sessions]] table.

When [[server/agent-status.ts]] detects a working→waiting transition, the [[server/monitor-manager.ts#agentStatusChanged]] callback sets `notified_at` on the session. A 10-second debounce suppresses rapid re-notifications from type-pause-type cycles. Two events are then broadcast via [[server/events.ts#broadcast]]:

1. **`session-notified`** — sent immediately. Triggers sidebar glow on all clients. Clients viewing the session mark it as read, which cancels the pending sound.
2. **`session-notify-sound`** — sent after a 2-second delay, but only if no client has marked the session as read during that window. This is the trigger for audio and browser notification popups.

The `POST /api/sessions/:id/mark-read` endpoint clears `notified_at`, cancels any pending sound timer via [[server/monitor-manager.ts#cancelPendingSound]], and broadcasts a `notification-read` event. The [[server/routes/status.ts]] poll endpoint includes `notifiedSessionIds` for baseline state on page load.

On the client, the `session-notified` handler in [[client/src/App.tsx]] manages glow and auto-mark-read. If the app is visible (`!document.hidden`) and the user is viewing the notified session, it marks read immediately — the server’s pending sound timer is cancelled so no sound fires on any client. The `session-notify-sound` handler plays sound and browser popups unconditionally since the server already confirmed no client was viewing the session. A `visibilitychange` + `focus` listener auto-clears pending notifications when the app regains visibility. Notification preferences are stored in `localStorage` and managed via [[client/src/components/SettingsModal.tsx]]. Sessions with pending notifications show a green left-border glow and pulsing dot in the [[client#Sidebar]].

## Auto-Rename

The [[server/auto-rename.ts]] module generates descriptive kebab-case session names using Claude Haiku once meaningful terminal activity is detected. When [[hooks]] are installed, the actual user prompt text is available via [[server/auto-rename.ts#nameFromPrompt]], providing better naming signal than terminal scraping.

### Rename Triggers

Three triggers, checked in priority order:

1. **Status transition** — when agent status goes from "waiting" to "working" (the user just submitted their first message), the current terminal content is sent to the LLM immediately
2. **Content accumulation** — if 200+ characters of new content appear compared to the baseline, triggers naming
3. **Initial content** — if the terminal already has 30+ meaningful characters when the baseline is first captured (e.g. from an injected prompt), names immediately

### Content Normalization

The [[server/auto-rename.ts#normalizeContentForNaming]] function strips agent boot noise: update notices, skill conflict warnings, Pi/Claude branding, tmux boilerplate, and other non-task content. This ensures the LLM only sees task-relevant content.

### Name Generation

The LLM call uses `claude -p --model haiku` with a prompt that asks for a 2–5 word kebab-case description of the task, aiming for under 30 characters total. The output is sanitized to valid kebab-case characters.

### Source Content Naming

[[server/auto-rename.ts#generateNameFromSourceContent]] generates session names from issue/message content using the LLM instead of simple slugification.

Used by JIRA, Linear, and Slack background source processors. Produces more meaningful names — especially for non-English text or long messages where the first few words don't capture the intent. Falls back to the slugified name if the LLM call fails.

### Resolve Session Work Name

The [[server/auto-rename.ts#resolveSessionWorkName]] function resolves a session's "work name" — used by prepare-commit-push to generate branch names. Priority: manual name > source label > LLM-generated name from terminal content.

## MR Link Detection

The [[server/mr-links.ts]] module scans terminal output every 10 seconds for MR/PR URLs from GitLab and GitHub. [[hooks]] provide a faster direct path.

The scanner captures 500 lines of scrollback. When hooks are installed, MR URLs from git push output are also pushed directly via `POST /api/hooks/mr`, bypassing the scrollback scan.

When new MR URLs are detected, the [[server/monitor-manager.ts]] callback validates them against the GitLab/GitHub API before committing. URLs that return 404 are silently rejected and permanently ignored for the session. URLs that can't be verified (no API token, network error) are accepted on a benefit-of-the-doubt basis. Already-validated URLs bypass re-validation.

For validated URLs:

1. Creates or updates [[database#Schema#Merge Requests]] entities in the database
2. Syncs to legacy session `mr_url` column for backward compatibility
3. Broadcasts the change to connected WebSocket clients
4. Triggers a [[gitbutler#Dashboard Cache]] refresh
5. Triggers immediate [[monitoring#MR Status Polling]] for the new URLs

Users can also manually add or dismiss MR URLs via the edit session popup.

## MR Status Polling

The [[server/mr-status.ts]] module polls GitLab and GitHub APIs every 60 seconds to fetch live MR/PR status: open/merged/closed, draft, approved, changes requested, pipeline status, and auto-merge state.

It uses a single global poller (`startGlobalPolling`) that queries all open MRs for active sessions from the [[database#Schema#Merge Requests]] table. On-demand polling is available via `pollUrls()` for newly detected MRs, and `fetchAndUpdateStatuses()` for refreshing archived session MR statuses when the archived list is opened.

### Provider Detection

The [[server/mr-status.ts#detectProvider]] function determines whether a URL is a GitLab MR or GitHub PR based on URL patterns.

### API Integration

- **GitLab** — uses the `/api/v4/projects/:encoded/merge_requests/:iid` endpoint with a `PRIVATE-TOKEN` header. Checks approvals via a separate API call.
- **GitHub** — uses the `/repos/:owner/:repo/pulls/:number` endpoint with a Bearer token. Reviews are fetched separately to determine approved/changes-requested state.

Both require API tokens configured in [[database#Schema#Settings]].

### Status Broadcasting

When MR status changes, the callback in [[server/monitor-manager.ts#mrStatusChanged]] broadcasts the update to WebSocket clients. The [[client#Sidebar]] renders color-coded MR badges based on the status.

### Token Change Handling

When a user adds or changes an API token, [[server/monitor-manager.ts#restartMrStatusPollingForProvider]] calls [[server/mr-status.ts#onTokenChanged]] which re-evaluates all open MRs for active sessions and immediately polls any matching the updated provider.
