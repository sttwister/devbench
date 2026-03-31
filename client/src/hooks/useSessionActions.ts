import { useState, useCallback } from "react";
import type { Project, Session, SessionType } from "../api";
import {
  createSession,
  deleteSession,
  renameSession,
  reviveSession,
  reorderSessions as apiReorderSessions,
  getSessionLabel,
} from "../api";
import { devbench } from "../platform";

interface SessionActionsDeps {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  activeSession: Session | null;
  setActiveSession: React.Dispatch<React.SetStateAction<Session | null>>;
  selectSession: (session: Session) => void;
  loadProjects: () => Promise<void>;
  browserCleanup: (sessionId: number) => void;
  setOrphanedSessionIds: React.Dispatch<React.SetStateAction<Set<number>>>;
}

export function useSessionActions(deps: SessionActionsDeps) {
  const {
    projects, setProjects,
    activeSession, setActiveSession,
    selectSession, loadProjects,
    browserCleanup, setOrphanedSessionIds,
  } = deps;

  // Popup state
  const [newSessionPopupOpen, setNewSessionPopupOpen] = useState(false);
  const [killSessionPopupOpen, setKillSessionPopupOpen] = useState(false);
  const [renameSessionPopupOpen, setRenameSessionPopupOpen] = useState(false);
  const [archivedProjectId, setArchivedProjectId] = useState<number | null>(null);
  /** Session ID pending sidebar-initiated kill confirmation (not the Ctrl+Shift+X popup). */
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<number | null>(null);
  /** Session ID for the edit session popup. */
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  /** Session ID for the close session popup. */
  const [closingSessionId, setClosingSessionId] = useState<number | null>(null);
  /** Error message to show in a popup (replaces alert()). */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────

  /** Find the next (or previous) session in sidebar order relative to the given session. */
  const findAdjacentSession = useCallback((sessionId: number): Session | null => {
    const allSessions = projects.flatMap(p => p.sessions);
    const idx = allSessions.findIndex(s => s.id === sessionId);
    if (idx < 0) return null;
    if (idx + 1 < allSessions.length) return allSessions[idx + 1];
    if (idx - 1 >= 0) return allSessions[idx - 1];
    return null;
  }, [projects]);

  /** Select the adjacent session when killing the active one, or clear selection. */
  const selectAdjacentOrClear = useCallback((killedSessionId: number) => {
    if (activeSession?.id !== killedSessionId) return;
    const next = findAdjacentSession(killedSessionId);
    if (next) {
      selectSession(next);
    } else {
      setActiveSession(null);
    }
  }, [activeSession, findAdjacentSession, selectSession, setActiveSession]);

  /**
   * Shared cleanup when a session goes away (killed, ended, confirmed kill).
   * Handles: adjacent selection, Electron notification, browser cleanup.
   */
  const cleanupDestroyedSession = useCallback((sessionId: number) => {
    selectAdjacentOrClear(sessionId);
    devbench?.sessionDestroyed(sessionId);
    browserCleanup(sessionId);
  }, [selectAdjacentOrClear, browserCleanup]);

  // ── CRUD ─────────────────────────────────────────────────────────

  const handleNewSession = useCallback(async (projectId: number, type: SessionType, sourceUrl?: string) => {
    const label = getSessionLabel(type);
    const existing =
      projects
        .find((p) => p.id === projectId)
        ?.sessions.filter((s) => s.type === type).length ?? 0;
    const name = `${label} ${existing + 1}`;
    try {
      const session = await createSession(projectId, name, type, sourceUrl);
      await loadProjects();
      selectSession(session);
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  }, [projects, loadProjects, selectSession]);

  const handleRenameSession = useCallback(async (id: number, name: string) => {
    try {
      await renameSession(id, name);
      await loadProjects();
      if (activeSession?.id === id) {
        setActiveSession((prev) => (prev ? { ...prev, name } : prev));
      }
    } catch (e: any) {
      console.error("Failed to rename session:", e);
    }
  }, [activeSession, loadProjects, setActiveSession]);

  /** Called from sidebar × button — opens confirmation popup instead of native confirm(). */
  const handleDeleteSession = useCallback((id: number) => {
    setConfirmDeleteSessionId(id);
  }, []);

  /** Called when the user confirms the sidebar delete popup. */
  const handleConfirmDeleteSession = useCallback(async () => {
    const id = confirmDeleteSessionId;
    if (id === null) return;
    setConfirmDeleteSessionId(null);
    cleanupDestroyedSession(id);
    await deleteSession(id);
    await loadProjects();
  }, [confirmDeleteSessionId, loadProjects, cleanupDestroyedSession]);

  const handleSessionEnded = useCallback(
    async (sessionId: number) => {
      cleanupDestroyedSession(sessionId);
      await loadProjects();
    },
    [loadProjects, cleanupDestroyedSession]
  );

  const handleReviveSession = useCallback(
    async (id: number) => {
      try {
        const session = await reviveSession(id);
        setOrphanedSessionIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        await loadProjects();
        selectSession(session);
        setArchivedProjectId(null);
      } catch (e: any) {
        setErrorMessage(`Failed to revive session: ${e.message}`);
      }
    },
    [loadProjects, selectSession, setOrphanedSessionIds]
  );

  const handleReorderSessions = useCallback(async (projectId: number, orderedIds: number[]) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const map = new Map(p.sessions.map(s => [s.id, s]));
      return { ...p, sessions: orderedIds.map(id => map.get(id)!).filter(Boolean) };
    }));
    try { await apiReorderSessions(projectId, orderedIds); }
    catch (e) { console.error("Failed to reorder sessions:", e); loadProjects(); }
  }, [loadProjects, setProjects]);

  // ── Popup callbacks ──────────────────────────────────────────────

  /** Project ID override for the new-session popup (set by sidebar + button). */
  const [newSessionPopupProjectId, setNewSessionPopupProjectId] = useState<number | null>(null);

  const handleNewSessionFromPopup = useCallback(
    (projectId: number, type: SessionType, sourceUrl?: string) => {
      handleNewSession(projectId, type, sourceUrl);
      setNewSessionPopupOpen(false);
      setNewSessionPopupProjectId(null);
    },
    [handleNewSession]
  );

  const handleRenameSessionConfirm = useCallback(
    async (newName: string) => {
      if (!activeSession) return;
      setRenameSessionPopupOpen(false);
      await handleRenameSession(activeSession.id, newName);
    },
    [activeSession, handleRenameSession]
  );

  const handleKillSessionConfirm = useCallback(async () => {
    if (!activeSession) return;
    setKillSessionPopupOpen(false);
    cleanupDestroyedSession(activeSession.id);
    await deleteSession(activeSession.id);
    await loadProjects();
  }, [activeSession, loadProjects, cleanupDestroyedSession]);

  const handleCloseSession = useCallback((id: number) => {
    setClosingSessionId(id);
  }, []);

  const handleSessionClosed = useCallback(async (sessionId: number) => {
    setClosingSessionId(null);
    cleanupDestroyedSession(sessionId);
    await loadProjects();
  }, [loadProjects, cleanupDestroyedSession]);

  return {
    // Popup state
    newSessionPopupOpen,
    setNewSessionPopupOpen,
    newSessionPopupProjectId,
    setNewSessionPopupProjectId,
    killSessionPopupOpen,
    setKillSessionPopupOpen,
    renameSessionPopupOpen,
    setRenameSessionPopupOpen,
    editingSessionId,
    setEditingSessionId,
    closingSessionId,
    setClosingSessionId,
    archivedProjectId,
    setArchivedProjectId,
    confirmDeleteSessionId,
    setConfirmDeleteSessionId,
    errorMessage,
    setErrorMessage,
    // Actions
    handleNewSession,
    handleRenameSession,
    handleDeleteSession,
    handleConfirmDeleteSession,
    handleSessionEnded,
    handleReviveSession,
    handleReorderSessions,
    // Popup callbacks
    handleNewSessionFromPopup,
    handleRenameSessionConfirm,
    handleKillSessionConfirm,
    handleCloseSession,
    handleSessionClosed,
  };
}
