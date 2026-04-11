# Orchestration

Autonomous job execution system that manages a backlog of work items. Each job gets its own orchestrator agent session that coordinates implementation, code review, testing, and commit by launching child agent sessions.

## Data Model

Three database tables store orchestration state in [[server/db.ts]]:

- `orchestration_jobs` — job records with project link, title, description, source URL, status, agent configuration, loop counters, and error tracking
- `orchestration_job_sessions` — links jobs to the devbench sessions spawned for implementation, review, and testing
- `orchestration_job_events` — persistent event log per job with timestamp, type, and message (survives restarts)

### Job Status

Jobs progress through a state machine defined by [[shared/types.ts]]:

- **todo** — queued for processing
- **working** — orchestrator agent is running
- **waiting_input** — blocked; needs user clarification or timed out
- **testing** — test agent is running
- **review** — manual review step before completion
- **finished** — approved and complete
- **rejected** — declined during review

### Session Roles

Each session created by orchestration has a role: `orchestrator`, `implement`, `review`, or `test`. Roles are tracked in the `orchestration_job_sessions` join table.

The orchestrator session is the coordinator; child sessions do the actual coding work.

### Sidebar Hiding

Orchestration sessions are hidden from the sidebar to avoid cluttering manual session lists.

The `selectSessionsByProject` query in [[server/db.ts]] excludes sessions whose `id` appears in `orchestration_job_sessions`. They remain accessible via the orchestration dashboard's session links (which fetch the session directly via `GET /api/sessions/:id`) and via `getSession(id)` for direct lookups. The `selectAllSessions` query (used for startup monitor resumption) still includes them.

## Engine

The [[server/orchestration.ts]] module is a thin server-side layer. It manages job CRUD, launches orchestrator sessions for todo jobs, and provides hook endpoints that orchestrator agents call via curl.

### Architecture

Each job gets its own orchestrator agent session (Claude/Pi in tmux) that manages the job lifecycle by launching child sessions via the hook API.

The orchestrator waits for children with the `devbench-wait` script and progresses through implementation → review → test → commit phases.

The server's role is:

1. CRUD for jobs (unchanged)
2. Launching orchestrator sessions (one per job)
3. Providing hook endpoints for orchestrators to call via curl
4. Providing the `devbench-wait` script for blocking child-session waits

All intelligence (deciding what to do next, interpreting outputs, handling errors) lives in the orchestrator agent prompt.

### Start / Stop

`start()` installs the wait script and scans for todo jobs, launching an orchestrator session for the first one. `stop()` prevents new orchestrators from launching; existing orchestrator sessions keep running (they're just tmux sessions).

`startJob(jobId)` launches an orchestrator for a specific job immediately. If the engine isn't running, it starts it.

### Source Content Fetching

When a job with a `source_url` (Linear, JIRA, or Slack) is started and has no `description`, the engine fetches the issue content before building the orchestrator prompt. Uses the same API modules as session creation: [[server/linear.ts#fetchIssueFromUrl]], [[server/jira.ts#fetchIssueFromUrl]], [[server/slack.ts#fetchMessageFromUrl]].

The fetched content updates the job's `title` and `description` in the database, so the orchestrator prompt includes the full issue details. For JIRA, images are downloaded via [[server/jira.ts#buildPromptWithImages]]. For Slack, media attachments are downloaded. Linear and JIRA issues are also marked "In Progress" (fire-and-forget).

### Sequential Execution

Currently only one job runs at a time. When a job transitions to a terminal status (review, finished, waiting_input, rejected), the `scheduleNextOrchestrator()` function launches the next todo job.

### Child Session Launching

The `launchChildSession()` function is called from the `/api/orch/hooks/launch-child` endpoint. It creates a devbench session, links it to the job, launches the tmux session with the prompt, and starts monitors.

### Wait Script

The `server/scripts/devbench-wait` bash script blocks until a child agent session finishes. Polls `/api/orch/hooks/child-status` every 10 seconds, uses 3-consecutive-idle logic.

On completion it fetches the child's terminal output via `/api/orch/hooks/child-output`. Exit 0 = finished, exit 1 = timeout (default 30 min).

The script is installed to `/tmp/devbench-wait-<port>.sh` when the engine starts and cleaned up on stop.

### Job Event Log

Persistent structured event log per job, stored in the `orchestration_job_events` database table and exposed via `GET /api/orchestration/jobs/:id/events`.

Events are recorded by both the engine (session launches, status changes) and the orchestrator agent (via the `/api/orch/hooks/log` endpoint). Each event has a type (`info`, `phase`, `error`, `session`, `output`) and an auto-increment `id` for incremental polling.

## Prompt Template

The [[server/orchestration-prompt.ts#buildOrchestratorPrompt]] function generates the initial prompt for an orchestrator agent session.

The prompt teaches the agent:

1. Its role as a job orchestrator (coordinator, not coder)
2. The specific job details (title, description, source URL, project path)
3. The API reference (curl commands for each hook endpoint)
4. The `devbench-wait` script usage for blocking waits on child sessions
5. The workflow (implement → review → test → commit → set review)
6. Decision-making rules (when to retry, when to escalate, loop limits)
7. Important rules (don't code directly, handle commit/push yourself after all phases, use waiting_input when stuck)

## API Routes

The [[server/routes/orchestration.ts]] module provides REST endpoints:

- `GET /api/orchestration/jobs` — list all jobs with linked sessions, aggregated `mr_urls`, and `mr_statuses`
- `GET /api/orchestration/jobs/:id` — single job with linked sessions, `mr_urls`, and `mr_statuses`
- `GET /api/orchestration/jobs/:id/events` — job event log from DB (supports `?after_id=N` for incremental polling)
- `POST /api/orchestration/jobs` — create a job (title is optional when `source_url` is provided; the source URL is used as a placeholder title until content is fetched at start time)
- `PATCH /api/orchestration/jobs/:id` — update job fields or status
- `DELETE /api/orchestration/jobs/:id` — remove a job (blocked while status is working, testing, or review)
- `POST /api/orchestration/jobs/:id/close` — close job: merge MRs, mark issues done, archive sessions, pull
- `GET /api/orchestration/status` — engine state (running/stopped, `activeJobCount`)
- `POST /api/orchestration/start` — start the engine
- `POST /api/orchestration/stop` — stop the engine
- `POST /api/orchestration/jobs/:id/start` — start a specific job immediately

### Hook Endpoints

Hook endpoints under `/api/orch/hooks/` are called by orchestrator agents via curl:

- `GET /api/orch/hooks/job?session_id=N` — returns the orchestrator's own job details
- `POST /api/orch/hooks/job-status` — updates the job status; triggers next orchestrator launch on terminal status
- `POST /api/orch/hooks/launch-child` — creates a new child session for the job and links it
- `GET /api/orch/hooks/child-status?session_id=N` — returns child session's agent status, changes flag, and session status
- `GET /api/orch/hooks/child-output?session_id=N&lines=N` — returns child's terminal output via tmux capture-pane
- `POST /api/orch/hooks/log` — appends an event to the job event log

## Dashboard UI

The [[client/src/components/OrchestrationDashboard.tsx]] renders a kanban board showing jobs grouped by status. Toggled via `Ctrl+Shift+I` (registered in [[client/src/hooks/useKeyboardShortcuts.ts]] and [[electron/shortcuts.ts]]).

Features:

- Seven-column kanban: Todo, Working, Waiting, Testing, Review, Finished, Rejected
- Job cards with title, project name, source link, MR badges, error display, and hover quick-actions
- Clicking a card opens a detail panel on the right with full info, MR badges, sessions, close actions, and live event log
- Session links show role badges: orchestrator sessions are highlighted with bot icon and accent color; child sessions show implement/review/test roles
- Add Job form with project selector, title, description, source URL, and agent type
- Start/Stop engine controls with live status indicator
- Clicking the orchestrator session link navigates to that tmux session where the user can watch the agent coordinate or type to provide input
- Polling every 3 seconds for real-time updates; MR statuses from job responses are merged into the global MrStatusContext so MrBadge components display correct status even though orchestration sessions are hidden from the sidebar
- Manual status override: detail panel shows "Move to" buttons for every other status
- `q` / `Escape` to close detail panel or dashboard

## Keyboard Shortcut

`Ctrl+Shift+I` toggles the orchestration dashboard. Added to [[electron/shortcuts.ts]] as `"I": "toggle-orchestration"` and handled in both [[client/src/hooks/useKeyboardShortcuts.ts]] and [[client/src/hooks/useElectronBridge.ts]].
