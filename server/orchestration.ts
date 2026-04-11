// @lat: [[orchestration#Engine]]
/**
 * Orchestration engine — manages autonomous job execution.
 *
 * Picks jobs from the backlog, launches agent sessions for implementation,
 * code review, and testing, and progresses through the workflow until
 * each job is done, rejected, or waiting for user input.
 */

import * as db from "./db.ts";
import * as terminal from "./terminal.ts";
import * as monitors from "./monitor-manager.ts";
import * as agentStatus from "./agent-status.ts";
import { broadcast } from "./events.ts";
import { fetchIssue, promptFromIssue } from "./linear.ts";
import { capturePane } from "./tmux-utils.ts";
import { detectSourceType } from "@devbench/shared";
import type { OrchestrationJob, OrchestrationState, JobStatus, JobSessionRole, SessionType } from "@devbench/shared";

// ── State ───────────────────────────────────────────────────────────

let running = false;
let currentJobId: number | null = null;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
/** Abort controller for the currently executing job — allows cancellation. */
let currentAbort: AbortController | null = null;

const ACTIVE_STATUSES: Set<string> = new Set(["working", "testing", "review"]);

/** Get the current orchestration engine state. */
export function getState(): OrchestrationState {
  const activeJobCount = db.getAllJobs().filter((j) => ACTIVE_STATUSES.has(j.status)).length;
  return { running, currentJobId, activeJobCount };
}

// ── Job event log ───────────────────────────────────────────────────

export interface JobEvent {
  timestamp: string;
  type: "info" | "phase" | "error" | "session" | "output";
  message: string;
}

/** In-memory log of events per job (persists until server restart). */
const jobEvents = new Map<number, JobEvent[]>();

function logJobEvent(jobId: number, type: JobEvent["type"], message: string): void {
  if (!jobEvents.has(jobId)) jobEvents.set(jobId, []);
  const event: JobEvent = { timestamp: new Date().toISOString(), type, message };
  jobEvents.get(jobId)!.push(event);
  // Keep last 200 events per job
  const events = jobEvents.get(jobId)!;
  if (events.length > 200) events.splice(0, events.length - 200);
  console.log(`[orchestration] Job ${jobId}: ${message}`);
}

export function getJobEvents(jobId: number): JobEvent[] {
  return jobEvents.get(jobId) ?? [];
}

// ── Event broadcasting ──────────────────────────────────────────────

function broadcastState(): void {
  broadcast({ type: "orchestration-state", ...getState() });
}

function broadcastJobUpdate(job: OrchestrationJob): void {
  broadcast({ type: "orchestration-job-update", job });
}

// ── Job status transitions ──────────────────────────────────────────

export function transitionJob(jobId: number, newStatus: JobStatus, error?: string | null): OrchestrationJob | null {
  db.updateJobStatus(jobId, newStatus);
  if (error !== undefined) {
    db.updateJobError(jobId, error);
  }
  const job = db.getJob(jobId);
  if (job) {
    broadcastJobUpdate(job);
    logJobEvent(jobId, "info", `Status → ${newStatus}${error ? `: ${error}` : ""}`);
  }
  return job;
}

// ── Core loop ───────────────────────────────────────────────────────

/** Start the orchestration loop. Picks todo jobs and processes them sequentially. */
export function start(): void {
  if (running) return;
  running = true;
  broadcastState();
  console.log("[orchestration] Started");
  scheduleNext();
}

/** Stop the orchestration loop. Current job keeps its status but wait is cancelled. */
export function stop(): void {
  if (!running) return;
  running = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  // Cancel any pending agent wait
  if (currentAbort) {
    currentAbort.abort();
    currentAbort = null;
  }
  currentJobId = null;
  broadcastState();
  console.log("[orchestration] Stopped");
}

function scheduleNext(): void {
  if (!running) return;
  // Small delay to avoid tight loops
  loopTimer = setTimeout(() => processNext(), 1000);
}

async function processNext(): Promise<void> {
  if (!running) return;

  const job = db.getNextTodoJob();
  if (!job) {
    console.log("[orchestration] No more jobs in backlog, stopping");
    stop();
    return;
  }

  currentJobId = job.id;
  currentAbort = new AbortController();
  broadcastState();

  try {
    await executeJob(job, currentAbort.signal);
  } catch (err: any) {
    if (err.name === "AbortError") {
      logJobEvent(job.id, "info", "Job execution cancelled");
    } else {
      console.error(`[orchestration] Job ${job.id} failed:`, err.message);
      transitionJob(job.id, "waiting_input", `Error: ${err.message}`);
    }
  }

  currentAbort = null;
  currentJobId = null;
  broadcastState();
  scheduleNext();
}

// ── Job execution ───────────────────────────────────────────────────

async function executeJob(job: OrchestrationJob, signal: AbortSignal): Promise<void> {
  logJobEvent(job.id, "info", `Starting job: ${job.title}`);

  // Transition to working
  transitionJob(job.id, "working");

  // Get the project
  const project = db.getProject(job.project_id);
  if (!project) {
    transitionJob(job.id, "rejected", "Project not found");
    return;
  }

  // Build the implementation prompt
  let prompt = job.description || job.title;

  // If there's a source URL (e.g. Linear issue), try to fetch and build a richer prompt
  if (job.source_url) {
    const sourceType = detectSourceType(job.source_url);
    if (sourceType === "linear") {
      try {
        const token = db.getSetting("linear_token");
        if (token) {
          const issue = await fetchIssue(job.source_url, token);
          if (issue) {
            prompt = promptFromIssue(issue);
            logJobEvent(job.id, "info", `Fetched Linear issue: ${issue.identifier} — ${issue.title}`);
          }
        }
      } catch (err: any) {
        logJobEvent(job.id, "error", `Failed to fetch Linear issue: ${err.message}`);
      }
    }
    // For non-Linear source URLs, append the URL to the prompt
    if (!prompt.includes(job.source_url)) {
      prompt += `\n\nReference: ${job.source_url}`;
    }
  }

  // ── Phase 1: Implementation ───────────────────────────────────
  logJobEvent(job.id, "phase", "Phase 1: Implementation");

  const implPrompt = buildImplementPrompt(prompt);
  const implSession = await launchAgentSession(
    job, project.path, job.agent_type as SessionType, implPrompt, "implement", signal,
  );
  if (!implSession) {
    transitionJob(job.id, "waiting_input", "Failed to launch implementation session");
    return;
  }

  const implResult = await waitForAgentCompletion(implSession.id, implSession.tmuxName, signal, 30 * 60 * 1000);
  if (implResult === "timeout") {
    logJobEvent(job.id, "error", "Implementation timed out after 30 minutes");
    transitionJob(job.id, "waiting_input", "Implementation timed out");
    return;
  }
  if (implResult === "cancelled") return;

  // Capture implementation output summary
  const implOutput = capturePane(implSession.tmuxName, 100);
  logJobEvent(job.id, "output", `Implementation finished. Output tail: ${implOutput.slice(-500)}`);

  // ── Phase 2: Code Review ──────────────────────────────────────
  const reviewAgentType = job.review_agent_type || job.agent_type;
  let reviewIssuesFound = false;

  for (let reviewLoop = 0; reviewLoop < job.max_review_loops; reviewLoop++) {
    logJobEvent(job.id, "phase", `Phase 2: Code Review (loop ${reviewLoop + 1}/${job.max_review_loops})`);
    db.updateJobLoop(job.id, reviewLoop + 1);

    const reviewPrompt = buildReviewPrompt(prompt);
    const reviewSession = await launchAgentSession(
      job, project.path, reviewAgentType as SessionType, reviewPrompt, "review", signal,
    );
    if (!reviewSession) {
      logJobEvent(job.id, "error", "Failed to launch review session");
      break;
    }

    // Show review status
    transitionJob(job.id, "review");

    const reviewResult = await waitForAgentCompletion(reviewSession.id, reviewSession.tmuxName, signal, 15 * 60 * 1000);
    if (reviewResult === "timeout") {
      logJobEvent(job.id, "error", "Code review timed out");
      transitionJob(job.id, "waiting_input", "Code review timed out");
      return;
    }
    if (reviewResult === "cancelled") return;

    // Capture review output and check for issues
    const reviewOutput = capturePane(reviewSession.tmuxName, 100);
    logJobEvent(job.id, "output", `Review finished. Output tail: ${reviewOutput.slice(-500)}`);

    // Check if the reviewer made commits (indicating issues were found and fixed)
    const reviewHasChanges = db.getSession(reviewSession.id)?.has_changes;
    if (reviewHasChanges) {
      logJobEvent(job.id, "info", "Reviewer made changes — another review pass may be needed");
      reviewIssuesFound = true;
      // Continue loop for another review pass on the reviewer's fixes
    } else {
      logJobEvent(job.id, "info", "Review completed with no changes — code looks good");
      reviewIssuesFound = false;
      break;
    }
  }

  // ── Phase 3: Testing ──────────────────────────────────────────
  const testAgentType = job.test_agent_type || job.agent_type;
  transitionJob(job.id, "testing");

  for (let testLoop = 0; testLoop < job.max_test_loops; testLoop++) {
    logJobEvent(job.id, "phase", `Phase 3: Testing (loop ${testLoop + 1}/${job.max_test_loops})`);

    const testPrompt = buildTestPrompt(prompt);
    const testSession = await launchAgentSession(
      job, project.path, testAgentType as SessionType, testPrompt, "test", signal,
    );
    if (!testSession) {
      logJobEvent(job.id, "error", "Failed to launch test session");
      break;
    }

    const testResult = await waitForAgentCompletion(testSession.id, testSession.tmuxName, signal, 15 * 60 * 1000);
    if (testResult === "timeout") {
      logJobEvent(job.id, "error", "Testing timed out");
      transitionJob(job.id, "waiting_input", "Testing timed out");
      return;
    }
    if (testResult === "cancelled") return;

    // Capture test output
    const testOutput = capturePane(testSession.tmuxName, 100);
    logJobEvent(job.id, "output", `Testing finished. Output tail: ${testOutput.slice(-500)}`);

    // Check if the tester made fixes (indicating test failures)
    const testHasChanges = db.getSession(testSession.id)?.has_changes;
    if (testHasChanges) {
      logJobEvent(job.id, "info", "Tester made fixes — another test loop may be needed");
      // Continue for another test pass
    } else {
      logJobEvent(job.id, "info", "All tests passed with no changes needed");
      break;
    }
  }

  // All phases complete — move to review (manual review step)
  transitionJob(job.id, "review");
  logJobEvent(job.id, "phase", "All phases complete — ready for manual review");
}

// ── Agent session management ────────────────────────────────────────

async function launchAgentSession(
  job: OrchestrationJob,
  cwd: string,
  agentType: SessionType,
  prompt: string,
  role: JobSessionRole,
  signal: AbortSignal,
): Promise<{ id: number; tmuxName: string } | null> {
  if (signal.aborted) return null;

  const roleSuffix = role === "implement" ? "" : `-${role}`;
  const sessionName = `orch-${job.id}-${job.title.slice(0, 30)}${roleSuffix}`.replace(/[^a-zA-Z0-9_-]/g, "-");
  const tmuxName = `devbench_orch_${job.id}_${role}_${Date.now()}`;

  try {
    // Create DB session
    const session = db.addSession(
      job.project_id, sessionName, agentType, tmuxName, job.source_url, null
    );

    // Link session to job
    db.addJobSession(job.id, session.id, role);
    logJobEvent(job.id, "session", `Launched ${role} session #${session.id} (${agentType})`);

    // Launch tmux session with prompt
    const result = await terminal.createTmuxSession(
      tmuxName, cwd, agentType, prompt, session.id
    );
    if (result.agentSessionId) {
      db.updateSessionAgentId(session.id, result.agentSessionId);
    }

    // Start monitors
    monitors.startSessionMonitors(session.id, tmuxName, sessionName, agentType, []);

    return { id: session.id, tmuxName };
  } catch (err: any) {
    logJobEvent(job.id, "error", `Failed to launch ${role} session: ${err.message}`);
    return null;
  }
}

// ── Wait for agent completion ───────────────────────────────────────

type CompletionResult = "done" | "timeout" | "cancelled";

/**
 * Wait for an agent session to go idle (working → waiting transition).
 *
 * Uses the existing agent-status monitoring system. Polls the agent status
 * every 3 seconds rather than relying solely on notified_at, which can be
 * affected by UI interactions.
 */
function waitForAgentCompletion(
  sessionId: number,
  tmuxName: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<CompletionResult> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve("cancelled"); return; }

    const startTime = Date.now();
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    // Track whether we've seen "working" at least once — don't report
    // idle if the agent hasn't even started yet.
    let sawWorking = false;
    // Count consecutive idle polls (agent may briefly show "waiting" during startup)
    let idleCount = 0;
    const IDLE_THRESHOLD = 3; // ~15 seconds of consistent idle after working

    const cleanup = () => {
      settled = true;
      if (pollTimer) clearTimeout(pollTimer);
      signal.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      if (!settled) {
        cleanup();
        resolve("cancelled");
      }
    };
    signal.addEventListener("abort", onAbort);

    const check = () => {
      if (settled) return;

      // Check if the session still exists / was archived
      const session = db.getSession(sessionId);
      if (!session || session.status === "archived") {
        cleanup();
        resolve("done");
        return;
      }

      // Check agent status from the monitoring system
      const status = agentStatus.getStatus(sessionId);

      if (status === "working") {
        sawWorking = true;
        idleCount = 0;
      } else if (status === "waiting" && sawWorking) {
        idleCount++;
        if (idleCount >= IDLE_THRESHOLD) {
          // Agent has been consistently idle — consider it done
          // Clear any notification since orchestrator handles it
          db.clearSessionNotified(sessionId);
          cleanup();
          resolve("done");
          return;
        }
      }

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        cleanup();
        resolve("timeout");
        return;
      }

      // Poll every 5 seconds
      pollTimer = setTimeout(check, 5000);
    };

    // Start checking after an initial delay (let the agent boot)
    pollTimer = setTimeout(check, 15000);
  });
}

// ── Prompt builders ─────────────────────────────────────────────────

function buildImplementPrompt(taskDescription: string): string {
  return [
    taskDescription,
    ``,
    `Important instructions:`,
    `- Implement the feature/fix described above completely`,
    `- Follow existing code patterns and conventions in the repository`,
    `- Write clean, well-documented code`,
    `- After implementation, run any existing tests to verify nothing is broken`,
    `- When done, commit your changes with a descriptive commit message and push to the remote repository`,
    `- If you encounter issues that block you from completing the task, explain what's blocking you`,
  ].join("\n");
}

function buildReviewPrompt(originalPrompt: string): string {
  return [
    `Code Review Task`,
    ``,
    `Review the recent code changes in this repository. The changes were made to implement the following:`,
    ``,
    `---`,
    originalPrompt,
    `---`,
    ``,
    `Please review the code for:`,
    `1. Correctness — Does the implementation match the requirements?`,
    `2. Code quality — Clean code, proper naming, no duplication`,
    `3. Error handling — Are edge cases covered?`,
    `4. Security — Any security concerns?`,
    `5. Performance — Any performance issues?`,
    ``,
    `If you find issues, fix them directly. After making fixes, commit and push your changes.`,
    `If the code looks good and needs no changes, just confirm it's ready.`,
    `Do NOT make unnecessary style-only changes.`,
  ].join("\n");
}

function buildTestPrompt(originalPrompt: string): string {
  return [
    `Testing Task`,
    ``,
    `Test the recent implementation in this repository. The changes were made to implement the following:`,
    ``,
    `---`,
    originalPrompt,
    `---`,
    ``,
    `Please:`,
    `1. Run the existing test suite and verify all tests pass`,
    `2. If tests fail, investigate and fix the issues`,
    `3. Write additional tests if the implementation lacks coverage`,
    `4. Verify the feature works as described in the requirements`,
    ``,
    `After fixing any issues or adding tests, commit and push your changes.`,
    `Report your findings clearly.`,
  ].join("\n");
}
