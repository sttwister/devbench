import { useState, useCallback, useEffect } from "react";
import { updateSessionBrowserState } from "../api";
import type { Project } from "../api";

export interface BrowserSessionState {
  url: string;
  open: boolean;
  viewMode: "desktop" | "mobile";
}

/**
 * Manages per-session browser state (URL, open/closed, view mode).
 *
 * Consolidates what was previously three separate Maps/Sets:
 *   browserSessions, browserOpenSessions, viewModeSessions
 * into a single Map<sessionId, BrowserSessionState>.
 */
export function useBrowserState(projects: Project[]) {
  const [sessions, setSessions] = useState<Map<number, BrowserSessionState>>(new Map());
  const [initialized, setInitialized] = useState(false);

  // Initialize browser state from DB on first project load
  useEffect(() => {
    if (initialized || projects.length === 0) return;
    const initial = new Map<number, BrowserSessionState>();
    for (const p of projects) {
      for (const s of p.sessions) {
        if ((s.browser_open && p.browser_url) || s.view_mode) {
          initial.set(s.id, {
            url: p.browser_url ?? "",
            open: !!(s.browser_open && p.browser_url),
            viewMode: (s.view_mode as "desktop" | "mobile") ??
              (p.default_view_mode as "desktop" | "mobile") ?? "desktop",
          });
        }
      }
    }
    if (initial.size > 0) setSessions(initial);
    setInitialized(true);
  }, [projects, initialized]);

  // Prune stale sessions when projects change
  useEffect(() => {
    const allSessionIds = new Set(
      projects.flatMap((p) => p.sessions.map((s) => s.id))
    );
    setSessions((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const sid of next.keys()) {
        if (!allSessionIds.has(sid)) { next.delete(sid); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [projects]);

  const persistState = useCallback((sessionId: number, open: boolean, viewMode: string | null) => {
    updateSessionBrowserState(sessionId, open, viewMode).catch((e) =>
      console.error("Failed to persist browser state:", e)
    );
  }, []);

  /** Check if the browser is open for a given session. */
  const isOpen = useCallback((sessionId: number): boolean => {
    return sessions.get(sessionId)?.open ?? false;
  }, [sessions]);

  /** Get the view mode for a session, falling back to project default. */
  const getViewMode = useCallback((sessionId: number): "desktop" | "mobile" => {
    const state = sessions.get(sessionId);
    if (state?.viewMode === "desktop" || state?.viewMode === "mobile") return state.viewMode;
    const proj = projects.find((p) => p.sessions.some((s) => s.id === sessionId));
    return (proj?.default_view_mode as "desktop" | "mobile") ?? "desktop";
  }, [sessions, projects]);

  /** Get the browser URL for a session (if registered). */
  const getUrl = useCallback((sessionId: number): string | undefined => {
    return sessions.get(sessionId)?.url;
  }, [sessions]);

  /** Toggle the browser open/closed for a session. */
  const toggle = useCallback((sessionId: number, defaultUrl?: string) => {
    setSessions((prev) => {
      const next = new Map(prev);
      const existing = next.get(sessionId);
      const nowOpen = !(existing?.open ?? false);
      const vm = existing?.viewMode ?? "desktop";
      next.set(sessionId, {
        url: existing?.url || defaultUrl || "",
        viewMode: vm as "desktop" | "mobile",
        open: nowOpen,
      });
      persistState(sessionId, nowOpen, vm);
      return next;
    });
  }, [persistState]);

  /** Close the browser for a session. */
  const close = useCallback((sessionId: number) => {
    setSessions((prev) => {
      const existing = prev.get(sessionId);
      if (!existing?.open) return prev;
      const next = new Map(prev);
      next.set(sessionId, { ...existing, open: false });
      persistState(sessionId, false, existing.viewMode);
      return next;
    });
  }, [persistState]);

  /** Set the view mode for a session. */
  const setViewMode = useCallback((sessionId: number, mode: "desktop" | "mobile") => {
    setSessions((prev) => {
      const next = new Map(prev);
      const existing = next.get(sessionId);
      if (existing) {
        next.set(sessionId, { ...existing, viewMode: mode });
        persistState(sessionId, existing.open, mode);
      }
      return next;
    });
  }, [persistState]);

  /** Ensure a session has a browser entry (e.g. when inline browser opens). */
  const ensureRegistered = useCallback((sessionId: number, url: string) => {
    setSessions((prev) => {
      if (prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.set(sessionId, { url, open: false, viewMode: "desktop" });
      return next;
    });
  }, []);

  /** Remove all browser state for a session (on delete). */
  const cleanup = useCallback((sessionId: number) => {
    setSessions((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  /** Set the open state directly (used by Electron sync). */
  const setOpen = useCallback((sessionId: number, open: boolean) => {
    setSessions((prev) => {
      const next = new Map(prev);
      const existing = next.get(sessionId);
      const vm = existing?.viewMode ?? null;
      next.set(sessionId, { ...(existing ?? { url: "", viewMode: "desktop" as const }), open });
      persistState(sessionId, open, vm);
      return next;
    });
  }, [persistState]);

  return {
    sessions,
    isOpen,
    getViewMode,
    getUrl,
    toggle,
    close,
    setViewMode,
    ensureRegistered,
    cleanup,
    setOpen,
  };
}
