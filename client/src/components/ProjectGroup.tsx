import { useState } from "react";
import type { Project, Session, SessionType, AgentStatus } from "../api";
import { SESSION_TYPES_LIST } from "../api";
import SessionItem from "./SessionItem";

interface Props {
  project: Project;
  activeSessionId: number | null;
  activeProjectId: number | null;
  agentStatuses: Record<string, AgentStatus>;
  orphanedSessionIds: Set<number>;
  isExpanded: boolean;
  dropClass: string;
  isDragSource: boolean;
  renamingSessionId: number | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onCommitRename: (sessionId: number) => void;
  onCancelRename: () => void;
  onStartRename: (sessionId: number, currentName: string) => void;
  onToggleExpand: (projectId: number) => void;
  onSelectProject: (projectId: number) => void;
  onSelectSession: (session: Session) => void;
  onEditProject: (project: Project) => void;
  onDeleteProject: (id: number) => void;
  onNewSession: (projectId: number, type: SessionType) => void;
  onDeleteSession: (id: number) => void;
  onReviveSession: (id: number) => void;
  onShowArchivedSessions: (projectId: number) => void;
  onOpenMrLink: (session: Session, url: string) => void;
  // DnD handlers
  onGripMouseDown: (e: React.MouseEvent) => void;
  onTouchGripStart: (e: React.TouchEvent, kind: "project" | "session", id: number, projectId?: number) => void;
  onProjectDragStart: (e: React.DragEvent, projectId: number) => void;
  onSessionDragStart: (e: React.DragEvent, sessionId: number, projectId: number) => void;
  onDragEnd: () => void;
  getSessionDropClass: (projectId: number, index: number, totalSessions: number) => string;
  activeDragSessionId: number | null;
}

export default function ProjectGroup({
  project,
  activeSessionId,
  activeProjectId,
  agentStatuses,
  orphanedSessionIds,
  isExpanded,
  dropClass,
  isDragSource,
  renamingSessionId,
  renameValue,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onToggleExpand,
  onSelectProject,
  onSelectSession,
  onEditProject,
  onDeleteProject,
  onNewSession,
  onDeleteSession,
  onReviveSession,
  onShowArchivedSessions,
  onOpenMrLink,
  onGripMouseDown,
  onTouchGripStart,
  onProjectDragStart,
  onSessionDragStart,
  onDragEnd,
  getSessionDropClass,
  activeDragSessionId,
}: Props) {
  const [newSessionOpen, setNewSessionOpen] = useState(false);

  return (
    <div
      className={`project-group ${dropClass} ${isDragSource ? "drag-source" : ""}`}
      data-project-drag-id={project.id}
      draggable
      onDragStart={(e) => onProjectDragStart(e, project.id)}
      onDragEnd={onDragEnd}
    >
      {/* Project header */}
      <div
        className={`project-header ${
          activeProjectId === project.id && activeSessionId === null
            ? "active"
            : ""
        }`}
        onClick={() => {
          onToggleExpand(project.id);
          onSelectProject(project.id);
        }}
      >
        <span
          className="drag-handle"
          onMouseDown={onGripMouseDown}
          onTouchStart={(e) => onTouchGripStart(e, "project", project.id)}
          title="Drag to reorder"
        >⠿</span>
        <span className="project-toggle">
          {isExpanded ? "▼" : "▶"}
        </span>
        <span className="project-name" title={project.path}>
          {project.name}
        </span>
        <div className="project-actions">
          <button
            className="icon-btn"
            title="New session"
            onClick={(e) => {
              e.stopPropagation();
              setNewSessionOpen(!newSessionOpen);
            }}
          >
            +
          </button>
          <button
            className="icon-btn"
            title="Archived sessions"
            onClick={(e) => {
              e.stopPropagation();
              onShowArchivedSessions(project.id);
            }}
          >
            🗄
          </button>
          <button
            className="icon-btn"
            title="Edit project"
            onClick={(e) => {
              e.stopPropagation();
              onEditProject(project);
            }}
          >
            ✎
          </button>
          <button
            className="icon-btn danger"
            title="Delete project"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteProject(project.id);
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* New session picker */}
      {newSessionOpen && (
        <div className="new-session-menu">
          {SESSION_TYPES_LIST.map((st) => (
            <button
              key={st.type}
              onClick={() => {
                onNewSession(project.id, st.type);
                setNewSessionOpen(false);
              }}
            >
              {st.icon} {st.label}
            </button>
          ))}
        </div>
      )}

      {/* Session list */}
      {isExpanded && (
        <div className="session-list">
          {project.sessions.map((session, sessionIndex) => (
            <SessionItem
              key={session.id}
              session={session}
              projectId={project.id}
              isActive={activeSessionId === session.id}
              isOrphaned={orphanedSessionIds.has(session.id)}
              agentStatus={agentStatuses[session.id]}
              dropClass={getSessionDropClass(project.id, sessionIndex, project.sessions.length)}
              isDragSource={activeDragSessionId === session.id}
              renamingSessionId={renamingSessionId}
              renameValue={renameValue}
              onRenameValueChange={onRenameValueChange}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
              onStartRename={onStartRename}
              onSelectSession={onSelectSession}
              onDeleteSession={onDeleteSession}
              onReviveSession={onReviveSession}
              onOpenMrLink={onOpenMrLink}
              onGripMouseDown={onGripMouseDown}
              onTouchGripStart={onTouchGripStart}
              onDragStart={onSessionDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
          {project.sessions.length === 0 && (
            <div className="no-sessions">No sessions</div>
          )}
        </div>
      )}
    </div>
  );
}
