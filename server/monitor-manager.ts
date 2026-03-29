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

/** Start all monitors for a newly created / revived session. */
export function startSessionMonitors(
  sessionId: number,
  tmuxName: string,
  sessionName: string,
  type: SessionType,
  mrUrls: string[]
): void {
  agentStatus.startMonitoring(sessionId, tmuxName, type);
  autoRename.startAutoRename(sessionId, tmuxName, sessionName, (_id, newName) => {
    terminal.broadcastControl(tmuxName, { type: "session-renamed", name: newName });
  });
  mrLinks.startMonitoring(sessionId, tmuxName, mrUrls, (id, urls) => {
    db.updateSessionMrUrls(id, urls);
    terminal.broadcastControl(tmuxName, { type: "mr-links-changed", urls });
  });
}

/** Stop all monitors and clean up a session. */
export function stopSessionMonitors(sessionId: number): void {
  agentStatus.stopMonitoring(sessionId);
  autoRename.stopAutoRename(sessionId);
  mrLinks.stopMonitoring(sessionId);
  orphanedSessionIds.delete(sessionId);
}
