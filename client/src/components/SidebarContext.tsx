import { createContext, useContext, useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import type { Project, Session, SessionType, AgentStatus } from "../api";
import { useSidebarDragAndDrop } from "../hooks/useSidebarDragAndDrop";

// ── Rename state ────────────────────────────────────────────────────

interface RenameState {
  renamingSessionId: number | null;
  renameValue: string;
  setRenameValue: (value: string) => void;
  startRename: (sessionId: number, currentName: string) => void;
  commitRename: (sessionId: number) => void;
  cancelRename: () => void;
}

// ── Context value ───────────────────────────────────────────────────

interface SidebarContextValue {
  // Lookups
  agentStatuses: Record<string, AgentStatus>;
  orphanedSessionIds: Set<number>;
  activeSessionId: number | null;
  activeProjectId: number | null;
  // Rename
  rename: RenameState;
  // DnD
  dnd: ReturnType<typeof useSidebarDragAndDrop>;
  // Actions (passed from App)
  onSelectSession: (session: Session) => void;
  onSelectProject: (projectId: number) => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (id: number) => void;
  onNewSession: (projectId: number, type: SessionType) => void;
  onShowNewSessionPopup: (projectId: number) => void;
  onDeleteSession: (id: number) => void;
  onReviveSession: (id: number) => void;
  onShowArchivedSessions: (projectId: number) => void;
  onOpenMrLink: (session: Session, url: string) => void;
  onRenameSession: (id: number, name: string) => void;
  onEditSession: (id: number) => void;
  onOpenProjectDashboard: (projectId: number) => void;
}

const SidebarCtx = createContext<SidebarContextValue | null>(null);

export function useSidebarContext(): SidebarContextValue {
  const ctx = useContext(SidebarCtx);
  if (!ctx) throw new Error("useSidebarContext must be used within SidebarProvider");
  return ctx;
}

// ── Provider ────────────────────────────────────────────────────────

interface ProviderProps {
  children: ReactNode;
  projects: Project[];
  agentStatuses: Record<string, AgentStatus>;
  orphanedSessionIds: Set<number>;
  activeSessionId: number | null;
  activeProjectId: number | null;
  // Actions
  onSelectSession: (session: Session) => void;
  onSelectProject: (projectId: number) => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (id: number) => void;
  onNewSession: (projectId: number, type: SessionType) => void;
  onShowNewSessionPopup: (projectId: number) => void;
  onDeleteSession: (id: number) => void;
  onReviveSession: (id: number) => void;
  onShowArchivedSessions: (projectId: number) => void;
  onOpenMrLink: (session: Session, url: string) => void;
  onRenameSession: (id: number, name: string) => void;
  onEditSession: (id: number) => void;
  onOpenProjectDashboard: (projectId: number) => void;
  onReorderProjects: (orderedIds: number[]) => void;
  onReorderSessions: (projectId: number, orderedIds: number[]) => void;
}

export function SidebarProvider({
  children,
  projects,
  agentStatuses,
  orphanedSessionIds,
  activeSessionId,
  activeProjectId,
  onSelectSession,
  onSelectProject,
  onEditProject,
  onDeleteProject,
  onNewSession,
  onShowNewSessionPopup,
  onDeleteSession,
  onReviveSession,
  onShowArchivedSessions,
  onOpenMrLink,
  onRenameSession,
  onEditSession,
  onOpenProjectDashboard,
  onReorderProjects,
  onReorderSessions,
}: ProviderProps) {
  // ── Rename state ─────────────────────────────────────────────
  const [renamingSessionId, setRenamingSessionId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = useCallback((sessionId: number, currentName: string) => {
    setRenamingSessionId(sessionId);
    setRenameValue(currentName);
  }, []);

  const commitRename = useCallback((sessionId: number) => {
    const trimmed = renameValue.trim();
    if (trimmed) onRenameSession(sessionId, trimmed);
    setRenamingSessionId(null);
  }, [renameValue, onRenameSession]);

  const cancelRename = useCallback(() => {
    setRenamingSessionId(null);
  }, []);

  const rename: RenameState = useMemo(() => ({
    renamingSessionId,
    renameValue,
    setRenameValue,
    startRename,
    commitRename,
    cancelRename,
  }), [renamingSessionId, renameValue, startRename, commitRename, cancelRename]);

  // ── DnD ──────────────────────────────────────────────────────
  const dnd = useSidebarDragAndDrop(projects, { onReorderProjects, onReorderSessions });

  // ── Combined value ───────────────────────────────────────────
  const value = useMemo<SidebarContextValue>(() => ({
    agentStatuses,
    orphanedSessionIds,
    activeSessionId,
    activeProjectId,
    rename,
    dnd,
    onSelectSession,
    onSelectProject,
    onEditProject,
    onDeleteProject,
    onNewSession,
    onShowNewSessionPopup,
    onDeleteSession,
    onReviveSession,
    onShowArchivedSessions,
    onOpenMrLink,
    onRenameSession,
    onEditSession,
    onOpenProjectDashboard,
  }), [
    agentStatuses, orphanedSessionIds, activeSessionId, activeProjectId,
    rename, dnd,
    onSelectSession, onSelectProject, onEditProject, onDeleteProject,
    onNewSession, onShowNewSessionPopup, onDeleteSession, onReviveSession,
    onShowArchivedSessions, onOpenMrLink, onRenameSession, onEditSession,
    onOpenProjectDashboard,
  ]);

  return <SidebarCtx.Provider value={value}>{children}</SidebarCtx.Provider>;
}
