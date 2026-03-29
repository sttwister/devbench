import { useState, useEffect, useCallback } from "react";
import type { Project, Session, SessionType, AgentStatus } from "../api";
import ProjectGroup from "./ProjectGroup";
import { SidebarProvider, useSidebarContext } from "./SidebarContext";

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

export default function Sidebar(props: Props) {
  return (
    <SidebarProvider
      projects={props.projects}
      agentStatuses={props.agentStatuses}
      orphanedSessionIds={props.orphanedSessionIds}
      activeSessionId={props.activeSessionId}
      activeProjectId={props.activeProjectId}
      onSelectSession={props.onSelectSession}
      onSelectProject={props.onSelectProject}
      onEditProject={props.onEditProject}
      onDeleteProject={props.onDeleteProject}
      onNewSession={props.onNewSession}
      onDeleteSession={props.onDeleteSession}
      onReviveSession={props.onReviveSession}
      onShowArchivedSessions={props.onShowArchivedSessions}
      onOpenMrLink={props.onOpenMrLink}
      onRenameSession={props.onRenameSession}
      onReorderProjects={props.onReorderProjects}
      onReorderSessions={props.onReorderSessions}
    >
      <SidebarInner
        projects={props.projects}
        isOpen={props.isOpen}
        onClose={props.onClose}
        onAddProject={props.onAddProject}
      />
    </SidebarProvider>
  );
}

interface InnerProps {
  projects: Project[];
  isOpen: boolean;
  onClose: () => void;
  onAddProject: () => void;
}

function SidebarInner({ projects, isOpen, onClose, onAddProject }: InnerProps) {
  const { dnd, activeProjectId, activeSessionId } = useSidebarContext();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

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
            isExpanded={expanded.has(project.id)}
            projectIndex={projectIndex}
            onToggleExpand={toggleExpand}
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
