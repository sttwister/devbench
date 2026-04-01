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
import * as terminal from "./terminal.ts";
import type { ProjectDashboard, MrStatus } from "@devbench/shared";

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

    // Ensure MR status polling for review URLs discovered from branches.
    // Find URLs not already polled by any session and poll them under the
    // first available session so the global MR status context has data.
    pollBranchReviewUrls(projectId, enrichedStacks, sessions);
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
 * Ensure review URLs from GitButler branches are polled for status.
 * Finds URLs not already covered by session-level polling and starts
 * polling them under the most relevant session (linked session first,
 * then any session in the project).
 */
function pollBranchReviewUrls(
  projectId: number,
  stacks: DashboardStack[],
  sessions: Session[],
): void {
  // Collect all review URLs from branches
  const allReviewUrls = new Set<string>();
  // Map review URL → preferred session (from branch's linked session)
  const urlToLinkedSession = new Map<string, Session>();

  for (const stack of stacks) {
    for (const branch of stack.branches) {
      for (const url of branch.reviewUrls) {
        allReviewUrls.add(url);
        if (branch.linkedSession && !urlToLinkedSession.has(url)) {
          const session = sessions.find((s) => s.id === branch.linkedSession!.id);
          if (session) urlToLinkedSession.set(url, session);
        }
      }
    }
  }

  if (allReviewUrls.size === 0) return;

  // Find URLs not already tracked by any session's mr_urls
  const alreadyTracked = new Set<string>();
  for (const session of sessions) {
    for (const url of session.mr_urls) {
      alreadyTracked.add(url);
    }
  }

  const untrackedUrls = [...allReviewUrls].filter((url) => !alreadyTracked.has(url));
  if (untrackedUrls.length === 0) return;

  // Group untracked URLs by the session we'll poll under
  const urlsBySession = new Map<number, { session: Session; urls: string[] }>();
  const fallbackSession = sessions[0] ?? null;

  for (const url of untrackedUrls) {
    const session = urlToLinkedSession.get(url) ?? fallbackSession;
    if (!session) continue;
    let entry = urlsBySession.get(session.id);
    if (!entry) {
      entry = { session, urls: [] };
      urlsBySession.set(session.id, entry);
    }
    entry.urls.push(url);
  }

  // Start polling for each group
  for (const { session, urls } of urlsBySession.values()) {
    mrStatus.startPolling(session.id, urls, (_id, statuses) => {
      terminal.broadcastControl(session.tmux_name, { type: "mr-statuses-changed", statuses });
    });
  }
}
