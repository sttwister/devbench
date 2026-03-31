/**
 * Global MR / PR status store.
 *
 * Every MR badge in the app reads status from this single context instead
 * of receiving it via props.  The store is populated from:
 *
 * 1. `projects` data (fetched every 10 s) — merges all session.mr_statuses
 * 2. WebSocket `mr-statuses-changed` messages — instant update for active session
 * 3. Archived / dashboard data — merged when those views open
 *
 * This guarantees that two badges for the same URL always show the same
 * status, regardless of which component renders them.
 */

import { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import type { MrStatus } from "../api";

interface MrStatusContextValue {
  /** Current status map (URL → MrStatus). */
  statuses: Record<string, MrStatus>;
  /**
   * Merge a batch of statuses into the store.
   * Only triggers a re-render when at least one visible field changes.
   */
  mergeStatuses: (incoming: Record<string, MrStatus>) => void;
}

const MrStatusContext = createContext<MrStatusContextValue>({
  statuses: {},
  mergeStatuses: () => {},
});

/** Read the global MR status store. */
export function useMrStatus(): MrStatusContextValue {
  return useContext(MrStatusContext);
}

function statusChanged(a: MrStatus, b: MrStatus): boolean {
  return (
    a.state !== b.state ||
    a.draft !== b.draft ||
    a.approved !== b.approved ||
    a.changes_requested !== b.changes_requested ||
    a.pipeline_status !== b.pipeline_status
  );
}

export function MrStatusProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, MrStatus>>({});

  // Stable function — uses functional updater so no deps needed.
  const mergeStatuses = useCallback((incoming: Record<string, MrStatus>) => {
    setStatuses((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [url, status] of Object.entries(incoming)) {
        const existing = next[url];
        if (!existing || statusChanged(existing, status)) {
          next[url] = status;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const value = useMemo(
    () => ({ statuses, mergeStatuses }),
    [statuses, mergeStatuses],
  );

  return (
    <MrStatusContext.Provider value={value}>
      {children}
    </MrStatusContext.Provider>
  );
}
