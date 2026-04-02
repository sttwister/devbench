// @lat: [[monitoring#Monitor Lifecycle]]
/**
 * Centralised start/stop for all per-session background monitors
 * (agent-status, auto-rename, MR-link detection, MR-status polling).
 */

import * as agentStatus from "./agent-status.ts";
import * as autoRename from "./auto-rename.ts";
import * as mrLinks from "./mr-links.ts";
import * as mrStatus from "./mr-status.ts";
import * as terminal from "./terminal.ts";
import * as db from "./db.ts";
import * as cache from "./gitbutler-cache.ts";
import type { SessionType, MergeRequest } from "@devbench/shared";
import { DEFAULT_NAME_RE } from "./session-naming.ts";

export { DEFAULT_NAME_RE };

// ── Orphaned session tracking ───────────────────────────────────────
const orphanedSessionIds = new Set<number>();

export function isOrphaned(id: number): boolean {
  return orphanedSessionIds.has(id);
}

export function markOrphaned(id: number): void {
  orphanedSessionIds.add(id);
}

export function clearOrphaned(id: number): void {
  orphanedSessionIds.delete(id);
}

export function getOrphanedIds(): number[] {
  return Array.from(orphanedSessionIds);
}

// ── MR entity helpers ───────────────────────────────────────────────

/** Detect MR provider from URL. */
function detectMrProvider(url: string): "gitlab" | "github" | "bitbucket" {
  if (url.match(/github\.com/)) return "github";
  if (url.match(/bitbucket/)) return "bitbucket";
  return "gitlab";
}

/**
 * Convert a MergeRequest entity to an MrStatus object for backward compat.
 */
function mrToStatus(mr: MergeRequest): import("@devbench/shared").MrStatus {
  return {
    state: mr.state,
    draft: mr.draft,
    approved: mr.approved,
    changes_requested: mr.changes_requested,
    pipeline_status: mr.pipeline_status,
    auto_merge: mr.auto_merge,
    last_checked: mr.last_checked ?? new Date().toISOString(),
  };
}

// ── Monitor lifecycle ───────────────────────────────────────────────

/** MR status change callback — broadcasts status updates to clients. */
function mrStatusChanged(mrId: number, mr: MergeRequest) {
  // Broadcast to the session's WebSocket clients
  if (mr.session_id) {
    const session = db.getSession(mr.session_id);
    if (session) {
      // Build full statuses map from all MRs for this session (for backward compat)
      const sessionMrs = db.getMergeRequestsBySession(mr.session_id);
      const statuses: Record<string, import("@devbench/shared").MrStatus> = {};
      for (const m of sessionMrs) {
        statuses[m.url] = mrToStatus(m);
      }
      terminal.broadcastControl(session.tmux_name, { type: "mr-statuses-changed", statuses });
    }
  }
}

/** URLs that have already been validated (pass or no-token). */
const validatedUrls = new Set<string>();
/** URLs confirmed as non-existent (404). */
const rejectedUrls = new Set<string>();

/** MR-link change callback shared by both startup and runtime monitors. */
function mrLinksChanged(tmuxName: string, sessionId: number, urls: string[]) {
  // Split into already-known-good and needs-validation
  const knownGood = urls.filter((u) => validatedUrls.has(u));
  const needsCheck = urls.filter((u) => !validatedUrls.has(u) && !rejectedUrls.has(u));

  // Commit known-good URLs immediately
  if (knownGood.length > 0) {
    commitMrLinks(tmuxName, sessionId, knownGood);
  }

  // Validate new URLs asynchronously, then commit the ones that pass
  if (needsCheck.length > 0) {
    validateAndCommitUrls(tmuxName, sessionId, needsCheck, knownGood);
  }
}

/** Validate URLs against the API, then commit the survivors. */
async function validateAndCommitUrls(
  tmuxName: string,
  sessionId: number,
  urls: string[],
  alreadyCommitted: string[],
): Promise<void> {
  const passed: string[] = [];

  for (const url of urls) {
    const result = await mrStatus.validateUrl(url);
    if (result === false) {
      // Confirmed 404 — reject permanently
      rejectedUrls.add(url);
      console.log(`[mr-links] Rejected non-existent URL: ${url}`);
    } else {
      // true (exists) or null (can't tell) — accept
      validatedUrls.add(url);
      passed.push(url);
    }
  }

  if (passed.length > 0) {
    // Merge with what was already committed in the synchronous path
    const session = db.getSession(sessionId);
    const existing = session?.mr_urls ?? alreadyCommitted;
    const merged = [...new Set([...existing, ...passed])];
    commitMrLinks(tmuxName, sessionId, merged);
  }
}

/** Persist validated MR URLs and broadcast. */
function commitMrLinks(tmuxName: string, sessionId: number, urls: string[]) {
  const session = db.getSession(sessionId);
  if (!session) return;

  // Create/update MR entities in the database
  for (const url of urls) {
    const provider = detectMrProvider(url);
    db.addMergeRequest(url, provider, sessionId, session.project_id);
  }

  // Sync to legacy session columns for backward compat
  db.updateSessionMrUrls(sessionId, urls);

  // Broadcast the change to connected WebSocket clients
  terminal.broadcastControl(tmuxName, { type: "mr-links-changed", urls });

  // Refresh GitButler cache so the dashboard picks up new links promptly
  refreshCacheForSession(sessionId);

  // Trigger immediate status poll for newly detected MR URLs
  mrStatus.pollUrls(urls);
}

/** Auto-rename callback shared by both startup and runtime monitors. */
function sessionRenamed(tmuxName: string, _id: number, newName: string) {
  terminal.broadcastControl(tmuxName, { type: "session-renamed", name: newName });
}

/** Start all monitors for a newly created / revived session. */
export function startSessionMonitors(
  sessionId: number,
  tmuxName: string,
  sessionName: string,
  type: SessionType,
  mrUrls: string[]
): void {
  agentStatus.startMonitoring(sessionId, tmuxName, type);
  if (type !== "terminal" && DEFAULT_NAME_RE.test(sessionName)) {
    autoRename.startAutoRename(sessionId, tmuxName, sessionName,
      (_id, newName) => sessionRenamed(tmuxName, _id, newName));
  }
  mrLinks.startMonitoring(sessionId, tmuxName, mrUrls,
    (id, urls) => mrLinksChanged(tmuxName, id, urls));
}

/**
 * Resume monitors for a session that was already running before server restart.
 */
export function resumeSessionMonitors(
  sessionId: number,
  tmuxName: string,
  sessionName: string,
  type: SessionType,
  mrUrls: string[]
): void {
  agentStatus.startMonitoring(sessionId, tmuxName, type);
  mrLinks.startMonitoring(sessionId, tmuxName, mrUrls,
    (id, urls) => mrLinksChanged(tmuxName, id, urls));

  if (type !== "terminal" && DEFAULT_NAME_RE.test(sessionName)) {
    console.log(`[auto-rename] Restarting monitor for session ${sessionId} ("${sessionName}")`);
    autoRename.tryRenameNow(sessionId, tmuxName, sessionName,
      (_id, newName) => sessionRenamed(tmuxName, _id, newName));
  }
}

/**
 * Start the global MR status poller. Called once at server startup.
 */
export function startMrStatusPolling(): void {
  mrStatus.startGlobalPolling(mrStatusChanged);
}

/**
 * Re-evaluate MR status polling for all active sessions after a token
 * is added or changed.
 */
export function restartMrStatusPollingForProvider(provider: "gitlab" | "github"): void {
  mrStatus.onTokenChanged(provider);
}

/** Dismiss a MR URL from a session (user-initiated removal). */
export function dismissMrUrl(sessionId: number, url: string): void {
  mrLinks.dismissUrl(sessionId, url);

  // Remove MR entity
  db.removeMergeRequestByUrl(url);

  const session = db.getSession(sessionId);
  if (session) {
    // Update legacy session columns
    const newUrls = session.mr_urls.filter((u) => u !== url);
    db.updateSessionMrUrls(sessionId, newUrls);
    terminal.broadcastControl(session.tmux_name, { type: "mr-links-changed", urls: newUrls });
  }
}

/** Manually add a MR URL to a session (user-initiated). */
export function addMrUrl(sessionId: number, url: string): void {
  mrLinks.addManualUrl(sessionId, url);

  const session = db.getSession(sessionId);
  if (session) {
    // Create MR entity
    const provider = detectMrProvider(url);
    db.addMergeRequest(url, provider, sessionId, session.project_id);

    // Update legacy session columns
    const newUrls = session.mr_urls.includes(url) ? session.mr_urls : [...session.mr_urls, url];
    db.updateSessionMrUrls(sessionId, newUrls);
    terminal.broadcastControl(session.tmux_name, { type: "mr-links-changed", urls: newUrls });

    // Trigger immediate status poll
    mrStatus.pollUrls([url]);
  }
}

/** Trigger a GitButler cache refresh for the project that owns a session. */
function refreshCacheForSession(sessionId: number): void {
  const session = db.getSession(sessionId);
  if (session) {
    cache.triggerRefresh(session.project_id, true);
  }
}

/** Stop all monitors and clean up a session. */
export function stopSessionMonitors(sessionId: number): void {
  agentStatus.stopMonitoring(sessionId);
  autoRename.stopAutoRename(sessionId);
  mrLinks.stopMonitoring(sessionId);
  orphanedSessionIds.delete(sessionId);
}
