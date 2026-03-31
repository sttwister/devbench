/**
 * GitButler dashboard cache — stores per-project dashboard data in the DB
 * and refreshes it asynchronously in the background.
 *
 * API consumers get cached data instantly and a `refreshing` flag per project.
 * Each project refreshes independently so fast projects don't wait for slow ones.
 */

import * as db from "./db.ts";
import * as gitbutler from "./gitbutler.ts";
import type { ProjectDashboard } from "@devbench/shared";

// ── In-memory state ─────────────────────────────────────────────

/** Set of project IDs currently being refreshed. */
const refreshingProjects = new Set<number>();

/** Minimum interval between refreshes per project (ms). */
const REFRESH_COOLDOWN = 8_000;

// ── Cache read ──────────────────────────────────────────────────

/** Get cached dashboard for a single project (instant, from DB). */
export function getCachedDashboard(projectId: number): ProjectDashboard | null {
  const cached = db.getGitButlerCache(projectId);
  if (!cached) return null;
  try {
    const data = JSON.parse(cached.data) as ProjectDashboard;
    data.refreshing = refreshingProjects.has(projectId);
    data.lastRefreshed = cached.lastRefreshed;
    return data;
  } catch {
    return null;
  }
}

/** Get cached dashboards for all projects (instant, from DB). */
export function getAllCachedDashboards(): ProjectDashboard[] {
  const projects = db.getProjects();
  const cacheMap = db.getAllGitButlerCache();
  const results: ProjectDashboard[] = [];

  for (const project of projects) {
    const cached = cacheMap.get(project.id);
    if (cached) {
      try {
        const data = JSON.parse(cached.data) as ProjectDashboard;
        data.refreshing = refreshingProjects.has(project.id);
        data.lastRefreshed = cached.lastRefreshed;
        results.push(data);
      } catch {
        results.push(emptyDashboard(project.id, project.name, project.path));
      }
    } else {
      results.push(emptyDashboard(project.id, project.name, project.path));
    }
  }

  return results;
}

// ── Cache refresh (async, non-blocking) ─────────────────────────

/** Trigger a background refresh for a single project. Returns immediately. */
export function triggerRefresh(projectId: number, force = false): void {
  if (refreshingProjects.has(projectId)) return; // already in progress
  if (!force && !isStale(projectId)) return; // recently refreshed

  const project = db.getProject(projectId);
  if (!project) return;

  refreshingProjects.add(projectId);
  refreshProject(projectId, project.name, project.path).finally(() => {
    refreshingProjects.delete(projectId);
  });
}

/** Trigger background refresh for all projects. Returns immediately. */
export function triggerRefreshAll(force = false): void {
  const projects = db.getProjects();
  for (const project of projects) {
    triggerRefresh(project.id, force);
  }
}

/** Check if a project's cache is stale (older than cooldown). */
function isStale(projectId: number): boolean {
  const cached = db.getGitButlerCache(projectId);
  if (!cached) return true;
  const age = Date.now() - new Date(cached.lastRefreshed).getTime();
  return age > REFRESH_COOLDOWN;
}

/** Check if a project is currently refreshing. */
export function isRefreshing(projectId: number): boolean {
  return refreshingProjects.has(projectId);
}

// ── Internal refresh logic ──────────────────────────────────────

async function refreshProject(
  projectId: number,
  projectName: string,
  projectPath: string,
): Promise<void> {
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
    } catch { /* optional */ }

    const dashboard: ProjectDashboard = {
      projectId,
      projectName,
      projectPath,
      stacks: enrichedStacks,
      unassignedChanges: status.unassignedChanges,
      pullCheck,
      error: null,
      refreshing: false,
      lastRefreshed: new Date().toISOString(),
    };

    db.setGitButlerCache(projectId, JSON.stringify(dashboard));
  } catch (e: any) {
    // Store the error state so the client sees it
    const dashboard: ProjectDashboard = {
      projectId,
      projectName,
      projectPath,
      stacks: [],
      unassignedChanges: [],
      pullCheck: null,
      error: e.message || "Failed to get GitButler status",
      refreshing: false,
      lastRefreshed: new Date().toISOString(),
    };
    db.setGitButlerCache(projectId, JSON.stringify(dashboard));
  }
}

function emptyDashboard(projectId: number, projectName: string, projectPath: string): ProjectDashboard {
  return {
    projectId,
    projectName,
    projectPath,
    stacks: [],
    unassignedChanges: [],
    pullCheck: null,
    error: null,
    refreshing: refreshingProjects.has(projectId),
    lastRefreshed: null,
  };
}
