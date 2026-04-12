// @lat: [[orchestration#Engine]]
/**
 * Orchestration engine — manages autonomous job execution via orchestrator agents.
 *
 * Each job gets its own orchestrator agent session (Claude/Pi in tmux) whose
 * sole responsibility is to manage that job's lifecycle by launching child
 * sessions, waiting for them, evaluating results, and progressing through
 * the workflow.
 *
 * The server is a thin layer: CRUD for jobs, launching orchestrator sessions,
 * and providing hook endpoints that orchestrator agents call via curl.
 */

import * as db from "./db.ts";
import * as terminal from "./terminal.ts";
import * as monitors from "./monitor-manager.ts";
import { broadcast } from "./events.ts";
import { buildOrchestratorPrompt } from "./orchestration-prompt.ts";
import { detectSourceType } from "@devbench/shared";
import * as linear from "./linear.ts";
import * as jira from "./jira.ts";
import * as slack from "./slack.ts";
import type { OrchestrationJob, OrchestrationState, JobStatus, JobEventType, JobEvent, SessionType } from "@devbench/shared";
import { writeFileSync, unlinkSync, existsSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── State ───────────────────────────────────────────────────────────

let running = false;

const ACTIVE_STATUSES: Set<string> = new Set(["working", "testing"]);
const TERMINAL_STATUSES: Set<string> = new Set(["review", "finished", "waiting_input", "rejected"]);

/** Path to the installed devbench-wait script. */
let waitScriptPath: string | null = null;

/** Get the current orchestration engine state. */
export function getState(): OrchestrationState {
  const activeJobCount = db.getAllJobs().filter((j) => ACTIVE_STATUSES.has(j.status)).length;
  return { running, currentJobId: null, activeJobCount };
}

// ── Job event log ───────────────────────────────────────────────────

export type { JobEvent };

/** Persist a job event to the database. */
export function logJobEvent(jobId: number, type: JobEventType, message: string): void {
  db.addJobEvent(jobId, type, message);
  console.log(`[orchestration] Job ${jobId}: ${message}`);
}

/** Retrieve all events for a job from the database. */
export function getJobEvents(jobId: number): JobEvent[] {
  return db.getJobEvents(jobId);
}

/** Retrieve events after a given event ID (for incremental polling). */
export function getJobEventsAfter(jobId: number, afterId: number): JobEvent[] {
  return db.getJobEventsAfter(jobId, afterId);
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

// ── Wait script management ──────────────────────────────────────────

function installWaitScript(): string {
  if (waitScriptPath && existsSync(waitScriptPath)) return waitScriptPath;

  const srcPath = join(__dirname, "scripts", "devbench-wait");
  const dstPath = `/tmp/devbench-wait-${process.env.PORT || 3001}.sh`;

  try {
    const src = require("fs").readFileSync(srcPath, "utf-8");
    writeFileSync(dstPath, src, { mode: 0o755 });
    chmodSync(dstPath, 0o755);
    waitScriptPath = dstPath;
    console.log(`[orchestration] Wait script installed at ${dstPath}`);
    return dstPath;
  } catch (err: any) {
    console.error(`[orchestration] Failed to install wait script: ${err.message}`);
    // Fallback: use the source path directly
    waitScriptPath = srcPath;
    return srcPath;
  }
}

function cleanupWaitScript(): void {
  if (waitScriptPath && waitScriptPath.startsWith("/tmp/")) {
    try {
      unlinkSync(waitScriptPath);
    } catch { /* ignore */ }
  }
  waitScriptPath = null;
}

// ── Core engine ─────────────────────────────────────────────────────

/** Start the orchestration engine. Scans for todo jobs and launches orchestrators. */
export function start(): void {
  if (running) return;
  running = true;
  installWaitScript();
  broadcastState();
  console.log("[orchestration] Started");
  launchNextOrchestrator();
}

/**
 * Start a specific job immediately. Launches an orchestrator session for it.
 * If the engine isn't running, starts it.
 */
export function startJob(jobId: number): void {
  const job = db.getJob(jobId);
  if (!job) return;

  if (job.status !== "todo" && job.status !== "waiting_input") {
    console.log(`[orchestration] Job ${jobId} is in status '${job.status}', cannot start`);
    return;
  }

  // Reset to todo
  if (job.status !== "todo") {
    db.updateJobStatus(jobId, "todo");
    db.updateJobError(jobId, null);
  }

  if (!running) {
    running = true;
    installWaitScript();
    broadcastState();
    console.log("[orchestration] Started (for job", jobId, ")");
  }

  // Launch orchestrator for this specific job
  const freshJob = db.getJob(jobId);
  if (freshJob) {
    launchOrchestratorSession(freshJob).catch((err) => {
      console.error(`[orchestration] Failed to launch orchestrator for job ${jobId}:`, err);
    });
  }
}

/**
 * Stop the orchestration engine. No new orchestrators will be launched.
 * Existing orchestrator sessions keep running (they're just tmux sessions).
 */
export function stop(): void {
  if (!running) return;
  running = false;
  cleanupWaitScript();
  broadcastState();
  console.log("[orchestration] Stopped");
}

/**
 * Called when a job transitions to a terminal status.
 * Tries to launch the next todo job's orchestrator.
 */
export function scheduleNextOrchestrator(): void {
  if (!running) return;
  // Small delay to avoid tight loop
  setTimeout(() => launchNextOrchestrator(), 2000);
}

// ── Orchestrator session launching ──────────────────────────────────

function launchNextOrchestrator(): void {
  if (!running) return;

  // Sequential mode: only launch if no job is currently active
  const activeJobs = db.getAllJobs().filter((j) => ACTIVE_STATUSES.has(j.status));
  if (activeJobs.length > 0) {
    console.log(`[orchestration] ${activeJobs.length} active job(s), not launching another`);
    return;
  }

  const next = db.getNextTodoJob();
  if (!next) {
    console.log("[orchestration] No more jobs in backlog, stopping");
    stop();
    return;
  }

  launchOrchestratorSession(next).catch((err) => {
    console.error(`[orchestration] Failed to launch orchestrator:`, err);
  });
}

async function launchOrchestratorSession(job: OrchestrationJob): Promise<void> {
  const project = db.getProject(job.project_id);
  if (!project) {
    transitionJob(job.id, "rejected", "Project not found");
    return;
  }

  // Fetch source issue content if a source URL is set and no description was provided
  if (job.source_url && !job.description) {
    const fetched = await fetchSourceContent(job.id, job.source_url);
    if (fetched) {
      // Re-read job from DB to pick up updated description/title
      job = db.getJob(job.id) ?? job;
    }
  }

  // Ensure wait script is available
  const scriptPath = installWaitScript();

  // Build the orchestrator prompt
  const prompt = buildOrchestratorPrompt(job, project, scriptPath);

  // Create a devbench session for the orchestrator
  const slug = job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const sessionName = `orch-${job.id}-${slug}`;
  const tmuxName = `devbench_orch_${job.id}_${Date.now()}`;
  const agentType = job.agent_type as SessionType;

  try {
    const session = db.addSession(
      job.project_id, sessionName, agentType, tmuxName, job.source_url, null
    );
    db.addJobSession(job.id, session.id, "orchestrator");

    // Launch tmux session with the prompt
    const result = await terminal.createTmuxSession(
      tmuxName, project.path, agentType, prompt, session.id
    );
    if (result.agentSessionId) {
      db.updateSessionAgentId(session.id, result.agentSessionId);
    }

    // Start monitors
    monitors.startSessionMonitors(session.id, tmuxName, sessionName, agentType, []);
    monitors.handleInitialPrompt(session.id, prompt);

    // Transition job to working
    transitionJob(job.id, "working");
    logJobEvent(job.id, "session", `Launched orchestrator session #${session.id} (${agentType})`);

    console.log(`[orchestration] Launched orchestrator for job ${job.id}, session ${session.id}`);
  } catch (err: any) {
    logJobEvent(job.id, "error", `Failed to launch orchestrator: ${err.message}`);
    transitionJob(job.id, "waiting_input", `Failed to launch orchestrator: ${err.message}`);
  }
}

// ── Child session launching (called from hook endpoint) ─────────────

export async function launchChildSession(
  jobId: number,
  role: "implement" | "review" | "test",
  agentType: string,
  prompt: string,
): Promise<{ sessionId: number; tmuxName: string } | null> {
  const job = db.getJob(jobId);
  if (!job) return null;

  const project = db.getProject(job.project_id);
  if (!project) return null;

  const slug = job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  const sessionName = `orch-${job.id}-${slug}-${role}`;
  const tmuxName = `devbench_orch_${job.id}_${role}_${Date.now()}`;

  try {
    const session = db.addSession(
      job.project_id, sessionName, agentType as SessionType, tmuxName, job.source_url, null
    );
    db.addJobSession(job.id, session.id, role);

    const result = await terminal.createTmuxSession(
      tmuxName, project.path, agentType as SessionType, prompt, session.id
    );
    if (result.agentSessionId) {
      db.updateSessionAgentId(session.id, result.agentSessionId);
    }

    monitors.startSessionMonitors(session.id, tmuxName, sessionName, agentType as SessionType, []);
    monitors.handleInitialPrompt(session.id, prompt);

    logJobEvent(job.id, "session", `Launched ${role} child session #${session.id} (${agentType})`);
    return { sessionId: session.id, tmuxName };
  } catch (err: any) {
    logJobEvent(job.id, "error", `Failed to launch ${role} child: ${err.message}`);
    return null;
  }
}

// ── Source content fetching ─────────────────────────────────────────

/**
 * Fetch issue/message content from a source URL (Linear, JIRA, or Slack)
 * and update the job's description and title in the database.
 * Returns true if content was fetched and stored.
 */
async function fetchSourceContent(jobId: number, sourceUrl: string): Promise<boolean> {
  const sourceType = detectSourceType(sourceUrl);
  if (!sourceType) return false;

  const current = db.getJob(jobId);
  if (!current) return false;

  /** Persist a new title + description while keeping all other job fields. */
  function saveContent(title: string, description: string): void {
    db.updateJob(
      jobId, title, description, sourceUrl,
      current!.agent_type, current!.review_agent_type, current!.test_agent_type,
      current!.max_review_loops, current!.max_test_loops,
    );
  }

  try {
    if (sourceType === "linear") {
      const issue = await linear.fetchIssueFromUrl(sourceUrl);
      if (!issue) {
        logJobEvent(jobId, "error", `Failed to fetch Linear issue from ${sourceUrl}`);
        return false;
      }
      saveContent(issue.identifier + ": " + issue.title, linear.promptFromIssue(issue));
      logJobEvent(jobId, "info", `Fetched Linear issue: ${issue.identifier} — ${issue.title}`);
      // Mark issue "In Progress" (fire-and-forget)
      const identifier = linear.parseLinearIssueId(sourceUrl);
      if (identifier) {
        linear.markIssueInProgress(identifier).catch((e) => {
          console.error(`[orchestration] Failed to mark Linear issue in-progress:`, e);
        });
      }
      return true;
    }

    if (sourceType === "jira") {
      const issue = await jira.fetchIssueFromUrl(sourceUrl);
      if (!issue) {
        logJobEvent(jobId, "error", `Failed to fetch JIRA issue from ${sourceUrl}`);
        return false;
      }
      let description: string;
      try {
        description = await jira.buildPromptWithImages(issue);
      } catch {
        description = jira.promptFromIssue(issue);
      }
      saveContent(issue.key + ": " + issue.title, description);
      logJobEvent(jobId, "info", `Fetched JIRA issue: ${issue.key} — ${issue.title}`);
      // Mark issue "In Progress" (fire-and-forget)
      const issueKey = jira.parseJiraIssueKey(sourceUrl);
      if (issueKey) {
        jira.markIssueInProgress(issueKey, sourceUrl).catch((e) => {
          console.error(`[orchestration] Failed to mark JIRA issue in-progress:`, e);
        });
      }
      return true;
    }

    if (sourceType === "slack") {
      const result = await slack.fetchMessageFromUrl(sourceUrl);
      if (!result) {
        logJobEvent(jobId, "error", `Failed to fetch Slack message from ${sourceUrl}`);
        return false;
      }
      const { message, threadMessages } = result;
      let mediaPaths: string[] | undefined;
      try {
        const allMessages = threadMessages && threadMessages.length > 0
          ? threadMessages : [message];
        mediaPaths = await slack.downloadMessageMedia(allMessages);
      } catch { /* ignore media download errors */ }
      const description = slack.promptFromMessage(message, sourceUrl, threadMessages, mediaPaths);
      const titleHint = message.text.slice(0, 80).replace(/\n/g, " ");
      saveContent(titleHint || current.title, description);
      logJobEvent(jobId, "info", `Fetched Slack message for job`);
      return true;
    }
  } catch (err: any) {
    logJobEvent(jobId, "error", `Failed to fetch source content: ${err.message}`);
    console.error(`[orchestration] Source content fetch failed for job ${jobId}:`, err.message);
  }

  return false;
}
