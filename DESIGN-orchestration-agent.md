# Orchestration Agent Session Refactoring

## Overview

Replace the current server-side orchestration engine (which executes a rigid
`implement → review → test → commit` pipeline in TypeScript) with a
**per-job orchestrator agent session**. Each job gets its own Claude Code or Pi
agent running in a tmux session whose sole responsibility is to manage that
job's lifecycle by launching child sessions, waiting for them, evaluating
results, and progressing through the workflow.

The server becomes a thin layer: CRUD for jobs, launching orchestrator
sessions, and providing hook endpoints that orchestrator agents call via `curl`.

## Architecture

```
┌─ Devbench Server ──────────────────────────────────────────────┐
│                                                                │
│  Orchestration Manager (thin server-side layer)                │
│  ├─ Job CRUD (existing, unchanged)                             │
│  ├─ start() → launch orchestrator sessions for todo jobs       │
│  ├─ startJob(id) → launch one orchestrator session             │
│  ├─ stop() → stop launching new orchestrators                  │
│  └─ Orchestration Hook API (new endpoints for agents to call)  │
│                                                                │
│  ┌─ Job 1 ──────────────────────────────────────────────────┐  │
│  │  Orchestrator Session (Claude/Pi in tmux)                │  │
│  │  ├─ Linked to job with role "orchestrator"               │  │
│  │  ├─ System prompt: job details + API reference           │  │
│  │  ├─ Uses curl to call /api/orch/hooks/* endpoints        │  │
│  │  ├─ Uses devbench-wait script to block on child sessions │  │
│  │  │                                                       │  │
│  │  ├── Child: implement (Claude/Pi in tmux)                │  │
│  │  ├── Child: review    (Claude/Pi in tmux)                │  │
│  │  ├── Child: test      (Claude/Pi in tmux)                │  │
│  │  └── Child: implement (commit & push phase)              │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌─ Job 2 ──────────────────────────────────────────────────┐  │
│  │  Orchestrator Session (independent, same pattern)        │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### One orchestrator per job (not one for all jobs)

- Each job gets its own orchestrator agent session
- Orchestrators run independently — one job blocking doesn't affect others
- Natural path to parallelism: launch multiple orchestrators simultaneously
- Simpler prompts — each orchestrator only knows about its own job
- The orchestrator session IS the job; the user can watch and interact with it

### Blocking wait via script (not polling from the agent)

The orchestrator calls `devbench-wait <session_id>` which blocks until the
child goes idle. The agent's bash tool invocation simply suspends — zero LLM
tokens consumed during the wait. The script polls internally with `sleep`.

### Server as thin layer

The server's role shrinks to:
1. CRUD for jobs (unchanged)
2. Launching orchestrator sessions (replaces the entire executeJob pipeline)
3. Providing hook endpoints for orchestrators to call via `curl`
4. Providing the wait script for blocking child-session waits

All intelligence (deciding what to do next, interpreting outputs, handling
errors) moves into the orchestrator agent prompt.

## Implementation Plan

### Step 1: Add `orchestrator` session role

**Files:** `shared/types.ts`, `server/db.ts`

- Add `"orchestrator"` to the `JobSessionRole` type union
- Migration v20: `ALTER TABLE orchestration_job_sessions` — update the CHECK
  constraint to include `'orchestrator'`
- Update the base schema CREATE TABLE to include `'orchestrator'` in the CHECK

### Step 2: Create the blocking wait script

**File:** `server/scripts/devbench-wait` (new)

A bash script that:
1. Takes a session ID as argument, optional `--timeout` (default 1800s)
2. Reads `DEVBENCH_PORT` from environment
3. Polls `GET /api/orch/hooks/child-status?session_id=N` every 10 seconds
4. Waits until agent has been seen as `working` then transitions to `waiting`
   (same 3-consecutive-idle logic as current engine, but in bash)
5. On completion, fetches and prints the child's last 100 lines via
   `GET /api/orch/hooks/child-output?session_id=N&lines=100`
6. Exits 0 on success, 1 on timeout

The script must be available in the orchestrator's PATH. Options:
- Copy it to a known location during session launch (e.g., `/tmp/devbench-wait-<port>`)
- Or place it in the project dir and reference it absolutely

```bash
#!/bin/bash
# devbench-wait — block until a child agent session finishes
# Usage: devbench-wait <session_id> [--timeout <seconds>]
#
# Polls the devbench orchestration hook API. Blocks until the child
# session's agent goes idle. Returns the child's terminal output on stdout.
# Exit 0 = child finished, exit 1 = timeout.

set -euo pipefail

SESSION_ID="${1:?Usage: devbench-wait <session_id> [--timeout <seconds>]}"
TIMEOUT=1800
if [ "${2:-}" = "--timeout" ] && [ -n "${3:-}" ]; then
  TIMEOUT="$3"
fi

PORT="${DEVBENCH_PORT:-3001}"
BASE="http://localhost:$PORT/api/orch/hooks"
STARTED=$(date +%s)
SAW_WORKING=false
IDLE_COUNT=0
IDLE_THRESHOLD=3

while true; do
  RESP=$(curl -sf "$BASE/child-status?session_id=$SESSION_ID" 2>/dev/null || echo '{}')
  STATUS=$(echo "$RESP" | grep -o '"agentStatus":"[^"]*"' | cut -d'"' -f4)

  if [ "$STATUS" = "working" ]; then
    SAW_WORKING=true
    IDLE_COUNT=0
  elif [ "$STATUS" = "waiting" ] && [ "$SAW_WORKING" = true ]; then
    IDLE_COUNT=$((IDLE_COUNT + 1))
    if [ "$IDLE_COUNT" -ge "$IDLE_THRESHOLD" ]; then
      # Child is done — fetch output
      curl -sf "$BASE/child-output?session_id=$SESSION_ID&lines=100" 2>/dev/null \
        | grep -o '"output":"[^"]*"' | cut -d'"' -f4 \
        | sed 's/\\n/\n/g'
      exit 0
    fi
  fi

  ELAPSED=$(( $(date +%s) - STARTED ))
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    echo "TIMEOUT: child session $SESSION_ID did not finish within ${TIMEOUT}s" >&2
    exit 1
  fi

  sleep 10
done
```

**Note:** The script uses only `curl`, `grep`, `cut`, `sed` — no `jq`
dependency required. The JSON parsing is intentionally simple since the
responses have predictable shapes.

### Step 3: Create orchestration hook endpoints

**File:** `server/routes/orchestration.ts` (extend existing)

New endpoints under `/api/orch/hooks/`, called by orchestrator agents via curl.
All use `DEVBENCH_SESSION_ID` (passed as query param or in body) to identify
the calling orchestrator and look up its linked job.

#### `GET /api/orch/hooks/job?session_id=N`

Returns the orchestrator's own job details. The server looks up which job
the session belongs to via `orchestration_job_sessions`.

Response:
```json
{
  "id": 5,
  "title": "Implement user auth",
  "description": "Add JWT-based authentication...",
  "source_url": "https://linear.app/...",
  "status": "working",
  "agent_type": "claude",
  "max_review_loops": 3,
  "max_test_loops": 3,
  "project_path": "/home/user/project"
}
```

#### `POST /api/orch/hooks/job-status`

Updates the job status. Only the orchestrator should call this.

Body: `{ "sessionId": N, "status": "working"|"testing"|"review"|"waiting_input"|"finished", "error": "optional message" }`

#### `POST /api/orch/hooks/launch-child`

Creates a new devbench session for the job and links it.

Body:
```json
{
  "sessionId": 123,
  "role": "implement",
  "agentType": "claude",
  "prompt": "Implement the feature described below..."
}
```

Response:
```json
{
  "sessionId": 456,
  "tmuxName": "devbench_orch_5_implement_1712345678"
}
```

Implementation:
1. Look up the job via `orchestration_job_sessions` for the calling session
2. Get the project from the job
3. Create a DB session (like `server/routes/sessions.ts` does)
4. Link it to the job via `orchestration_job_sessions` with the given role
5. Launch the tmux session with the prompt
6. Start monitors
7. Return session ID and tmux name

#### `GET /api/orch/hooks/child-status?session_id=N`

Returns the child session's current state.

Response:
```json
{
  "agentStatus": "working"|"waiting"|null,
  "hasChanges": true,
  "notifiedAt": "2026-04-11T...",
  "sessionStatus": "active"|"archived"
}
```

Implementation: read from `agent-status.ts#getStatus()` and `db.getSession()`.

#### `GET /api/orch/hooks/child-output?session_id=N&lines=100`

Returns the child's terminal output via `tmux capture-pane`.

Response:
```json
{
  "output": "last 100 lines of terminal output..."
}
```

Implementation: look up session's tmux_name, call `capturePane()`.

#### `POST /api/orch/hooks/log`

Appends an event to the job event log (shown in the dashboard detail panel).

Body: `{ "sessionId": N, "type": "info"|"phase"|"error", "message": "Starting review phase" }`

### Step 4: Create the orchestrator prompt template

**File:** `server/orchestration-prompt.ts` (new)

A function that takes a job + project and returns the full system prompt /
initial prompt for the orchestrator agent. Template with placeholders filled in.

The prompt teaches the agent:
1. Its role as a job orchestrator
2. The specific job details (title, description, source URL)
3. The API reference (curl commands for each hook endpoint)
4. The `devbench-wait` script usage
5. The workflow (implement → review → test → commit)
6. Decision-making rules (when to retry, when to escalate, loop limits)
7. How to interact with the user if needed

```markdown
# Job Orchestrator

You are managing a single coding job for devbench. Your role is to
coordinate implementation, code review, and testing by launching child
agent sessions and monitoring their progress.

## Your Job

- **Title:** {{TITLE}}
- **Description:** {{DESCRIPTION}}
- **Source:** {{SOURCE_URL}}
- **Project path:** {{PROJECT_PATH}}

## Environment

- `$DEVBENCH_PORT` — devbench server port (already set)
- `$DEVBENCH_SESSION_ID` — your session ID (already set)
- The devbench-wait script is at: {{WAIT_SCRIPT_PATH}}

## API Reference

All calls use curl to localhost:$DEVBENCH_PORT.

### Update job status
```bash
curl -sX POST http://localhost:$DEVBENCH_PORT/api/orch/hooks/job-status \
  -H 'Content-Type: application/json' \
  -d '{"sessionId": '$DEVBENCH_SESSION_ID', "status": "working"}'
```

### Launch a child session
```bash
curl -sX POST http://localhost:$DEVBENCH_PORT/api/orch/hooks/launch-child \
  -H 'Content-Type: application/json' \
  -d '{"sessionId": '$DEVBENCH_SESSION_ID', "role": "implement", "agentType": "claude", "prompt": "..."}'
```
Returns JSON with `sessionId` and `tmuxName`.

### Wait for a child session to finish (BLOCKING — use this)
```bash
{{WAIT_SCRIPT_PATH}} <child_session_id>
```
Blocks until the child agent finishes. Prints the child's last 100 lines
of terminal output. Exit code 0 = finished, 1 = timeout.

### Check child status (non-blocking, usually unnecessary)
```bash
curl -s "http://localhost:$DEVBENCH_PORT/api/orch/hooks/child-status?session_id=N"
```

### Read child terminal output
```bash
curl -s "http://localhost:$DEVBENCH_PORT/api/orch/hooks/child-output?session_id=N&lines=100"
```

### Log an event (shown in dashboard)
```bash
curl -sX POST http://localhost:$DEVBENCH_PORT/api/orch/hooks/log \
  -H 'Content-Type: application/json' \
  -d '{"sessionId": '$DEVBENCH_SESSION_ID', "type": "info", "message": "Starting implementation"}'
```

## Workflow

Follow this workflow for the job:

1. **Set status to working**
2. **Implementation phase:**
   - Launch an implementation child with the task description as prompt
   - Wait for it to finish using devbench-wait
   - Read the output and evaluate if the implementation looks successful
   - If it failed, you may retry with a modified prompt (max 2 retries)
3. **Code review phase:**
   - Launch a review child asking it to review and fix any issues
   - The review prompt should include the original task description
   - Wait for it to finish
   - Check if it made changes (child-status hasChanges field)
   - If changes were made, loop (max {{MAX_REVIEW_LOOPS}} times)
4. **Testing phase:**
   - Set status to "testing"
   - Launch a test child asking it to run tests and fix failures
   - Wait for it to finish
   - If it made changes, loop (max {{MAX_TEST_LOOPS}} times)
5. **Commit & push phase:**
   - Launch an implementation child with the prompt: "/git-commit-and-push"
     followed by a suggested branch name and commit message
   - Wait for it to finish
6. **Set status to "review"** — the user will approve or reject

## Important Rules

- Do NOT commit or push code yourself — always use a child session for that
- Do NOT modify code yourself — you are a coordinator, not a coder
- Each child session is its own independent agent with full coding tools
- Tell each child NOT to commit/push (except the final commit child)
- If something is unclear or you're stuck, set status to "waiting_input"
  with an error message and explain what you need — the user will reply
  in this terminal
- Log important events so the user can track progress in the dashboard
- Max {{MAX_REVIEW_LOOPS}} review loops, max {{MAX_TEST_LOOPS}} test loops
- If a child times out, log the error and move to "waiting_input"
```

### Step 5: Rewrite `server/orchestration.ts`

**File:** `server/orchestration.ts` (rewrite)

Remove the entire `executeJob` function and all its helpers
(`waitForAgentCompletion`, `launchAgentSession`, prompt builders, etc.).

The new engine is much simpler:

```typescript
// State
let running = false;
let currentJobId: number | null = null;

// start() — scan for todo jobs, launch orchestrator sessions
export function start(): void {
  if (running) return;
  running = true;
  broadcastState();
  launchNextOrchestrator();
}

// startJob(id) — launch a single orchestrator session for this job
export function startJob(jobId: number): void {
  const job = db.getJob(jobId);
  if (!job) return;
  if (job.status !== "todo" && job.status !== "waiting_input") return;
  
  // Reset to todo
  db.updateJobStatus(jobId, "todo");
  db.updateJobError(jobId, null);
  
  if (!running) { running = true; broadcastState(); }
  launchOrchestratorSession(job);
}

// stop() — stop launching new orchestrators
// Existing orchestrator sessions keep running (they're just tmux sessions)
export function stop(): void {
  if (!running) return;
  running = false;
  broadcastState();
}

// Core: launch an orchestrator agent session for a job
async function launchOrchestratorSession(job: OrchestrationJob): Promise<void> {
  const project = db.getProject(job.project_id);
  if (!project) { transitionJob(job.id, "rejected", "Project not found"); return; }
  
  // Build the orchestrator prompt
  const prompt = buildOrchestratorPrompt(job, project);
  
  // Write devbench-wait script to temp location
  const waitScriptPath = writeWaitScript();
  
  // Create a devbench session for the orchestrator
  const sessionName = `orch-${job.id}-${slugify(job.title)}`;
  const tmuxName = `devbench_orch_${job.id}_${Date.now()}`;
  const agentType = job.agent_type as SessionType;
  
  const session = db.addSession(job.project_id, sessionName, agentType, tmuxName, job.source_url, null);
  db.addJobSession(job.id, session.id, "orchestrator");
  
  // Launch tmux with the prompt
  const result = await terminal.createTmuxSession(tmuxName, project.path, agentType, prompt, session.id);
  if (result.agentSessionId) {
    db.updateSessionAgentId(session.id, result.agentSessionId);
  }
  monitors.startSessionMonitors(session.id, tmuxName, sessionName, agentType, []);
  
  // Transition job to working
  transitionJob(job.id, "working");
  logJobEvent(job.id, "session", `Launched orchestrator session #${session.id}`);
  
  // Schedule launching the next job's orchestrator (if running sequentially)
  // For now: sequential. Later: parallel.
  // We don't wait for this orchestrator to finish — it manages itself.
  // The engine just monitors the overall state.
}

// Check if we should launch more orchestrators
function launchNextOrchestrator(): void {
  if (!running) return;
  
  // For sequential mode: only launch if no job is currently active
  const activeJobs = db.getAllJobs().filter(j => 
    j.status === "working" || j.status === "testing"
  );
  if (activeJobs.length > 0) return;
  
  const next = db.getNextTodoJob();
  if (!next) {
    console.log("[orchestration] No more jobs, stopping");
    stop();
    return;
  }
  
  launchOrchestratorSession(next);
}
```

The `transitionJob` function, job event log functions, and broadcast functions
stay the same.

The prompt builder functions (`buildImplementPrompt`, `buildReviewPrompt`,
`buildTestPrompt`, `buildCommitPrompt`) are **deleted** from the server —
the orchestrator agent writes prompts for its children dynamically.

### Step 6: Wire up the lifecycle

**When does the next job start?**

The server needs to detect when an orchestrator finishes (job moved to
`review`, `finished`, `waiting_input`, or `rejected`). Two options:

**Option A: Job status hook triggers next launch.** When the orchestrator
calls `POST /api/orch/hooks/job-status` with a terminal status, the server
calls `launchNextOrchestrator()`. Simple and reliable.

**Option B: Monitor the orchestrator session.** When the orchestrator agent
goes idle, check if the job transitioned. More fragile.

**Go with Option A.** In the `job-status` hook handler:
```typescript
// After updating status:
if (["review", "finished", "waiting_input", "rejected"].includes(newStatus)) {
  // This job is done (or paused), try launching the next one
  scheduleNextOrchestrator();
}
```

### Step 7: Install the wait script into the orchestrator's environment

When launching the orchestrator session, the wait script needs to be
accessible. Options:

1. **Write to `/tmp/devbench-wait-<port>.sh`** at engine start, reference
   it in the prompt.
2. **Write it into the project directory** as `.devbench/wait.sh` (gitignored).
3. **Embed it in the prompt** and tell the agent to create it.

**Go with option 1.** The script is written once when the orchestration engine
starts, and the path is baked into the orchestrator prompt. Cleanup on stop.

### Step 8: Update dashboard UI

**File:** `client/src/components/OrchestrationDashboard.tsx`

Minimal changes:
- Session links now show role badges: "orchestrator", "implement", "review", "test"
- The orchestrator session link is prominent (it's the "main" session for the job)
- Clicking "orchestrator" navigates to that tmux session where the user can
  watch the agent coordinate or type to provide input

### Step 9: Update documentation

**File:** `lat.md/orchestration.md`

Rewrite the Engine section to describe the new agent-based architecture.
Update Data Model to include `orchestrator` role. Update API Routes for the
new hook endpoints.

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `shared/types.ts` | Edit | Add `"orchestrator"` to `JobSessionRole` |
| `server/db.ts` | Edit | Migration v20 for CHECK constraint; update base schema |
| `server/orchestration.ts` | Rewrite | Replace executeJob pipeline with launchOrchestratorSession |
| `server/orchestration-prompt.ts` | New | Orchestrator prompt template builder |
| `server/scripts/devbench-wait` | New | Blocking wait script (bash) |
| `server/routes/orchestration.ts` | Edit | Add `/api/orch/hooks/*` endpoints; keep existing CRUD |
| `client/src/components/OrchestrationDashboard.tsx` | Edit | Show orchestrator session badge; minor UI tweaks |
| `lat.md/orchestration.md` | Rewrite | Document new architecture |

## What Gets Deleted

From `server/orchestration.ts`:
- `executeJob()` — the entire multi-phase pipeline
- `waitForAgentCompletion()` — replaced by devbench-wait script
- `launchAgentSession()` — replaced by `/api/orch/hooks/launch-child`
- `buildImplementPrompt()` — agent writes its own child prompts
- `buildReviewPrompt()` — same
- `buildTestPrompt()` — same
- `buildCommitPrompt()` — same
- `AbortController` / cancellation logic — orchestrators are just sessions

## What Stays the Same

- **Job CRUD** — all existing API routes for creating, listing, updating, deleting jobs
- **Dashboard UI** — kanban board, detail panel, event log (mostly unchanged)
- **Close Job** — merge MRs, mark issues done, archive sessions
- **Job event log** — events now come from orchestrator via hook instead of server-side
- **Database schema** — jobs and job_sessions tables unchanged (except role constraint)
- **Session infrastructure** — tmux, hooks, monitors all reused as-is

## Communication Flow

```
User clicks "Start Job"
  → Server: POST /api/orchestration/jobs/:id/start
  → Server: creates orchestrator session (Claude/Pi in tmux)
  → Server: passes job prompt via initial prompt injection
  
Orchestrator agent boots up, reads its prompt
  → Agent: curl POST /api/orch/hooks/job-status {"status": "working"}
  → Agent: curl POST /api/orch/hooks/log {"message": "Starting implementation"}
  → Agent: curl POST /api/orch/hooks/launch-child {"role": "implement", "prompt": "..."}
  → Server: creates child session, returns {sessionId, tmuxName}
  → Agent: devbench-wait <sessionId>    ← BLOCKS, zero tokens
  
Child agent works for 20 minutes...
  → Hooks: working, changes, idle events flow to devbench
  → devbench-wait polls child-status internally
  
Child goes idle
  → devbench-wait exits, prints child output
  → Orchestrator agent resumes, reads output
  → Agent: curl POST /api/orch/hooks/log {"message": "Implementation complete"}
  → Agent: curl POST /api/orch/hooks/launch-child {"role": "review", "prompt": "..."}
  → Agent: devbench-wait <sessionId>    ← BLOCKS again
  
... review finishes, test phase, commit phase ...

  → Agent: curl POST /api/orch/hooks/job-status {"status": "review"}
  → Server: job moves to review column in kanban
  → Server: launches next todo job's orchestrator (if any)
  
User reviews in dashboard, clicks "Approve"
  → Job moves to "finished"
```

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Orchestrator prompt is too complex | Iterate. Start simple (implement + commit), add review/test later |
| Agent ignores instructions, tries to code directly | Strong system prompt; orchestrator has no write/edit tools? Actually it does (it's a normal agent), but the prompt tells it not to. Acceptable risk. |
| devbench-wait script parsing breaks | Use simple, predictable JSON shapes; add error handling |
| Bash tool timeout kills devbench-wait | Claude Code: default timeout is configurable. Pi: no default timeout. If needed, the script can be run with `nohup` or in a subshell. |
| Multiple orchestrators competing for resources | Sequential for now (one active job at a time). Parallel later with resource limits. |
| Orchestrator crashes mid-job | Session persists in tmux; user can resume. Job stays in current status. |
| Child session never finishes | devbench-wait has a timeout (default 30 min); orchestrator handles the timeout exit code |

## Future Enhancements (Not in This Refactoring)

- **Long-poll endpoint** instead of script: `GET /api/orch/hooks/wait-child`
  that holds HTTP connection until child is done (truly event-driven, no sleep)
- **Parallel jobs**: launch multiple orchestrators simultaneously
- **Orchestrator resume**: if an orchestrator crashes, resume it with context
- **Tool restrictions**: launch orchestrator with `--tools "Bash,Read"` to
  prevent it from coding directly (only coordinate via bash/curl)
- **Model selection per role**: orchestrator on cheap/fast model, child
  implement on powerful model
