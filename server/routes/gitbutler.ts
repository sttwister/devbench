/**
 * API routes for the GitButler dashboard.
 */

import { Router } from "../router.ts";
import * as db from "../db.ts";
import * as gitbutler from "../gitbutler.ts";
import { sendJson, readBody } from "../http-utils.ts";
import type { ProjectDashboard, PullResult } from "@devbench/shared";

export function registerGitButlerRoutes(api: Router): void {
  /** GitButler status for a single project. */
  api.get("/api/projects/:id/gitbutler", async (_req, res, { id: idStr }) => {
    const projectId = parseInt(idStr);
    const project = db.getProject(projectId);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    const result = await getProjectDashboard(projectId, project.name, project.path);
    sendJson(res, result);
  });

  /** GitButler status for all projects. */
  api.get("/api/gitbutler", async (_req, res) => {
    const projects = db.getProjects();
    const results: ProjectDashboard[] = [];

    for (const project of projects) {
      results.push(await getProjectDashboard(project.id, project.name, project.path));
    }

    sendJson(res, results);
  });

  /** Pull for a single project. */
  api.post("/api/projects/:id/gitbutler/pull", async (_req, res, { id: idStr }) => {
    const projectId = parseInt(idStr);
    const project = db.getProject(projectId);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    const result = await pullProject(projectId, project.name, project.path);
    sendJson(res, result);
  });

  /** Pull for all projects. */
  api.post("/api/gitbutler/pull-all", async (_req, res) => {
    const projects = db.getProjects();
    const results: PullResult[] = [];

    for (const project of projects) {
      results.push(await pullProject(project.id, project.name, project.path));
    }

    sendJson(res, results);
  });
}

// ── Helpers ─────────────────────────────────────────────────────

async function getProjectDashboard(
  projectId: number,
  projectName: string,
  projectPath: string
): Promise<ProjectDashboard> {
  try {
    const [status, branchReviews] = await Promise.all([
      gitbutler.getButStatus(projectPath),
      gitbutler.getBranchReviews(projectPath),
    ]);
    const sessions = db.getSessionsByProject(projectId);
    const enrichedStacks = gitbutler.enrichWithSessions(status.stacks, sessions, branchReviews);

    let pullCheck = null;
    try {
      pullCheck = await gitbutler.checkPull(projectPath);
    } catch { /* pull check is optional */ }

    return {
      projectId,
      projectName,
      projectPath,
      stacks: enrichedStacks,
      unassignedChanges: status.unassignedChanges,
      pullCheck,
      error: null,
    };
  } catch (e: any) {
    return {
      projectId,
      projectName,
      projectPath,
      stacks: [],
      unassignedChanges: [],
      pullCheck: null,
      error: e.message || "Failed to get GitButler status",
    };
  }
}

async function pullProject(
  projectId: number,
  projectName: string,
  projectPath: string
): Promise<PullResult> {
  try {
    const result = await gitbutler.doPull(projectPath);
    return {
      projectId,
      projectName,
      success: true,
      hasConflicts: result.hasConflicts,
      error: null,
    };
  } catch (e: any) {
    return {
      projectId,
      projectName,
      success: false,
      hasConflicts: false,
      error: e.message || "Pull failed",
    };
  }
}
