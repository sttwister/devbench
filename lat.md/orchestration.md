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
- **review** — manual review step before completion
- **finished** — approved and complete
- **rejected** — declined during review

### Session Roles

Each session created by orchestration has a role: `orchestrator`, `implement`, `review`, or `test`. Roles are tracked in the `orchestration_job_sessions` join table.

The orchestrator session is the coordinator; child sessions do the actual coding work.

### Sidebar Hiding

Orchestration sessions are hidden from the sidebar to avoid cluttering manual session lists.

The `selectSessionsByProject` query in [[server/db.ts]] excludes sessions whose `id` appears in `orchestration_job_sessions`. They remain accessible via the orchestration dashboard's session links (which fetch the session directly via `GET /api/sessions/:id`) and via `getSession(id)` for direct lookups. The `selectAllSessions` query (used for startup monitor resumption) still includes them.

For finished/rejected jobs whose sessions have been archived, clicking a session link in the dashboard auto-revives the session (via `POST /api/sessions/:id/revive`) before navigating to it. An archive-restore icon hints that revival will occur. The revival is temporary: when the user navigates away (selects another session or returns to the orchestration dashboard), the session is automatically re-archived via `DELETE /api/sessions/:id`. This is tracked by `autoRevivedSessionRef` in [[client/src/App.tsx]].

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

`startJob(jobId)` launches an orchestrator for a specific job immediately without starting the engine. The job runs to completion but no further todo jobs are pulled when it finishes — `scheduleNextOrchestrator()` is a no-op when the engine isn't running.

The `running` state is persisted to the `settings` table (`orchestration_running` key) so it survives server restarts. On startup, `resume()` is called from [[server/index.ts]] — if the engine was previously running, it restores the state and re-installs the wait script so in-flight orchestrator sessions can continue and next jobs get scheduled.

### Source Content Fetching

When a job with a `source_url` (Linear, JIRA, or Slack) is started and has no `description`, the engine fetches the issue content before building the orchestrator prompt. Uses the same API modules as session creation: [[server/linear.ts#fetchIssueFromUrl]], [[server/jira.ts#fetchIssueFromUrl]], [[server/slack.ts#fetchMessageFromUrl]].

The fetched content updates the job's `title` and `description` in the database, so the orchestrator prompt includes the full issue details. For JIRA, images are downloaded via [[server/jira.ts#buildPromptWithImages]]. For Slack, media attachments are downloaded. Linear and JIRA issues are also marked "In Progress" (fire-and-forget).

### Sequential Execution

Currently only one job runs at a time. `transitionJob()` detects terminal statuses and calls `scheduleNextOrchestrator()` to launch the next todo job.

Terminal statuses are: review, finished, waiting_input, rejected. Scheduling is handled inside `transitionJob()` so it works regardless of the caller (hooks, UI close, or PATCH).

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

### Continue Session Prompt

Builds a context summary prompt for continuing work on a job in a new manual session.

The [[server/orchestration-prompt.ts#buildContinueSessionPrompt]] function gathers job metadata, MR URLs with statuses, session roles, and the full event log grouped by phase boundaries. This gives the agent complete context about what was planned, implemented, reviewed, and tested.

## API Routes

The [[server/routes/orchestration.ts]] module provides REST endpoints:

- `GET /api/orchestration/jobs` — list all jobs with linked sessions, aggregated `mr_urls`, and `mr_statuses`
- `GET /api/orchestration/jobs/:id` — single job with linked sessions, `mr_urls`, and `mr_statuses`
- `GET /api/orchestration/jobs/:id/events` — job event log from DB (supports `?after_id=N` for incremental polling)
- `POST /api/orchestration/jobs` — create a job (title is optional when `source_url` is provided; the source URL is used as a placeholder title until content is fetched at start time)
- `PATCH /api/orchestration/jobs/:id` — update job fields or status
- `DELETE /api/orchestration/jobs/:id` — remove a job (blocked while status is working or review)
- `POST /api/orchestration/jobs/:id/close` — approve/close job: merge MRs, mark issues done, archive sessions, pull. Wrapped in try/catch to prevent server crashes from unhandled async errors
- `POST /api/orchestration/jobs/:id/continue-session` — create a regular sidebar session pre-loaded with job context (see [[orchestration#Continue Session]])
- `GET /api/orchestration/status` — engine state (running/stopped, `activeJobCount`)
- `POST /api/orchestration/start` — start the engine
- `POST /api/orchestration/stop` — stop the engine
- `POST /api/orchestration/jobs/:id/start` — start a specific job immediately
- `GET /api/linear/projects` — list all Linear projects (used by auto-association and the pull-issues popup); implemented in [[server/routes/projects.ts]]
- `GET /api/linear/projects/:projectId/issues` — list backlog/todo issues for a Linear project, sorted by priority
- `POST /api/projects/:id/linear-project` — associate a devbench project with a Linear project (`{ linear_project_id }`)
- `DELETE /api/projects/:id/linear-project` — remove the Linear association

### Hook Endpoints

Hook endpoints under `/api/orch/hooks/` are called by orchestrator agents via curl:

- `GET /api/orch/hooks/job?session_id=N` — returns the orchestrator's own job details
- `POST /api/orch/hooks/job-status` — updates the job status; triggers next orchestrator launch on terminal status
- `POST /api/orch/hooks/launch-child` — creates a new child session for the job and links it
- `GET /api/orch/hooks/child-status?session_id=N` — returns child session's agent status, changes flag, and session status
- `GET /api/orch/hooks/child-output?session_id=N&lines=N` — returns child's terminal output via tmux capture-pane
- `POST /api/orch/hooks/log` — appends an event to the job event log

## Dashboard UI

The [[client/src/components/OrchestrationDashboard.tsx]] renders a kanban board with project swimlanes. Toggled via `Ctrl+Shift+I` (registered in [[client/src/hooks/useKeyboardShortcuts.ts]] and [[electron/shortcuts.ts]]).

Features:

- Six-column kanban: Todo, Working, Waiting, Review, Finished, Rejected — with horizontal project swimlane rows (only projects that have jobs are shown). Sticky status column headers show total counts across all projects. On mobile (≤600px), swimlane project labels and the header spacer are `sticky; left: 0` so they stay pinned while columns scroll horizontally; the detail panel goes full-screen
- Job cards with title, project name, source link, MR badges, error display, and hover quick-actions
- Clicking a card opens a detail panel on the right with full info, MR badges, sessions, and live event log (event log grows to fill remaining vertical space)
- Session links show role badges: orchestrator sessions are highlighted with bot icon and accent color; child sessions show implement/review/test roles
- Add Job popup ([[client/src/components/NewJobPopup.tsx]]) mirrors the [[client/src/components/NewSessionPopup.tsx]] patterns: clipboard auto-paste of source URLs, inline issue preview (Linear/JIRA title + description tooltip), project selector with `j`/`k` cycling, agent type picker, and keyboard-driven workflow (`u` to edit URL, `Enter` to submit, `Esc` to close). On touch devices the URL input is shown by default (no `u` shortcut needed) and keyboard hint bar is hidden
- Start/Stop engine controls with live status indicator
- Clicking the orchestrator session link navigates to that tmux session where the user can watch the agent coordinate or type to provide input
- Polling every 3 seconds for real-time updates; MR statuses from job responses are merged into the global MrStatusContext so MrBadge components display correct status even though orchestration sessions are hidden from the sidebar
- Approve flow: clicking Approve (card quick-action or detail panel) opens a confirmation popup showing what will happen (merge MRs, mark issues done, archive sessions, optional GitButler pull) — mirrors the session close popup pattern from [[client/src/components/CloseSessionPopup.tsx]]
- Manual status override: detail panel has a "Move to..." dropdown button in the actions row that opens a menu of available statuses (click-outside closes it)
- Continue in Session: detail panel has a "Continue in Session" dropdown that lets the user pick an agent type and creates a new regular sidebar session pre-loaded with full job context (see [[orchestration#Continue Session]])
- Session navigation from the dashboard passes the job ID, enabling a "Back to Job" button in the terminal header (see [[orchestration#Dashboard UI#Session Navigation]])
- Re-opening the dashboard restores the previously selected job via `initialSelectedJobId` / `lastOrchestrationJobIdRef`
- `q` / `Escape` to close detail panel or dashboard

### Pull from Linear

Pulls backlog/todo issues from Linear as new orchestration jobs for projects associated with a Linear project.

The dashboard auto-associates devbench projects to Linear projects on mount by matching names case-insensitively — any unlinked devbench project whose name matches a Linear project gets its `linear_project_id` set via [[client/src/api.ts#setProjectLinearAssociation]]. Auto-association runs once per mount and silently skips projects that are already linked or have no Linear match (including when the Linear token is not configured).

When at least one project has a Linear association, a "Pull from Linear" button appears in the dashboard header. Clicking it opens [[client/src/components/PullLinearIssuesPopup.tsx]] which fetches backlog/todo issues for each linked project in parallel via [[client/src/api.ts#fetchLinearProjectIssues]], lists them grouped by devbench project sorted by priority, and lets the user tick which to pull. Issues whose URL already matches an existing job's `source_url` are shown as disabled ("existing") to prevent duplicates. On confirm, each selected issue is turned into an orchestration job via [[client/src/api.ts#createOrchestrationJob]] with the Linear URL as `source_url` so the engine fetches full details at start time (see [[orchestration#Engine#Source Content Fetching]]).

### Session Navigation

Clicking a session link passes both session ID and job ID to [[client/src/App.tsx]].

The job ID is stored in `navigatedFromJobId` state and `lastOrchestrationJobIdRef`. `navigatedFromJobId` drives a "Back to Job" button in the terminal header (rendered via [[client/src/components/MainContent.tsx]]) that returns the user to the orchestration dashboard with that job pre-selected. Clicking a session in the sidebar or navigating from the GitButler dashboard clears `navigatedFromJobId`.

## Continue Session

Creates a regular sidebar session pre-loaded with context from an orchestration job.

The `POST /api/orchestration/jobs/:id/continue-session` endpoint in [[server/routes/orchestration.ts]] creates the session (not linked to `orchestration_job_sessions`, so it appears in the sidebar). The user picks the agent type from a dropdown in the job detail panel.

The context prompt is built by [[server/orchestration-prompt.ts#buildContinueSessionPrompt]] and includes:

- Job metadata (title, status, project, source URL, agent type)
- Full description
- MR URLs with merge statuses
- Session roles used (orchestrator, implement, review, test)
- Complete event log grouped by phase boundaries, showing the orchestrator's decisions, session launches, results, and errors
- Any error message from the job

The session inherits the job's `source_url` so it displays the same issue badge in the sidebar. It gets a name like `continue-{slug}` derived from the job title. Any MR links from the job's linked sessions are copied to the new session — both the legacy `mr_url` column and [[database#Schema#Merge Requests]] entities are updated so the continue session shows the same MR badges.

## Keyboard Shortcut

`Ctrl+Shift+I` toggles the orchestration dashboard. Added to [[electron/shortcuts.ts]] as `"I": "toggle-orchestration"` and handled in both [[client/src/hooks/useKeyboardShortcuts.ts]] and [[client/src/hooks/useElectronBridge.ts]].
