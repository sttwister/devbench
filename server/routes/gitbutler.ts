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
import type { ProjectDashboard, PullResult, MergeResult, PushResult, UnapplyResult } from "@devbench/shared";

export function registerGitButlerRoutes(api: Router): void {

  /** Diff for uncommitted changes, a commit, or a branch in a project. */
  api.get("/api/projects/:id/diff", async (req, res, { id: idStr }) => {
    const projectId = parseInt(idStr);
    const project = db.getProject(projectId);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    try {
      const url = new URL(req.url ?? "", "http://localhost");
      const target = url.searchParams.get("target") || undefined;
      const result = await gitbutler.getDiff(project.path, target);
      sendJson(res, result);
    } catch (e: any) {
      sendJson(res, { error: e.message || "Failed to get diff" }, 500);
    }
  });

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

  /** Merge MR/PR URLs via forge CLIs, optionally pull a specific project. */
  api.post("/api/merge", async (req, res) => {
    try {
      const body = await readBody(req);
      const urls = body.urls as string[] | undefined;
      const pullProjectId = body.pullProjectId as number | undefined;
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return sendJson(res, { error: "Missing or empty 'urls' array" }, 400);
      }

      // Merge all MRs
      const mergeResults = await mrMerge.mergeMrs(urls);

      // Only pull if explicitly requested (pullProjectId provided)
      const anyMerged = mergeResults.some((r) => r.outcome === "merged");
      let pullResults: PullResult[] | null = null;

      if (anyMerged && pullProjectId != null) {
        const project = db.getProject(pullProjectId);
        if (project) {
          pullResults = [await pullProject(project.id, project.name, project.path)];
          cache.triggerRefresh(pullProjectId, true);
        }
      }

      // Always refresh cache after merge
      cache.triggerRefreshAll(true);

      sendJson(res, { mergeResults, pullResults });
    } catch (e: any) {
      sendJson(res, { error: e.message || "Merge failed" }, 500);
    }
  });

  /** Unapply a branch (stash it) from the workspace. */
  api.post("/api/projects/:id/gitbutler/unapply", async (req, res, { id: idStr }) => {
    const projectId = parseInt(idStr);
    const project = db.getProject(projectId);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    try {
      const body = await readBody(req);
      const branchName = body.branch as string | undefined;
      if (!branchName) return sendJson(res, { error: "Missing 'branch' field" }, 400);

      await gitbutler.doUnapply(project.path, branchName);
      cache.triggerRefresh(projectId, true);
      sendJson(res, { projectId, projectName: project.name, branchName, success: true, error: null } satisfies UnapplyResult);
    } catch (e: any) {
      sendJson(res, { projectId, projectName: project.name, branchName: "unknown", success: false, error: e.message || "Unapply failed" } satisfies UnapplyResult);
    }
  });

  /** Push a single branch in a project. */
  api.post("/api/projects/:id/gitbutler/push", async (req, res, { id: idStr }) => {
    const projectId = parseInt(idStr);
    const project = db.getProject(projectId);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    try {
      const body = await readBody(req);
      const branchName = body.branch as string | undefined;
      const force = !!body.force;
      if (!branchName) return sendJson(res, { error: "Missing 'branch' field" }, 400);

      await gitbutler.doPush(project.path, branchName, force);
      cache.triggerRefresh(projectId, true);
      sendJson(res, { projectId, projectName: project.name, branchName, success: true, error: null } satisfies PushResult);
    } catch (e: any) {
      sendJson(res, { projectId, projectName: project.name, branchName: "unknown", success: false, error: e.message || "Push failed" } satisfies PushResult);
    }
  });

  /** Push all pushable branches across all projects. */
  api.post("/api/gitbutler/push-all", async (_req, res) => {
    const results: PushResult[] = [];
    const allDashboards = cache.getAllCachedDashboards();

    for (const dash of allDashboards) {
      const project = db.getProject(dash.projectId);
      if (!project) continue;

      for (const stack of dash.stacks) {
        for (const branch of stack.branches) {
          if (isPushable(branch.branchStatus)) {
            const force = branch.branchStatus === "unpushedCommitsRequiringForce";
            try {
              await gitbutler.doPush(project.path, branch.name, force);
              results.push({ projectId: project.id, projectName: project.name, branchName: branch.name, success: true, error: null });
            } catch (e: any) {
              results.push({ projectId: project.id, projectName: project.name, branchName: branch.name, success: false, error: e.message || "Push failed" });
            }
          }
        }
      }
    }

    // Refresh all dashboards after pushing
    cache.triggerRefreshAll(true);
    sendJson(res, results);
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

function isPushable(branchStatus: string): boolean {
  return branchStatus === "completelyUnpushed" || branchStatus === "unpushedCommits" || branchStatus === "unpushedCommitsRequiringForce";
}

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
