import { useState } from "react";
import type { Project } from "../api";
import { SESSION_TYPES_LIST } from "../api";
import SessionItem from "./SessionItem";
import { useSidebarContext } from "./SidebarContext";
import Icon from "./Icon";

interface Props {
  project: Project;
  isExpanded: boolean;
  projectIndex: number;
  onToggleExpand: (projectId: number) => void;
}

export default function ProjectGroup({
  project,
  isExpanded,
  projectIndex,
  onToggleExpand,
}: Props) {
  const {
    activeSessionId,
    activeProjectId,
    dnd,
    onSelectProject,
    onEditProject,
    onDeleteProject,
    onNewSession,
    onShowArchivedSessions,
  } = useSidebarContext();

  const [newSessionOpen, setNewSessionOpen] = useState(false);

  const dropClass = dnd.getProjectDropClass(projectIndex);
  const isDragSource = dnd.activeDrag?.kind === "project" && dnd.activeDrag.id === project.id;

  return (
    <div
      className={`project-group ${dropClass} ${isDragSource ? "drag-source" : ""}`}
      data-project-drag-id={project.id}
      draggable
      onDragStart={(e) => dnd.handleProjectDragStart(e, project.id)}
      onDragEnd={dnd.handleDragEnd}
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
          onMouseDown={dnd.handleGripMouseDown}
          onTouchStart={(e) => dnd.handleTouchGripStart(e, "project", project.id)}
          title="Drag to reorder"
        ><Icon name="grip-vertical" size={14} /></span>
        <span className="project-toggle">
          <Icon name={isExpanded ? "chevron-down" : "chevron-right"} size={14} />
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
            <Icon name="plus" size={14} />
          </button>
          <button
            className="icon-btn"
            title="Archived sessions"
            onClick={(e) => {
              e.stopPropagation();
              onShowArchivedSessions(project.id);
            }}
          >
            <Icon name="archive" size={14} />
          </button>
          <button
            className="icon-btn"
            title="Edit project"
            onClick={(e) => {
              e.stopPropagation();
              onEditProject(project);
            }}
          >
            <Icon name="pencil" size={14} />
          </button>
          <button
            className="icon-btn danger"
            title="Delete project"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteProject(project.id);
            }}
          >
            <Icon name="x" size={14} />
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
              <Icon name={st.icon} size={14} /> {st.label}
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
              sessionIndex={sessionIndex}
              totalSessions={project.sessions.length}
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
