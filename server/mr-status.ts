// @lat: [[monitoring#MR Status Polling]]
/**
 * MR/PR status polling — fetches merge request / pull request status
 * from GitLab and GitHub APIs and updates the merge_requests table.
 *
 * Polling operates on MR entities (not sessions). Active-session MRs
 * are polled every 60 seconds. On-demand polling is available for
 * archived sessions via fetchAndUpdateStatuses().
 */

import type { MrStatus, MergeRequest } from "@devbench/shared";
import * as db from "./db.ts";

const POLL_INTERVAL = 60_000; // 60 seconds

/** Global poller — polls all open MRs for active sessions. */
let globalTimer: NodeJS.Timeout | null = null;

type StatusChangeCallback = (mrId: number, mr: MergeRequest) => void;

/** Registered callback for status changes (set by monitor-manager). */
let onStatusChange: StatusChangeCallback | null = null;

// ── Provider detection ──────────────────────────────────────────────

export type Provider = "gitlab" | "github" | null;

export function detectProvider(url: string): Provider {
  if (url.match(/\/-\/merge_requests\/\d+/)) return "gitlab";
  if (url.match(/github\.com\/[^/]+\/[^/]+\/pull\/\d+/)) return "github";
  return null;
}

// ── GitLab API ──────────────────────────────────────────────────────

async function fetchGitLabMrStatus(url: string, token: string): Promise<MrStatus | null> {
  // Parse: https://gitlab.com/group/subgroup/project/-/merge_requests/42
  const match = url.match(/^(https?:\/\/[^/]+)\/(.+)\/-\/merge_requests\/(\d+)/);
  if (!match) return null;

  const [, host, projectPath, mrIid] = match;
  const encoded = encodeURIComponent(projectPath);
  const apiUrl = `${host}/api/v4/projects/${encoded}/merge_requests/${mrIid}`;

  try {
    const res = await fetch(apiUrl, {
      headers: { "PRIVATE-TOKEN": token },
    });
    if (!res.ok) {
      console.log(`[mr-status] GitLab API error ${res.status} for ${url}`);
      return null;
    }
    const data = await res.json() as any;

    // Check approvals separately (optional endpoint)
    let approved = false;
    try {
      const approvalsUrl = `${host}/api/v4/projects/${encoded}/merge_requests/${mrIid}/approvals`;
      const appRes = await fetch(approvalsUrl, {
        headers: { "PRIVATE-TOKEN": token },
      });
      if (appRes.ok) {
        const appData = await appRes.json() as any;
        approved = (appData.approved_by?.length || 0) > 0;
      }
    } catch { /* approvals endpoint not available */ }

    return {
      state: data.state === "merged" ? "merged" : data.state === "closed" ? "closed" : "open",
      draft: data.draft || data.work_in_progress || false,
      approved,
      changes_requested: false, // GitLab doesn't have a native "changes requested" state
      pipeline_status: data.head_pipeline?.status ?? null,
      auto_merge: data.state !== "merged" && data.state !== "closed" &&
        (data.merge_when_pipeline_succeeds === true || data.auto_merge_enabled === true),
      last_checked: new Date().toISOString(),
    };
  } catch (e: any) {
    console.log(`[mr-status] GitLab fetch error for ${url}: ${e.message}`);
    return null;
  }
}

// ── GitHub API ──────────────────────────────────────────────────────

async function fetchGitHubPrStatus(url: string, token: string): Promise<MrStatus | null> {
  // Parse: https://github.com/owner/repo/pull/18
  const match = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) return null;

  const [, repo, prNumber] = match;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
  };

  try {
    const prRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, { headers });
    if (!prRes.ok) {
      console.log(`[mr-status] GitHub API error ${prRes.status} for ${url}`);
      return null;
    }
    const pr = await prRes.json() as any;

    // Fetch reviews for approval / changes_requested
    let approved = false;
    let changesRequested = false;
    try {
      const reviewsRes = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`,
        { headers }
      );
      if (reviewsRes.ok) {
        const reviews = await reviewsRes.json() as any[];
        // Build latest review state per user (ignore COMMENTED)
        const latestByUser = new Map<string, string>();
        for (const r of reviews) {
          if (r.state !== "COMMENTED" && r.state !== "PENDING") {
            latestByUser.set(r.user.login, r.state);
          }
        }
        approved = [...latestByUser.values()].some((s) => s === "APPROVED");
        changesRequested = [...latestByUser.values()].some((s) => s === "CHANGES_REQUESTED");
      }
    } catch { /* reviews fetch failed */ }

    // Check status / check runs for pipeline
    let pipelineStatus: MrStatus["pipeline_status"] = null;
    try {
      const [statusRes, checkRunsRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${repo}/commits/${pr.head.sha}/status`, { headers }),
        fetch(`https://api.github.com/repos/${repo}/commits/${pr.head.sha}/check-runs`, { headers }),
      ]);

      const hasStatuses = statusRes.ok;
      const hasCheckRuns = checkRunsRes.ok;

      const statusData = hasStatuses ? await statusRes.json() as any : null;
      const checkRunsData = hasCheckRuns ? await checkRunsRes.json() as any : null;

      const legacyStatuses: any[] = statusData?.statuses ?? [];
      const checkRuns: any[] = checkRunsData?.check_runs ?? [];

      if (legacyStatuses.length > 0 || checkRuns.length > 0) {
        const states: string[] = [];

        for (const s of legacyStatuses) {
          if (s.state === "success") states.push("success");
          else if (s.state === "failure" || s.state === "error") states.push("failed");
          else if (s.state === "pending") states.push("pending");
        }

        for (const cr of checkRuns) {
          if (cr.status === "queued") states.push("pending");
          else if (cr.status === "in_progress") states.push("running");
          else if (cr.status === "completed") {
            const c = cr.conclusion;
            if (c === "success" || c === "neutral" || c === "skipped") states.push("success");
            else if (c === "failure" || c === "cancelled" || c === "timed_out") states.push("failed");
            else if (c === "action_required" || c === "stale") states.push("pending");
            else states.push("success");
          }
        }

        if (states.includes("failed")) pipelineStatus = "failed";
        else if (states.includes("running")) pipelineStatus = "running";
        else if (states.includes("pending")) pipelineStatus = "pending";
        else pipelineStatus = "success";
      }
    } catch { /* status/check-runs fetch failed */ }

    return {
      state: pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open",
      draft: pr.draft || false,
      approved,
      changes_requested: changesRequested,
      pipeline_status: pipelineStatus,
      auto_merge: !pr.merged && pr.state !== "closed" && pr.auto_merge != null,
      last_checked: new Date().toISOString(),
    };
  } catch (e: any) {
    console.log(`[mr-status] GitHub fetch error for ${url}: ${e.message}`);
    return null;
  }
}

// ── Validate a URL exists (lightweight check) ─────────────────────

/**
 * Check whether a MR/PR URL points to a real merge request.
 * Returns true (exists), false (confirmed 404), or null (can't tell —
 * no token configured or network error).  Only hits the main endpoint,
 * skipping approvals/reviews/pipeline calls to stay lightweight.
 */
export async function validateUrl(url: string): Promise<boolean | null> {
  const provider = detectProvider(url);
  if (!provider) return null;

  const tokenKey = provider === "gitlab" ? "gitlab_token" : "github_token";
  const token = db.getSetting(tokenKey);
  if (!token) return null; // can't verify without a token

  try {
    if (provider === "gitlab") {
      const match = url.match(/^(https?:\/\/[^/]+)\/(.+)\/-\/merge_requests\/(\d+)/);
      if (!match) return null;
      const [, host, projectPath, mrIid] = match;
      const encoded = encodeURIComponent(projectPath);
      const res = await fetch(
        `${host}/api/v4/projects/${encoded}/merge_requests/${mrIid}`,
        { headers: { "PRIVATE-TOKEN": token } },
      );
      if (res.status === 404) return false;
      return res.ok;
    }
    if (provider === "github") {
      const match = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
      if (!match) return null;
      const [, repo, prNumber] = match;
      const res = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${prNumber}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" } },
      );
      if (res.status === 404) return false;
      return res.ok;
    }
  } catch {
    return null; // network error — can't tell
  }
  return null;
}

// ── Fetch status for any URL ────────────────────────────────────────

async function fetchStatus(url: string): Promise<MrStatus | null> {
  const provider = detectProvider(url);
  if (!provider) return null;

  if (provider === "gitlab") {
    const token = db.getSetting("gitlab_token");
    if (!token) return null;
    return fetchGitLabMrStatus(url, token);
  }

  if (provider === "github") {
    const token = db.getSetting("github_token");
    if (!token) return null;
    return fetchGitHubPrStatus(url, token);
  }

  return null;
}

// ── Poll and update a single MR entity ──────────────────────────────

async function pollMergeRequest(mr: MergeRequest): Promise<boolean> {
  const status = await fetchStatus(mr.url);
  if (!status) return false;

  const changed =
    mr.state !== status.state ||
    mr.draft !== status.draft ||
    mr.approved !== status.approved ||
    mr.changes_requested !== status.changes_requested ||
    mr.pipeline_status !== status.pipeline_status ||
    mr.auto_merge !== status.auto_merge;

  if (changed) {
    db.updateMergeRequestStatus(mr.id, status);
    const updated = db.getMergeRequestByUrl(mr.url);
    if (updated) {
      console.log(`[mr-status] MR ${mr.id} ${mr.url}: ${status.state}` +
        `${status.approved ? " approved" : ""}${status.changes_requested ? " changes_requested" : ""}` +
        `${status.pipeline_status ? ` pipeline:${status.pipeline_status}` : ""}`);

      // Also update legacy session columns for backward compatibility
      syncToSessionLegacy(updated);

      if (onStatusChange) {
        onStatusChange(mr.id, updated);
      }
    }
    return true;
  } else {
    // Update last_checked even if nothing changed
    db.updateMergeRequestStatus(mr.id, status);
  }
  return false;
}

/**
 * Sync MR status back to the legacy session mr_statuses column.
 * Kept for backward compatibility during migration period.
 */
function syncToSessionLegacy(mr: MergeRequest): void {
  if (!mr.session_id) return;
  const session = db.getSession(mr.session_id);
  if (!session) return;

  const statuses = { ...session.mr_statuses };
  statuses[mr.url] = {
    state: mr.state,
    draft: mr.draft,
    approved: mr.approved,
    changes_requested: mr.changes_requested,
    pipeline_status: mr.pipeline_status,
    auto_merge: mr.auto_merge,
    last_checked: mr.last_checked ?? new Date().toISOString(),
  };
  db.updateSessionMrStatuses(mr.session_id, statuses);
}

// ── Global polling lifecycle ────────────────────────────────────────

/** Poll all open MRs belonging to active sessions. */
async function pollActiveMrs(): Promise<void> {
  const mrs = db.getOpenMergeRequestsForActiveSessions();
  for (const mr of mrs) {
    await pollMergeRequest(mr);
  }
}

/**
 * Start the global MR status poller.
 * Polls all open MRs for active sessions every 60 seconds.
 */
export function startGlobalPolling(onChange: StatusChangeCallback): void {
  onStatusChange = onChange;
  if (globalTimer) return;

  // Immediate first poll
  pollActiveMrs();

  globalTimer = setInterval(() => {
    pollActiveMrs();
  }, POLL_INTERVAL);
}

/** Stop the global poller. */
export function stopGlobalPolling(): void {
  if (globalTimer) {
    clearInterval(globalTimer);
    globalTimer = null;
  }
  onStatusChange = null;
}

/**
 * Trigger an immediate poll for specific MR URLs.
 * Used when new MRs are detected or added manually.
 */
export async function pollUrls(urls: string[]): Promise<void> {
  for (const url of urls) {
    const mr = db.getMergeRequestByUrl(url);
    if (mr && mr.state === "open") {
      await pollMergeRequest(mr);
    }
  }
}

/**
 * Fetch and update statuses for a list of MR URLs (on-demand).
 * Used by the archived sessions popup to refresh stale statuses.
 * Returns the updated MR entities.
 */
export async function fetchAndUpdateStatuses(urls: string[]): Promise<MergeRequest[]> {
  const results: MergeRequest[] = [];
  for (const url of urls) {
    const mr = db.getMergeRequestByUrl(url);
    if (!mr) continue;

    if (mr.state !== "merged" && mr.state !== "closed") {
      await pollMergeRequest(mr);
    }
    // Re-read after potential update
    const updated = db.getMergeRequestByUrl(url);
    if (updated) results.push(updated);
  }
  return results;
}

/**
 * Re-evaluate polling after a token is added or changed.
 * Triggers an immediate poll for MRs matching the provider.
 */
export async function onTokenChanged(provider: "gitlab" | "github"): Promise<void> {
  const mrs = db.getOpenMergeRequestsForActiveSessions();
  const matching = mrs.filter((mr) => detectProvider(mr.url) === provider);
  if (matching.length > 0) {
    console.log(`[mr-status] Token changed for ${provider} — polling ${matching.length} MR(s)`);
    for (const mr of matching) {
      await pollMergeRequest(mr);
    }
  }
}

/** Check if global polling is active. */
export function isPolling(): boolean {
  return globalTimer !== null;
}
