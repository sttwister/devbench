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

const devbench = window.devbench;

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

  // ── Helpers ──────────────────────────────────────────────────────

  /** Find the next (or previous) session in sidebar order relative to the given session. */
  const findAdjacentSession = useCallback((sessionId: number): Session | null => {
    const allSessions = projects.flatMap(p => p.sessions);
    const idx = allSessions.findIndex(s => s.id === sessionId);
    if (idx < 0) return null;
    // Prefer next session, fall back to previous
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

  // ── CRUD ─────────────────────────────────────────────────────────

  const handleNewSession = useCallback(async (projectId: number, type: SessionType) => {
    const label = getSessionLabel(type);
    const existing =
      projects
        .find((p) => p.id === projectId)
        ?.sessions.filter((s) => s.type === type).length ?? 0;
    const name = `${label} ${existing + 1}`;
    try {
      const session = await createSession(projectId, name, type);
      await loadProjects();
      selectSession(session);
    } catch (e: any) {
      alert(e.message);
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

  const handleDeleteSession = useCallback(async (id: number) => {
    if (!confirm("Kill this session?")) return;
    selectAdjacentOrClear(id);
    devbench?.sessionDestroyed(id);
    browserCleanup(id);
    await deleteSession(id);
    await loadProjects();
  }, [activeSession, loadProjects, browserCleanup, selectAdjacentOrClear]);

  const handleSessionEnded = useCallback(
    async (sessionId: number) => {
      selectAdjacentOrClear(sessionId);
      devbench?.sessionDestroyed(sessionId);
      browserCleanup(sessionId);
      await loadProjects();
    },
    [activeSession, loadProjects, browserCleanup, selectAdjacentOrClear]
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
        alert(`Failed to revive session: ${e.message}`);
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

  const handleNewSessionFromPopup = useCallback(
    (type: SessionType) => {
      const project = projects.find(p => p.sessions.some(s => s.id === activeSession?.id))
        ?? projects.find(p => p.id === activeSession?.project_id);
      const projectId = project?.id;
      if (projectId) handleNewSession(projectId, type);
      setNewSessionPopupOpen(false);
    },
    [projects, activeSession, handleNewSession]
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
    const id = activeSession.id;
    selectAdjacentOrClear(id);
    setKillSessionPopupOpen(false);
    devbench?.sessionDestroyed(id);
    browserCleanup(id);
    await deleteSession(id);
    await loadProjects();
  }, [activeSession, loadProjects, browserCleanup, selectAdjacentOrClear]);

  return {
    // Popup state
    newSessionPopupOpen,
    setNewSessionPopupOpen,
    killSessionPopupOpen,
    setKillSessionPopupOpen,
    renameSessionPopupOpen,
    setRenameSessionPopupOpen,
    archivedProjectId,
    setArchivedProjectId,
    // Actions
    handleNewSession,
    handleRenameSession,
    handleDeleteSession,
    handleSessionEnded,
    handleReviveSession,
    handleReorderSessions,
    // Popup callbacks
    handleNewSessionFromPopup,
    handleRenameSessionConfirm,
    handleKillSessionConfirm,
  };
}
