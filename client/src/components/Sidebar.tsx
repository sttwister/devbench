// @lat: [[client#Sidebar]]
import { useState, useEffect, useCallback } from "react";
import type { Project, Session, SessionType, AgentStatus } from "../api";
import ProjectGroup from "./ProjectGroup";
import { SidebarProvider, useSidebarContext } from "./SidebarContext";
import Icon from "./Icon";

type ConnectionStatus = "connected" | "connecting" | "disconnected";

interface Props {
  connectionStatus: ConnectionStatus;
  projects: Project[];
  agentStatuses: Record<string, AgentStatus>;
  orphanedSessionIds: Set<number>;
  processingSourceSessionIds: Set<number>;
  notifiedSessionIds: Set<number>;
  activeSessionId: number | null;
  activeProjectId: number | null;
  isOpen: boolean;
  onClose: () => void;
  onAddProject: () => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (id: number) => void;
  onNewSession: (projectId: number, type: SessionType) => void;
  onShowNewSessionPopup: (projectId: number) => void;
  onDeleteSession: (id: number) => void;
  onReviveSession: (id: number) => void;
  onShowArchivedSessions: (projectId: number) => void;
  onSelectSession: (session: Session) => void;
  onSelectProject: (projectId: number) => void;
  onRenameSession: (id: number, name: string) => void;
  onOpenMrLink: (session: Session, url: string) => void;
  onEditSession: (id: number) => void;
  onReorderProjects: (orderedIds: number[]) => void;
  onReorderSessions: (projectId: number, orderedIds: number[]) => void;
  hasExtensionUpdates?: boolean;
  onOpenSettings: () => void;
  onOpenGitButler: () => void;
  onOpenProjectDashboard: (projectId: number) => void;
  onSetProjectActive: (projectId: number, active: boolean) => void;
}

export default function Sidebar(props: Props) {
  return (
    <SidebarProvider
      projects={props.projects}
      agentStatuses={props.agentStatuses}
      orphanedSessionIds={props.orphanedSessionIds}
      processingSourceSessionIds={props.processingSourceSessionIds}
      notifiedSessionIds={props.notifiedSessionIds}
      activeSessionId={props.activeSessionId}
      activeProjectId={props.activeProjectId}
      onSelectSession={props.onSelectSession}
      onSelectProject={props.onSelectProject}
      onEditProject={props.onEditProject}
      onDeleteProject={props.onDeleteProject}
      onNewSession={props.onNewSession}
      onShowNewSessionPopup={props.onShowNewSessionPopup}
      onDeleteSession={props.onDeleteSession}
      onReviveSession={props.onReviveSession}
      onShowArchivedSessions={props.onShowArchivedSessions}
      onOpenMrLink={props.onOpenMrLink}
      onRenameSession={props.onRenameSession}
      onEditSession={props.onEditSession}
      onReorderProjects={props.onReorderProjects}
      onReorderSessions={props.onReorderSessions}
      onOpenProjectDashboard={props.onOpenProjectDashboard}
      onSetProjectActive={props.onSetProjectActive}
    >
      <SidebarInner
        connectionStatus={props.connectionStatus}
        projects={props.projects}
        isOpen={props.isOpen}
        onClose={props.onClose}
        onAddProject={props.onAddProject}
        hasExtensionUpdates={props.hasExtensionUpdates}
        onOpenSettings={props.onOpenSettings}
        onOpenGitButler={props.onOpenGitButler}
      />
    </SidebarProvider>
  );
}

interface InnerProps {
  connectionStatus: ConnectionStatus;
  projects: Project[];
  isOpen: boolean;
  onClose: () => void;
  onAddProject: () => void;
  hasExtensionUpdates?: boolean;
  onOpenSettings: () => void;
  onOpenGitButler: () => void;
}

function SidebarInner({ connectionStatus, projects, isOpen, onClose, onAddProject, hasExtensionUpdates, onOpenSettings, onOpenGitButler }: InnerProps) {
  const { dnd, activeProjectId, activeSessionId, onSetProjectActive } = useSidebarContext();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deactivatedExpanded, setDeactivatedExpanded] = useState(false);

  const activeProjects = projects.filter((p) => p.active);
  const deactivatedProjects = projects.filter((p) => !p.active);

  // Auto-expand active projects when they appear
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      activeProjects.forEach((p) => next.add(p.id));
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
        <h1>
          Devbench
          <span
            className={`connection-indicator connection-${connectionStatus}`}
            title={
              connectionStatus === "connected"
                ? "Connected to server"
                : connectionStatus === "connecting"
                  ? "Connecting to server\u2026"
                  : "Disconnected from server \u2014 retrying\u2026"
            }
            aria-label={`Server connection: ${connectionStatus}`}
          />
        </h1>
        <div className="sidebar-header-actions">
          <button className="icon-btn" onClick={onOpenGitButler} title="GitButler Dashboard (Ctrl+Shift+F)"><Icon name="git-graph" size={16} /></button>
          <button className={`icon-btn${hasExtensionUpdates ? " has-extension-updates" : ""}`} onClick={onOpenSettings} title={hasExtensionUpdates ? "Settings — extension updates available" : "Settings"}><Icon name="settings" size={16} /></button>
          <button className="icon-btn sidebar-close-btn" onClick={onClose} title="Close sidebar"><Icon name="x" size={16} /></button>
        </div>
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

        {activeProjects.map((project, projectIndex) => (
          <ProjectGroup
            key={project.id}
            project={project}
            isExpanded={expanded.has(project.id)}
            projectIndex={projectIndex}
            onToggleExpand={toggleExpand}
          />
        ))}

        {deactivatedProjects.length > 0 && (
          <div className="deactivated-projects-section">
            <div
              className="deactivated-projects-header"
              onClick={() => setDeactivatedExpanded((prev) => !prev)}
            >
              <Icon name={deactivatedExpanded ? "chevron-down" : "chevron-right"} size={14} />
              <span>Deactivated ({deactivatedProjects.length})</span>
            </div>
            {deactivatedExpanded && deactivatedProjects.map((project) => (
              <div key={project.id} className="deactivated-project-item">
                <span className="deactivated-project-name" title={project.path}>{project.name}</span>
                <button
                  className="icon-btn deactivated-project-activate-btn"
                  title="Activate project"
                  onClick={() => onSetProjectActive(project.id, true)}
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
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
