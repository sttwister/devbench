# Orchestration

Autonomous job execution system that manages a backlog of work items, launches coding agents, runs code review and testing cycles, and progresses through a workflow until done or blocked.

## Data Model

Two database tables store orchestration state in [[server/db.ts]]:

- `orchestration_jobs` — job records with project link, title, description, source URL, status, agent configuration, loop counters, and error tracking
- `orchestration_job_sessions` — links jobs to the devbench sessions spawned for implementation, review, and testing

### Job Status

Jobs progress through a state machine defined by [[shared/types.ts]]:

- **todo** — queued for processing
- **working** — implementation agent is running
- **waiting_input** — blocked; needs user clarification or timed out
- **testing** — test agent is running
- **review** — manual review step before completion
- **finished** — approved and complete
- **rejected** — declined during review

### Session Roles

Each session created by orchestration has a role: `implement`, `review`, or `test`. Roles are tracked in the `orchestration_job_sessions` join table so the dashboard can show which sessions belong to which job phase.

## Engine

The [[server/orchestration.ts]] module runs the orchestration loop. It picks the next `todo` job, launches agent sessions, waits for completion, and progresses through implementation → review → testing phases.

### Job Execution Flow

For each job, the engine:

1. Builds a prompt from the job description and optional Linear issue (via [[server/linear.ts#fetchIssue]])
2. Launches an implementation session using [[server/terminal.ts#createTmuxSession]] with a prompt that instructs the agent to commit and push
3. Waits for the agent to go idle using [[server/agent-status.ts#getStatus]] polling with an idle threshold (3 consecutive idle checks after seeing "working")
4. Launches a code review session — if the reviewer makes changes (detected via `has_changes`), loops for another review pass
5. Launches a testing session — if the tester makes fixes, loops for another test pass
6. Transitions the job to `review` for manual approval

Each phase uses configurable agent types and max loop counts. If any phase times out or fails, the job moves to `waiting_input` and the engine proceeds to the next job.

### Agent Completion Detection

Polls [[server/agent-status.ts#getStatus]] every 5 seconds, requiring 3 consecutive idle checks after seeing `working` to confirm completion.

This avoids false positives during agent boot (must see `working` first) and is more robust than checking `notified_at` which can be affected by UI interactions. The `notified_at` notification is cleared after detection to avoid duplicate alerts.

### Review and Test Loops

Checks `has_changes` on the session after each review/test pass to decide whether another loop is needed.

If the agent made file changes, it indicates issues were found and fixed, so another pass runs. Loops continue up to `max_review_loops` / `max_test_loops` (default 3). If no changes were made, the code is considered clean and the loop exits.

### Cancellation

An `AbortController` per job allows clean cancellation when `stop()` is called.

The `AbortSignal` is threaded through `waitForAgentCompletion` and `launchAgentSession`, which check `signal.aborted` before starting work and resolve with `"cancelled"` if the signal fires during a wait.

### Job Event Log

In-memory structured event log per job, exposed via `GET /api/orchestration/jobs/:id/events` and displayed in the detail panel.

Events are recorded during execution (phases, sessions launched, errors, output snippets) in a `Map<number, JobEvent[]>`. Each event has a type (`info`, `phase`, `error`, `session`, `output`) for color-coded rendering. Limited to 200 events per job.

### Start / Stop

`start()` begins the loop; `stop()` halts it and cancels any pending agent wait. The engine processes jobs sequentially. When the backlog is empty, it stops automatically. State changes are broadcast via [[server/events.ts#broadcast]].

## API Routes

The [[server/routes/orchestration.ts]] module provides REST endpoints:

- `GET /api/orchestration/jobs` — list all jobs (optionally filter by `project_id`)
- `GET /api/orchestration/jobs/:id` — single job with linked sessions
- `GET /api/orchestration/jobs/:id/events` — job event log (in-memory)
- `POST /api/orchestration/jobs` — create a job
- `PATCH /api/orchestration/jobs/:id` — update job fields or status
- `DELETE /api/orchestration/jobs/:id` — remove a job (blocked while status is working, testing, or review)
- `GET /api/orchestration/status` — engine state (running/stopped, current job, `activeJobCount`)
- `POST /api/orchestration/start` — start the engine
- `POST /api/orchestration/stop` — stop the engine

## Dashboard UI

The [[client/src/components/OrchestrationDashboard.tsx]] renders a kanban board showing jobs grouped by status. Toggled via `Ctrl+Shift+I` (registered in [[client/src/hooks/useKeyboardShortcuts.ts]] and [[electron/shortcuts.ts]]).

Features:

- Seven-column kanban: Todo, Working, Waiting, Testing, Review, Finished, Rejected
- Job cards with title, project name, source link, error display, and hover quick-actions
- Clicking a card opens a detail panel on the right with full info, sessions, actions, and live event log
- Add Job form with project selector, title, description, source URL, and agent type
- Start/Stop engine controls with live status indicator
- Session links navigate to the terminal view for that session
- Polling every 3 seconds for real-time updates
- `q` / `Escape` to close detail panel or dashboard

## Keyboard Shortcut

`Ctrl+Shift+I` toggles the orchestration dashboard. Added to [[electron/shortcuts.ts]] as `"I": "toggle-orchestration"` and handled in both [[client/src/hooks/useKeyboardShortcuts.ts]] and [[client/src/hooks/useElectronBridge.ts]].
