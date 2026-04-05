// @lat: [[gitbutler#Dashboard Cache]]
/**
 * GitButler dashboard cache — stores per-project dashboard data in the DB
 * and refreshes it asynchronously in the background.
 *
 * API consumers get cached data instantly and a `refreshing` flag per project.
 * Each project refreshes independently so fast projects don't wait for slow ones.
 */

import * as db from "./db.ts";
import * as gitbutler from "./gitbutler.ts";
import * as mrStatus from "./mr-status.ts";
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

/** Get cached dashboards for all active projects (instant, from DB). */
export function getAllCachedDashboards(): ProjectDashboard[] {
  const projects = db.getActiveProjects();
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

/** Trigger background refresh for all active projects. Returns immediately. */
export function triggerRefreshAll(force = false): void {
  const projects = db.getActiveProjects();
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
    const localSessions = db.getSessionsByProject(projectId);

    // Collect all review URLs from branches — these are inherently per-project
    // (reported by GitButler for this project's workspace).
    // Look up their MR entities to find sessions from other projects.
    const localSessionIds = new Set(localSessions.map((s) => s.id));
    const crossProjectSessionIds = new Set<number>();
    for (const stack of status.stacks) {
      for (const branch of stack.branches) {
        const urls = branchReviews.find((br) => br.name === branch.name)?.reviews.map((r) => r.url) ?? [];
        for (const url of urls) {
          const mr = db.getMergeRequestByUrl(url);
          if (mr?.session_id != null && !localSessionIds.has(mr.session_id)) {
            crossProjectSessionIds.add(mr.session_id);
          }
        }
      }
    }
    const crossProjectSessions = [...crossProjectSessionIds]
      .map((id) => db.getSession(id))
      .filter((s): s is NonNullable<typeof s> => s != null);
    const sessions = [...localSessions, ...crossProjectSessions];

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

    // Ensure MR entities exist for branch review URLs and trigger polling.
    ensureBranchReviewMrs(enrichedStacks, sessions);
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

// ── Poll MR statuses for GitButler branch review URLs ───────────

import type { DashboardStack, Session } from "@devbench/shared";

/**
 * Ensure review URLs from GitButler branches have MR entities
 * and are polled for status. Creates MR entities for any branch
 * review URLs not already tracked, linking them to the branch's
 * session if available.
 */
function ensureBranchReviewMrs(
  stacks: DashboardStack[],
  sessions: Session[],
): void {
  for (const stack of stacks) {
    for (const branch of stack.branches) {
      for (const url of branch.reviewUrls) {
        let provider = "gitlab";
        if (url.match(/github\.com/)) provider = "github";
        else if (url.match(/bitbucket/)) provider = "bitbucket";

        const linkedSessionId = branch.linkedSession
          ? sessions.find((s) => s.id === branch.linkedSession!.id)?.id ?? null
          : null;

        db.addMergeRequest(url, provider, linkedSessionId);
      }
    }
  }

  // Trigger immediate poll for any new MR URLs
  const allReviewUrls: string[] = [];
  for (const stack of stacks) {
    for (const branch of stack.branches) {
      allReviewUrls.push(...branch.reviewUrls);
    }
  }
  if (allReviewUrls.length > 0) {
    mrStatus.pollUrls(allReviewUrls);
  }
}
