/**
 * Centralised start/stop for all per-session background monitors
 * (agent-status, auto-rename, MR-link detection).
 */

import * as agentStatus from "./agent-status.ts";
import * as autoRename from "./auto-rename.ts";
import * as mrLinks from "./mr-links.ts";
import * as terminal from "./terminal.ts";
import * as db from "./db.ts";
import type { SessionType } from "@devbench/shared";

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
const DEFAULT_NAME_RE = /^(Terminal|Claude Code|Pi|Codex) \d+$/;

/** MR-link change callback shared by both startup and runtime monitors. */
function mrLinksChanged(tmuxName: string, id: number, urls: string[]) {
  db.updateSessionMrUrls(id, urls);
  terminal.broadcastControl(tmuxName, { type: "mr-links-changed", urls });
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
}

/** Stop all monitors and clean up a session. */
export function stopSessionMonitors(sessionId: number): void {
  agentStatus.stopMonitoring(sessionId);
  autoRename.stopAutoRename(sessionId);
  mrLinks.stopMonitoring(sessionId);
  orphanedSessionIds.delete(sessionId);
}
