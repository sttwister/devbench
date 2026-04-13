// @lat: [[orchestration#API Routes]]
/**
 * Orchestration API routes — CRUD for jobs, start/stop orchestration engine,
 * and hook endpoints for orchestrator agents to call via curl.
 */

import type { Router } from "../router.ts";
import { sendJson, readBody } from "../http-utils.ts";
import * as db from "../db.ts";
import * as orchestration from "../orchestration.ts";
import * as mrMerge from "../mr-merge.ts";
import * as linear from "../linear.ts";
import * as jira from "../jira.ts";
import * as cache from "../gitbutler-cache.ts";
import * as gitbutler from "../gitbutler.ts";
import * as monitors from "../monitor-manager.ts";
import * as agentStatus from "../agent-status.ts";
import { detectSourceType } from "@devbench/shared";
import * as terminal from "../terminal.ts";
import { capturePane } from "../tmux-utils.ts";
import type { JobStatus } from "@devbench/shared";

/** Collect all MR URLs and statuses from a job's linked sessions (deduplicated). */
function getJobMrData(jobId: number): { urls: string[]; statuses: Record<string, import("@devbench/shared").MrStatus> } {
  const jobSessions = db.getJobSessionsByJob(jobId);
  const seen = new Set<string>();
  const urls: string[] = [];
  const statuses: Record<string, import("@devbench/shared").MrStatus> = {};
  for (const js of jobSessions) {
    const session = db.getSession(js.session_id);
    if (!session) continue;
    for (const url of session.mr_urls) {
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
    if (session.mr_statuses) {
      for (const [url, status] of Object.entries(session.mr_statuses)) {
        statuses[url] = status;
      }
    }
  }
  return { urls, statuses };
}

/** Enrich a job with its sessions, aggregated MR URLs, and MR statuses. */
function enrichJob(job: ReturnType<typeof db.getJob>) {
  if (!job) return null;
  const mrData = getJobMrData(job.id);
  return {
    ...job,
    sessions: db.getJobSessionsByJob(job.id),
    mr_urls: mrData.urls,
    mr_statuses: mrData.statuses,
  };
}

/** Look up the job linked to a given session ID. */
function getJobForSession(sessionId: number) {
  return db.getJobBySessionId(sessionId);
}

export function registerOrchestrationRoutes(api: Router): void {
  // ════════════════════════════════════════════════════════════════
  // ── Job CRUD (existing, unchanged) ────────────────────────────
  // ════════════════════════════════════════════════════════════════

  // ── List all jobs (optionally by project) ──────────────────────
  api.get("/api/orchestration/jobs", (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const projectId = url.searchParams.get("project_id");
    const jobs = projectId
      ? db.getJobsByProject(parseInt(projectId))
      : db.getAllJobs();

    sendJson(res, jobs.map((job) => enrichJob(job)));
  });

  // ── Get single job with sessions ──────────────────────────────
  api.get("/api/orchestration/jobs/:id", (req, res, { id: idStr }) => {
    const job = db.getJob(parseInt(idStr));
    if (!job) return sendJson(res, { error: "Job not found" }, 404);
    sendJson(res, enrichJob(job));
  });

  // ── Create job ────────────────────────────────────────────────
  api.post("/api/orchestration/jobs", async (req, res) => {
    const body = await readBody(req);
    if (!body.project_id) {
      return sendJson(res, { error: "project_id required" }, 400);
    }
    const sourceUrl = ((body.source_url as string) || "").trim();
    const title = ((body.title as string) || "").trim();
    if (!title && !sourceUrl) {
      return sendJson(res, { error: "title or source_url required" }, 400);
    }

    const project = db.getProject(body.project_id as number);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    const job = db.addJob(
      body.project_id as number,
      title || sourceUrl,
      (body.description as string) || null,
      (body.source_url as string) || null,
      (body.agent_type as string) || "claude",
      (body.review_agent_type as string) || null,
      (body.test_agent_type as string) || null,
      (body.max_review_loops as number) || 3,
      (body.max_test_loops as number) || 3,
    );

    sendJson(res, { ...job, sessions: [] }, 201);
  });

  // ── Update job ────────────────────────────────────────────────
  api.patch("/api/orchestration/jobs/:id", async (req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const job = db.getJob(id);
    if (!job) return sendJson(res, { error: "Job not found" }, 404);

    const body = await readBody(req);

    // Allow status change
    if (body.status) {
      const validStatuses = ["todo", "working", "waiting_input", "review", "finished", "rejected"];
      if (!validStatuses.includes(body.status as string)) {
        return sendJson(res, { error: "Invalid status" }, 400);
      }
      orchestration.transitionJob(id, body.status as JobStatus);
    }

    // Allow field updates
    if ("title" in body || "description" in body || "source_url" in body ||
        "agent_type" in body || "review_agent_type" in body || "test_agent_type" in body ||
        "max_review_loops" in body || "max_test_loops" in body) {
      db.updateJob(
        id,
        (body.title as string) ?? job.title,
        (body.description as string) ?? job.description,
        (body.source_url as string) ?? job.source_url,
        (body.agent_type as string) ?? job.agent_type,
        (body.review_agent_type as string) ?? job.review_agent_type,
        (body.test_agent_type as string) ?? job.test_agent_type,
        (body.max_review_loops as number) ?? job.max_review_loops,
        (body.max_test_loops as number) ?? job.max_test_loops,
      );
    }

    sendJson(res, enrichJob(db.getJob(id)));
  });

  // ── Delete job ────────────────────────────────────────────────
  api.delete("/api/orchestration/jobs/:id", (req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const job = db.getJob(id);
    if (!job) return sendJson(res, { error: "Job not found" }, 404);

    // Don't delete actively running jobs
    if (job.status === "working" || job.status === "review") {
      return sendJson(res, { error: "Cannot delete an active job" }, 400);
    }

    db.removeJob(id);
    sendJson(res, { success: true });
  });

  // ── Close job (merge MRs, mark issues done, archive sessions) ──
  api.post("/api/orchestration/jobs/:id/close", async (req, res, { id: idStr }) => {
    try {
    const id = parseInt(idStr);
    const job = db.getJob(id);
    if (!job) return sendJson(res, { error: "Job not found" }, 404);

    const body = await readBody(req);
    const doPull = body.pull === true;

    const results: {
      mergeResults: mrMerge.MergeResult[];
      linearResult: { identifier: string; newState: string | null } | null;
      jiraResult: { key: string; newState: string | null } | null;
      pullResults: { projectId: number; projectName: string; success: boolean; hasConflicts: boolean; error: string | null }[];
      archived: boolean;
    } = {
      mergeResults: [],
      linearResult: null,
      jiraResult: null,
      pullResults: [],
      archived: false,
    };

    // 1. Merge all open MRs from linked sessions
    const mrUrls = getJobMrData(id).urls;
    if (mrUrls.length > 0) {
      const allStatuses: Record<string, any> = {};
      for (const js of db.getJobSessionsByJob(id)) {
        const session = db.getSession(js.session_id);
        if (session) Object.assign(allStatuses, session.mr_statuses);
      }
      const openUrls = mrUrls.filter((url) => {
        const status = allStatuses[url];
        return !status || (status.state !== "merged" && status.state !== "closed");
      });
      if (openUrls.length > 0) {
        results.mergeResults = await mrMerge.mergeMrs(openUrls);
      }
    }

    // 2. Mark source issue as done
    if (job.source_url) {
      const sourceType = detectSourceType(job.source_url);
      if (sourceType === "linear") {
        const identifier = linear.parseLinearIssueId(job.source_url);
        if (identifier) {
          const newState = await linear.markIssueDone(identifier);
          results.linearResult = { identifier, newState };
        }
      }
      if (sourceType === "jira") {
        const issueKey = jira.parseJiraIssueKey(job.source_url);
        if (issueKey) {
          const newState = await jira.markIssueNeedsTesting(issueKey, job.source_url);
          results.jiraResult = { key: issueKey, newState };
        }
      }
    }

    // 3. Archive all linked sessions
    for (const js of db.getJobSessionsByJob(id)) {
      const session = db.getSession(js.session_id);
      if (session && session.status === "active") {
        monitors.stopSessionMonitors(js.session_id);
        terminal.destroyTmuxSession(session.tmux_name);
        db.archiveSession(js.session_id);
      }
    }
    results.archived = true;

    // 4. Set job to finished
    orchestration.transitionJob(id, "finished");

    // 5. Pull on GitButler (if requested)
    if (doPull) {
      const mergedUrls = new Set(
        results.mergeResults
          .filter((r) => r.outcome === "merged")
          .map((r) => r.url)
      );
      const projectsToPull = new Set<number>();
      if (mergedUrls.size > 0) {
        for (const dash of cache.getAllCachedDashboards()) {
          for (const stack of dash.stacks) {
            for (const branch of stack.branches) {
              if (branch.reviewUrls.some((u: string) => mergedUrls.has(u))) {
                projectsToPull.add(dash.projectId);
              }
            }
          }
        }
      }
      projectsToPull.add(job.project_id);

      for (const pid of projectsToPull) {
        const project = db.getProject(pid);
        if (!project) continue;
        try {
          const pullResult = await gitbutler.doPull(project.path);
          results.pullResults.push({
            projectId: pid,
            projectName: project.name,
            success: true,
            hasConflicts: pullResult.hasConflicts || false,
            error: null,
          });
        } catch (err: any) {
          results.pullResults.push({
            projectId: pid,
            projectName: project.name,
            success: false,
            hasConflicts: false,
            error: err.message,
          });
        }
        cache.triggerRefresh(pid, true);
      }
    }

    sendJson(res, results);
    } catch (e: any) {
      console.error("[orchestration] Close job failed:", e);
      sendJson(res, { error: e.message || "Close job failed" }, 500);
    }
  });

  // ════════════════════════════════════════════════════════════════
  // ── Orchestration engine control ──────────────────────────────
  // ════════════════════════════════════════════════════════════════

  api.get("/api/orchestration/status", (_req, res) => {
    sendJson(res, orchestration.getState());
  });

  api.post("/api/orchestration/start", (_req, res) => {
    orchestration.start();
    sendJson(res, orchestration.getState());
  });

  api.post("/api/orchestration/jobs/:id/start", (_req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const job = db.getJob(id);
    if (!job) return sendJson(res, { error: "Job not found" }, 404);
    if (job.status !== "todo" && job.status !== "waiting_input") {
      return sendJson(res, { error: `Cannot start job in '${job.status}' status` }, 400);
    }
    orchestration.startJob(id);
    sendJson(res, orchestration.getState());
  });

  api.post("/api/orchestration/stop", (_req, res) => {
    orchestration.stop();
    sendJson(res, orchestration.getState());
  });

  // ── Job events log ──────────────────────────────────────────
  api.get("/api/orchestration/jobs/:id/events", (req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const job = db.getJob(id);
    if (!job) return sendJson(res, { error: "Job not found" }, 404);
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const afterId = url.searchParams.get("after_id");
    if (afterId) {
      sendJson(res, orchestration.getJobEventsAfter(id, parseInt(afterId)));
    } else {
      sendJson(res, orchestration.getJobEvents(id));
    }
  });

  // ════════════════════════════════════════════════════════════════
  // ── Orchestration Hook API ────────────────────────────────────
  // ── Called by orchestrator agents via curl ─────────────────────
  // ════════════════════════════════════════════════════════════════

  // ── Get job details for the calling orchestrator ──────────────
  api.get("/api/orch/hooks/job", (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return sendJson(res, { error: "session_id required" }, 400);

    const job = getJobForSession(parseInt(sessionId));
    if (!job) return sendJson(res, { error: "No job found for this session" }, 404);

    const project = db.getProject(job.project_id);
    sendJson(res, {
      id: job.id,
      title: job.title,
      description: job.description,
      source_url: job.source_url,
      status: job.status,
      agent_type: job.agent_type,
      max_review_loops: job.max_review_loops,
      max_test_loops: job.max_test_loops,
      project_path: project?.path ?? null,
    });
  });

  // ── Update job status (called by orchestrator) ────────────────
  api.post("/api/orch/hooks/job-status", async (req, res) => {
    const body = await readBody(req);
    const sessionId = body.sessionId as number;
    const newStatus = body.status as string;
    const error = (body.error as string) || null;

    if (!sessionId || !newStatus) {
      return sendJson(res, { error: "sessionId and status required" }, 400);
    }

    const job = getJobForSession(sessionId);
    if (!job) return sendJson(res, { error: "No job found for this session" }, 404);

    const validStatuses = ["working", "waiting_input", "review", "finished", "rejected"];
    if (!validStatuses.includes(newStatus)) {
      return sendJson(res, { error: `Invalid status: ${newStatus}` }, 400);
    }

    orchestration.transitionJob(job.id, newStatus as JobStatus, error);

    // If this is a terminal status, schedule the next orchestrator
    if (["review", "finished", "waiting_input", "rejected"].includes(newStatus)) {
      orchestration.scheduleNextOrchestrator();
    }

    sendJson(res, { success: true, jobId: job.id, status: newStatus });
  });

  // ── Launch a child session (called by orchestrator) ───────────
  api.post("/api/orch/hooks/launch-child", async (req, res) => {
    const body = await readBody(req);
    const sessionId = body.sessionId as number;
    const role = body.role as string;
    const agentType = (body.agentType as string) || "claude";
    const prompt = body.prompt as string;

    if (!sessionId || !role || !prompt) {
      return sendJson(res, { error: "sessionId, role, and prompt required" }, 400);
    }

    const validRoles = ["implement", "review", "test"];
    if (!validRoles.includes(role)) {
      return sendJson(res, { error: `Invalid role: ${role}. Must be implement, review, or test.` }, 400);
    }

    const job = getJobForSession(sessionId);
    if (!job) return sendJson(res, { error: "No job found for this session" }, 404);

    const result = await orchestration.launchChildSession(
      job.id, role as "implement" | "review" | "test", agentType, prompt
    );
    if (!result) {
      return sendJson(res, { error: "Failed to launch child session" }, 500);
    }

    sendJson(res, { sessionId: result.sessionId, tmuxName: result.tmuxName });
  });

  // ── Check child session status (used by devbench-wait script) ──
  api.get("/api/orch/hooks/child-status", (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return sendJson(res, { error: "session_id required" }, 400);

    const sid = parseInt(sessionId);
    const session = db.getSession(sid);
    if (!session) return sendJson(res, { error: "Session not found" }, 404);

    const status = agentStatus.getStatus(sid);
    sendJson(res, {
      agentStatus: status,
      hasChanges: session.has_changes,
      notifiedAt: session.notified_at,
      sessionStatus: session.status,
    });
  });

  // ── Get child terminal output (used by devbench-wait script) ───
  api.get("/api/orch/hooks/child-output", (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("session_id");
    const lines = parseInt(url.searchParams.get("lines") || "100");
    if (!sessionId) return sendJson(res, { error: "session_id required" }, 400);

    const session = db.getSession(parseInt(sessionId));
    if (!session) return sendJson(res, { error: "Session not found" }, 404);

    const output = capturePane(session.tmux_name, lines);
    sendJson(res, { output });
  });

  // ── Log an event (called by orchestrator) ─────────────────────
  api.post("/api/orch/hooks/log", async (req, res) => {
    const body = await readBody(req);
    const sessionId = body.sessionId as number;
    const type = (body.type as string) || "info";
    const message = body.message as string;

    if (!sessionId || !message) {
      return sendJson(res, { error: "sessionId and message required" }, 400);
    }

    const job = getJobForSession(sessionId);
    if (!job) return sendJson(res, { error: "No job found for this session" }, 404);

    const validTypes = ["info", "phase", "error", "session", "output"];
    const eventType = validTypes.includes(type) ? type : "info";

    orchestration.logJobEvent(job.id, eventType as any, message);
    sendJson(res, { success: true, jobId: job.id });
  });
}
