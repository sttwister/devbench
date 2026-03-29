import { useState, useEffect, useCallback } from "react";
import type { Project, Session, SessionType, AgentStatus } from "../api";
import ProjectGroup from "./ProjectGroup";
import { useSidebarDragAndDrop } from "../hooks/useSidebarDragAndDrop";

interface Props {
  projects: Project[];
  agentStatuses: Record<string, AgentStatus>;
  orphanedSessionIds: Set<number>;
  activeSessionId: number | null;
  activeProjectId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onAddProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (id: number) => void;
  onNewSession: (projectId: number, type: SessionType) => void;
  onDeleteSession: (id: number) => void;
  onReviveSession: (id: number) => void;
  onShowArchivedSessions: (projectId: number) => void;
  onSelectSession: (session: Session) => void;
  onSelectProject: (projectId: number) => void;
  onRenameSession: (id: number, name: string) => void;
  onOpenMrLink: (session: Session, url: string) => void;
  onReorderProjects: (orderedIds: number[]) => void;
  onReorderSessions: (projectId: number, orderedIds: number[]) => void;
}

export default function Sidebar({
  projects,
  agentStatuses,
  orphanedSessionIds,
  activeSessionId,
  activeProjectId,
  isOpen,
  onClose,
  onAddProject,
  onEditProject,
  onDeleteProject,
  onNewSession,
  onDeleteSession,
  onReviveSession,
  onShowArchivedSessions,
  onSelectSession,
  onSelectProject,
  onRenameSession,
  onOpenMrLink,
  onReorderProjects,
  onReorderSessions,
}: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [renamingSessionId, setRenamingSessionId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Drag & drop
  const dnd = useSidebarDragAndDrop(projects, { onReorderProjects, onReorderSessions });

  // Auto-expand projects when they appear
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      projects.forEach((p) => next.add(p.id));
      return next;
    });
  }, [projects]);

  const toggleExpand = useCallback((id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    }), []);

  const handleStartRename = useCallback((sessionId: number, currentName: string) => {
    setRenamingSessionId(sessionId);
    setRenameValue(currentName);
  }, []);

  const handleCommitRename = useCallback((sessionId: number) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      onRenameSession(sessionId, trimmed);
    }
    setRenamingSessionId(null);
  }, [renameValue, onRenameSession]);

  const handleCancelRename = useCallback(() => {
    setRenamingSessionId(null);
  }, []);

  return (
    <aside className={`sidebar ${isOpen ? "open" : ""}`}>
      <div className="sidebar-header">
        <h1>Devbench</h1>
        <button className="icon-btn sidebar-close-btn" onClick={onClose} title="Close sidebar">✕</button>
      </div>

      <div
        className="sidebar-content"
        ref={dnd.sidebarContentRef}
        onDragOver={dnd.handleDragOver}
        onDrop={dnd.handleDrop}
      >
        {projects.length === 0 && (
          <div className="sidebar-empty">No projects yet. Add one below.</div>
        )}

        {projects.map((project, projectIndex) => (
          <ProjectGroup
            key={project.id}
            project={project}
            activeSessionId={activeSessionId}
            activeProjectId={activeProjectId}
            agentStatuses={agentStatuses}
            orphanedSessionIds={orphanedSessionIds}
            isExpanded={expanded.has(project.id)}
            dropClass={dnd.getProjectDropClass(projectIndex)}
            isDragSource={dnd.activeDrag?.kind === "project" && dnd.activeDrag.id === project.id}
            renamingSessionId={renamingSessionId}
            renameValue={renameValue}
            onRenameValueChange={setRenameValue}
            onCommitRename={handleCommitRename}
            onCancelRename={handleCancelRename}
            onStartRename={handleStartRename}
            onToggleExpand={toggleExpand}
            onSelectProject={onSelectProject}
            onSelectSession={onSelectSession}
            onEditProject={onEditProject}
            onDeleteProject={onDeleteProject}
            onNewSession={onNewSession}
            onDeleteSession={onDeleteSession}
            onReviveSession={onReviveSession}
            onShowArchivedSessions={onShowArchivedSessions}
            onOpenMrLink={onOpenMrLink}
            onGripMouseDown={dnd.handleGripMouseDown}
            onTouchGripStart={dnd.handleTouchGripStart}
            onProjectDragStart={dnd.handleProjectDragStart}
            onSessionDragStart={dnd.handleSessionDragStart}
            onDragEnd={dnd.handleDragEnd}
            getSessionDropClass={dnd.getSessionDropClass}
            activeDragSessionId={
              dnd.activeDrag?.kind === "session" ? dnd.activeDrag.id : null
            }
          />
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="add-project-btn" onClick={onAddProject}>
          + Add Project
        </button>
        <div className="sidebar-shortcuts-hint">
          <kbd>Ctrl+Shift+?</kbd> for shortcuts
        </div>
      </div>
    </aside>
  );
}
