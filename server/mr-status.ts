/**
 * MR/PR status polling — fetches merge request / pull request status
 * from GitLab and GitHub APIs and tracks state changes.
 */

import type { MrStatus } from "@devbench/shared";
import * as db from "./db.ts";

const POLL_INTERVAL = 60_000; // 60 seconds

interface Poller {
  timer: NodeJS.Timeout;
  urls: Set<string>;
}

const activePollers = new Map<number, Poller>();

type StatusChangeCallback = (sessionId: number, statuses: Record<string, MrStatus>) => void;

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
    // We need BOTH the legacy commit status API and the check runs API
    // (GitHub Actions report via check runs, not legacy statuses)
    let pipelineStatus: MrStatus["pipeline_status"] = null;
    try {
      // Fetch legacy commit statuses and check runs (GitHub Actions) in parallel
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

      // If there are neither statuses nor check runs, leave pipeline as null
      if (legacyStatuses.length > 0 || checkRuns.length > 0) {
        // Collect individual states into a unified list:
        //   "success" | "failed" | "running" | "pending"
        const states: string[] = [];

        // Legacy statuses: state is "success" | "failure" | "error" | "pending"
        for (const s of legacyStatuses) {
          if (s.state === "success") states.push("success");
          else if (s.state === "failure" || s.state === "error") states.push("failed");
          else if (s.state === "pending") states.push("pending");
        }

        // Check runs: status is "queued" | "in_progress" | "completed"
        //   conclusion (when completed): "success" | "failure" | "cancelled" |
        //     "timed_out" | "action_required" | "neutral" | "skipped" | "stale"
        for (const cr of checkRuns) {
          if (cr.status === "queued") states.push("pending");
          else if (cr.status === "in_progress") states.push("running");
          else if (cr.status === "completed") {
            const c = cr.conclusion;
            if (c === "success" || c === "neutral" || c === "skipped") states.push("success");
            else if (c === "failure" || c === "cancelled" || c === "timed_out") states.push("failed");
            else if (c === "action_required" || c === "stale") states.push("pending");
            else states.push("success"); // unknown conclusion, treat as success
          }
        }

        // Determine overall pipeline status (worst wins):
        //   failed > running > pending > success
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

// ── Polling lifecycle ───────────────────────────────────────────────

async function pollSession(
  sessionId: number,
  urls: Set<string>,
  onChange: StatusChangeCallback
): Promise<void> {
  const session = db.getSession(sessionId);
  if (!session) return;

  const currentStatuses = { ...session.mr_statuses };
  let changed = false;

  for (const url of urls) {
    const status = await fetchStatus(url);
    if (!status) continue;

    const prev = currentStatuses[url];
    if (
      !prev ||
      prev.state !== status.state ||
      prev.draft !== status.draft ||
      prev.approved !== status.approved ||
      prev.changes_requested !== status.changes_requested ||
      prev.pipeline_status !== status.pipeline_status ||
      prev.auto_merge !== status.auto_merge
    ) {
      currentStatuses[url] = status;
      changed = true;
      console.log(`[mr-status] Session ${sessionId} ${url}: ${status.state}` +
        `${status.approved ? " approved" : ""}${status.changes_requested ? " changes_requested" : ""}` +
        `${status.pipeline_status ? ` pipeline:${status.pipeline_status}` : ""}`);
    }
  }

  if (changed) {
    db.updateSessionMrStatuses(sessionId, currentStatuses);
    onChange(sessionId, currentStatuses);
  }
}

/**
 * Start status polling for a session's MR URLs.
 * Merges any new URLs into existing polling.
 */
export function startPolling(
  sessionId: number,
  mrUrls: string[],
  onChange: StatusChangeCallback
): void {
  // Filter to URLs we can actually poll
  const pollableUrls = mrUrls.filter((url) => {
    const provider = detectProvider(url);
    if (!provider) return false;
    // Only poll if we have a token for this provider
    const tokenKey = provider === "gitlab" ? "gitlab_token" : "github_token";
    return !!db.getSetting(tokenKey);
  });

  if (pollableUrls.length === 0) {
    // No pollable URLs — stop any existing poller
    stopPolling(sessionId);
    return;
  }

  const existing = activePollers.get(sessionId);
  if (existing) {
    // Add new URLs to existing poller
    let added = false;
    for (const url of pollableUrls) {
      if (!existing.urls.has(url)) {
        existing.urls.add(url);
        added = true;
      }
    }
    // Trigger an immediate poll if new URLs were added
    if (added) {
      pollSession(sessionId, existing.urls, onChange);
    }
    return;
  }

  // Create a new poller
  const urls = new Set(pollableUrls);

  // Immediate first poll
  pollSession(sessionId, urls, onChange);

  const timer = setInterval(() => {
    pollSession(sessionId, urls, onChange);
  }, POLL_INTERVAL);

  activePollers.set(sessionId, { timer, urls });
}

/** Stop polling for a session. */
export function stopPolling(sessionId: number): void {
  const poller = activePollers.get(sessionId);
  if (poller) {
    clearInterval(poller.timer);
    activePollers.delete(sessionId);
  }
}

/** Check if polling is active for a session. */
export function isPolling(sessionId: number): boolean {
  return activePollers.has(sessionId);
}
