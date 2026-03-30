/**
 * API routes for the GitButler dashboard.
 *
 * GET endpoints return cached data instantly and trigger a background refresh.
 * The client polls to pick up the refreshed data.
 */

import { Router } from "../router.ts";
import * as db from "../db.ts";
import * as gitbutler from "../gitbutler.ts";
import * as cache from "../gitbutler-cache.ts";
import { sendJson, readBody } from "../http-utils.ts";
import * as mrMerge from "../mr-merge.ts";
import type { ProjectDashboard, PullResult, MergeResult } from "@devbench/shared";

export function registerGitButlerRoutes(api: Router): void {

  /** GitButler status for a single project — returns cache, triggers refresh. */
  api.get("/api/projects/:id/gitbutler", (req, res, { id: idStr }) => {
    const projectId = parseInt(idStr);
    const project = db.getProject(projectId);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    const force = (req.url ?? "").includes("force=1");
    // Trigger background refresh FIRST (so refreshing flag is set)
    cache.triggerRefresh(projectId, force);

    // Then return cached data (with correct refreshing flag)
    const result = cache.getCachedDashboard(projectId) ?? {
      projectId, projectName: project.name, projectPath: project.path,
      stacks: [], unassignedChanges: [], pullCheck: null, error: null,
      refreshing: true, lastRefreshed: null,
    };

    sendJson(res, result);
  });

  /** GitButler status for all projects — returns cache, triggers refresh. */
  api.get("/api/gitbutler", (req, res) => {
    const force = (req.url ?? "").includes("force=1");
    // Trigger background refresh FIRST (so refreshing flags are set)
    cache.triggerRefreshAll(force);

    // Then return cached data (with correct refreshing flags)
    sendJson(res, cache.getAllCachedDashboards());
  });

  /** Pull for a single project — synchronous, then refreshes cache. */
  api.post("/api/projects/:id/gitbutler/pull", async (_req, res, { id: idStr }) => {
    const projectId = parseInt(idStr);
    const project = db.getProject(projectId);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    const result = await pullProject(projectId, project.name, project.path);
    // Force-refresh cache after pull
    cache.triggerRefresh(projectId, true);
    sendJson(res, result);
  });

  /** Merge MR/PR URLs via forge CLIs, then auto-pull affected projects. */
  api.post("/api/merge", async (req, res) => {
    try {
      const body = await readBody(req);
      const urls = body.urls as string[] | undefined;
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return sendJson(res, { error: "Missing or empty 'urls' array" }, 400);
      }

      // Merge all MRs
      const mergeResults = await mrMerge.mergeMrs(urls);

      // If any merged immediately, pull all projects to update workspace
      const anyMerged = mergeResults.some((r) => r.outcome === "merged");
      let pullResults: PullResult[] | null = null;

      if (anyMerged) {
        const projects = db.getProjects();
        pullResults = [];
        for (const project of projects) {
          pullResults.push(await pullProject(project.id, project.name, project.path));
        }
        cache.triggerRefreshAll(true);
      }

      sendJson(res, { mergeResults, pullResults });
    } catch (e: any) {
      sendJson(res, { error: e.message || "Merge failed" }, 500);
    }
  });

  /** Pull for all projects — sequential, then refreshes cache. */
  api.post("/api/gitbutler/pull-all", async (_req, res) => {
    const projects = db.getProjects();
    const results: PullResult[] = [];

    for (const project of projects) {
      results.push(await pullProject(project.id, project.name, project.path));
    }

    // Force-refresh cache for all projects after pull
    cache.triggerRefreshAll(true);
    sendJson(res, results);
  });
}

// ── Helpers ─────────────────────────────────────────────────────

async function pullProject(
  projectId: number,
  projectName: string,
  projectPath: string,
): Promise<PullResult> {
  try {
    const result = await gitbutler.doPull(projectPath);
    return { projectId, projectName, success: true, hasConflicts: result.hasConflicts, error: null };
  } catch (e: any) {
    return { projectId, projectName, success: false, hasConflicts: false, error: e.message || "Pull failed" };
  }
}
