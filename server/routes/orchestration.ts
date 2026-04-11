// @lat: [[orchestration#API Routes]]
/**
 * Orchestration API routes — CRUD for jobs, start/stop orchestration engine.
 */

import type { Router } from "../router.ts";
import { sendJson, readBody } from "../http-utils.ts";
import * as db from "../db.ts";
import * as orchestration from "../orchestration.ts";

export function registerOrchestrationRoutes(api: Router): void {
  // ── List all jobs (optionally by project) ──────────────────────
  api.get("/api/orchestration/jobs", (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const projectId = url.searchParams.get("project_id");
    const jobs = projectId
      ? db.getJobsByProject(parseInt(projectId))
      : db.getAllJobs();

    // Attach sessions for each job
    const jobsWithSessions = jobs.map((job) => ({
      ...job,
      sessions: db.getJobSessionsByJob(job.id),
    }));
    sendJson(res, jobsWithSessions);
  });

  // ── Get single job with sessions ──────────────────────────────
  api.get("/api/orchestration/jobs/:id", (req, res, { id: idStr }) => {
    const job = db.getJob(parseInt(idStr));
    if (!job) return sendJson(res, { error: "Job not found" }, 404);
    const sessions = db.getJobSessionsByJob(job.id);
    sendJson(res, { ...job, sessions });
  });

  // ── Create job ────────────────────────────────────────────────
  api.post("/api/orchestration/jobs", async (req, res) => {
    const body = await readBody(req);
    if (!body.project_id || !body.title) {
      return sendJson(res, { error: "project_id and title required" }, 400);
    }

    const project = db.getProject(body.project_id as number);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    const job = db.addJob(
      body.project_id as number,
      body.title as string,
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
      const validStatuses = ["todo", "working", "waiting_input", "testing", "review", "finished", "rejected"];
      if (!validStatuses.includes(body.status as string)) {
        return sendJson(res, { error: "Invalid status" }, 400);
      }
      orchestration.transitionJob(id, body.status as any);
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

    const updated = db.getJob(id);
    sendJson(res, { ...updated, sessions: db.getJobSessionsByJob(id) });
  });

  // ── Delete job ────────────────────────────────────────────────
  api.delete("/api/orchestration/jobs/:id", (req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const job = db.getJob(id);
    if (!job) return sendJson(res, { error: "Job not found" }, 404);

    // Don't delete actively running jobs
    if (job.status === "working" || job.status === "testing" || job.status === "review") {
      return sendJson(res, { error: "Cannot delete an active job" }, 400);
    }

    db.removeJob(id);
    sendJson(res, { success: true });
  });

  // ── Orchestration control ─────────────────────────────────────
  api.get("/api/orchestration/status", (_req, res) => {
    sendJson(res, orchestration.getState());
  });

  api.post("/api/orchestration/start", (_req, res) => {
    orchestration.start();
    sendJson(res, orchestration.getState());
  });

  api.post("/api/orchestration/stop", (_req, res) => {
    orchestration.stop();
    sendJson(res, orchestration.getState());
  });

  // ── Job events log ──────────────────────────────────────────
  api.get("/api/orchestration/jobs/:id/events", (_req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const job = db.getJob(id);
    if (!job) return sendJson(res, { error: "Job not found" }, 404);
    sendJson(res, orchestration.getJobEvents(id));
  });
}
