/**
 * Centralised start/stop for all per-session background monitors
 * (agent-status, auto-rename, MR-link detection).
 */

import * as agentStatus from "./agent-status.ts";
import * as autoRename from "./auto-rename.ts";
import * as mrLinks from "./mr-links.ts";
import * as mrStatus from "./mr-status.ts";
import * as terminal from "./terminal.ts";
import * as db from "./db.ts";
import * as cache from "./gitbutler-cache.ts";
import type { SessionType, MrStatus } from "@devbench/shared";

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

// ── Monitor lifecycle ───────────────────────────────────────────────

// Regex for default session names that should trigger auto-rename.
export const DEFAULT_NAME_RE = /^(Terminal|Claude Code|Pi|Codex) \d+$/;

/** MR status change callback — broadcasts status updates to clients.
 *  No cache refresh needed here: the dashboard cache read path always
 *  resolves statuses from live session data (single source of truth). */
function mrStatusChanged(tmuxName: string, _id: number, statuses: Record<string, MrStatus>) {
  terminal.broadcastControl(tmuxName, { type: "mr-statuses-changed", statuses });
}

/** MR-link change callback shared by both startup and runtime monitors. */
function mrLinksChanged(tmuxName: string, id: number, urls: string[]) {
  db.updateSessionMrUrls(id, urls);
  terminal.broadcastControl(tmuxName, { type: "mr-links-changed", urls });
  // Refresh GitButler cache so the dashboard picks up new links promptly
  refreshCacheForSession(id);
  // Start status polling for newly detected MR URLs
  mrStatus.startPolling(id, urls, (sessionId, statuses) => {
    mrStatusChanged(tmuxName, sessionId, statuses);
  });
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
  autoRename.startAutoRename(sessionId, tmuxName, sessionName,
    (_id, newName) => sessionRenamed(tmuxName, _id, newName));
  mrLinks.startMonitoring(sessionId, tmuxName, mrUrls,
    (id, urls) => mrLinksChanged(tmuxName, id, urls));
  // Start MR status polling if there are already known MR URLs
  if (mrUrls.length > 0) {
    mrStatus.startPolling(sessionId, mrUrls, (id, statuses) => {
      mrStatusChanged(tmuxName, id, statuses);
    });
  }
}

/**
 * Resume monitors for a session that was already running before server restart.
 *
 * Unlike `startSessionMonitors`, this uses `tryRenameNow` instead of
 * `startAutoRename` — it first attempts an immediate rename based on
 * existing terminal content, then falls back to polling for changes.
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

  if (DEFAULT_NAME_RE.test(sessionName)) {
    console.log(`[auto-rename] Restarting monitor for session ${sessionId} ("${sessionName}")`);
    autoRename.tryRenameNow(sessionId, tmuxName, sessionName,
      (_id, newName) => sessionRenamed(tmuxName, _id, newName));
  }

  // Resume MR status polling if there are known MR URLs
  if (mrUrls.length > 0) {
    mrStatus.startPolling(sessionId, mrUrls, (id, statuses) => {
      mrStatusChanged(tmuxName, id, statuses);
    });
  }
}

/**
 * Re-evaluate MR status polling for all active sessions after a token
 * is added or changed.  Sessions whose MR URLs match the given provider
 * will have polling (re)started.
 */
export function restartMrStatusPollingForProvider(provider: "gitlab" | "github"): void {
  const sessions = db.getAllSessions();
  for (const s of sessions) {
    if (s.mr_urls.length === 0) continue;
    const matching = s.mr_urls.filter((url) => mrStatus.detectProvider(url) === provider);
    if (matching.length === 0) continue;

    console.log(`[mr-status] Token changed for ${provider} — starting polling for session ${s.id} (${matching.length} URL(s))`);
    mrStatus.startPolling(s.id, matching, (id, statuses) => {
      mrStatusChanged(s.tmux_name, id, statuses);
    });
  }
}

/** Dismiss a MR URL from a session (user-initiated removal). */
export function dismissMrUrl(sessionId: number, url: string): void {
  mrLinks.dismissUrl(sessionId, url);
  const session = db.getSession(sessionId);
  if (session) {
    const newUrls = session.mr_urls.filter((u) => u !== url);
    db.updateSessionMrUrls(sessionId, newUrls);
    terminal.broadcastControl(session.tmux_name, { type: "mr-links-changed", urls: newUrls });
    // Restart MR status polling without the dismissed URL
    mrStatus.stopPolling(sessionId);
    if (newUrls.length > 0) {
      mrStatus.startPolling(sessionId, newUrls, (id, statuses) => {
        mrStatusChanged(session.tmux_name, id, statuses);
      });
    }
  }
}

/** Manually add a MR URL to a session (user-initiated). */
export function addMrUrl(sessionId: number, url: string): void {
  mrLinks.addManualUrl(sessionId, url);
  const session = db.getSession(sessionId);
  if (session) {
    const newUrls = session.mr_urls.includes(url) ? session.mr_urls : [...session.mr_urls, url];
    db.updateSessionMrUrls(sessionId, newUrls);
    terminal.broadcastControl(session.tmux_name, { type: "mr-links-changed", urls: newUrls });
    mrStatus.startPolling(sessionId, newUrls, (id, statuses) => {
      mrStatusChanged(session.tmux_name, id, statuses);
    });
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
  mrStatus.stopPolling(sessionId);
  orphanedSessionIds.delete(sessionId);
}
