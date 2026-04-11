# Orchestration

Autonomous job execution system that manages a backlog of work items, launches coding agents, runs code review and testing cycles, and progresses through a workflow until done or blocked.

## Data Model

Three database tables store orchestration state in [[server/db.ts]]:

- `orchestration_jobs` — job records with project link, title, description, source URL, status, agent configuration, loop counters, and error tracking
- `orchestration_job_sessions` — links jobs to the devbench sessions spawned for implementation, review, and testing
- `orchestration_job_events` — persistent event log per job with timestamp, type, and message (survives restarts)

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
2. **Implementation** — launches an agent session to write code (no commit/push)
3. **Code Review** — launches an agent to review and fix issues (no commit/push); loops if changes were made
4. **Testing** — launches an agent to run tests and fix failures (no commit/push); loops if changes were made
5. **Commit & Push** — launches an agent with `/git-commit-and-push` to commit via GitButler and create a PR/MR
6. Transitions the job to `review` for manual approval

No phase commits or pushes except the final commit phase. Each phase's prompt explicitly forbids `git commit` / `git push` so agents only do the work assigned to them. The commit phase uses the `/git-commit-and-push` skill which detects GitButler and follows the correct workflow.

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

Persistent structured event log per job, stored in the `orchestration_job_events` database table and exposed via `GET /api/orchestration/jobs/:id/events`.

Events are recorded to the database during execution (phases, sessions launched, errors, output snippets) via [[server/db.ts]]. Each event has a type (`info`, `phase`, `error`, `session`, `output`) for color-coded rendering and an auto-increment `id` for incremental polling. All events are kept (cleaned up via CASCADE on job deletion). The API supports `?after_id=N` for efficient incremental polling from the dashboard detail panel.

### Start / Stop

`start()` begins the loop; `stop()` halts it and cancels any pending agent wait. The engine processes jobs sequentially. When the backlog is empty, it stops automatically. State changes are broadcast via [[server/events.ts#broadcast]].

`startJob(jobId)` starts a specific job immediately. It resets the job to `todo` if needed, starts the engine if not running, and executes the job directly (bypassing the queue). After the job completes, the engine continues with any remaining `todo` jobs. This is the handler behind the "Start Now" button in the dashboard.

## MR Integration

Jobs aggregate MR/PR URLs from all linked sessions. The API enriches every job response with a deduplicated `mr_urls` array.

MR badges are rendered on both kanban cards and the detail panel using the shared [[client/src/components/MrBadge.tsx]] component, reading status from the global MR status store.

## Close Job

The `POST /api/orchestration/jobs/:id/close` endpoint in [[server/routes/orchestration.ts]] performs a full job teardown, mirroring the [[sessions#Close Session]] flow:

1. Merge all open MR/PR URLs (aggregated from linked sessions) via [[server/mr-merge.ts]]
2. Mark the source issue as Done (Linear via [[server/linear.ts#markIssueDone]]) or Needs Testing (JIRA via [[server/jira.ts#markIssueNeedsTesting]])
3. Archive all linked sessions (stop monitors, kill tmux)
4. Transition job to `finished`
5. Optionally pull on GitButler and refresh dashboard cache

The dashboard shows a "Close Job" button on review-status jobs and a "Merge & Close" button on finished jobs that still have MR URLs. Results are shown in a toast notification matching the existing session close toast styling.

## API Routes

The [[server/routes/orchestration.ts]] module provides REST endpoints:

- `GET /api/orchestration/jobs` — list all jobs with linked sessions and aggregated `mr_urls`
- `GET /api/orchestration/jobs/:id` — single job with linked sessions and `mr_urls`
- `GET /api/orchestration/jobs/:id/events` — job event log from DB (supports `?after_id=N` for incremental polling)
- `POST /api/orchestration/jobs` — create a job
- `PATCH /api/orchestration/jobs/:id` — update job fields or status
- `DELETE /api/orchestration/jobs/:id` — remove a job (blocked while status is working, testing, or review)
- `POST /api/orchestration/jobs/:id/close` — close job: merge MRs, mark issues done, archive sessions, pull
- `GET /api/orchestration/status` — engine state (running/stopped, current job, `activeJobCount`)
- `POST /api/orchestration/start` — start the engine
- `POST /api/orchestration/stop` — stop the engine
- `POST /api/orchestration/jobs/:id/start` — start a specific job immediately (resets to todo, launches engine)

## Dashboard UI

The [[client/src/components/OrchestrationDashboard.tsx]] renders a kanban board showing jobs grouped by status. Toggled via `Ctrl+Shift+I` (registered in [[client/src/hooks/useKeyboardShortcuts.ts]] and [[electron/shortcuts.ts]]).

Features:

- Seven-column kanban: Todo, Working, Waiting, Testing, Review, Finished, Rejected
- Job cards with title, project name, source link, MR badges, error display, and hover quick-actions
- Clicking a card opens a detail panel on the right with full info, MR badges, sessions, close actions, and live event log
- Add Job form with project selector, title, description, source URL, and agent type
- Start/Stop engine controls with live status indicator
- Session links navigate to the terminal view for that session
- Polling every 3 seconds for real-time updates
- Manual status override: detail panel shows "Move to" buttons for every other status, allowing force-transition of stuck jobs
- `q` / `Escape` to close detail panel or dashboard

## Keyboard Shortcut

`Ctrl+Shift+I` toggles the orchestration dashboard. Added to [[electron/shortcuts.ts]] as `"I": "toggle-orchestration"` and handled in both [[client/src/hooks/useKeyboardShortcuts.ts]] and [[client/src/hooks/useElectronBridge.ts]].
