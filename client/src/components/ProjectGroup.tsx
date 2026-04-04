import { useState, useRef, useEffect, useCallback } from "react";
import type { Project } from "../api";
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
    onShowNewSessionPopup,
    onShowArchivedSessions,
    onOpenProjectDashboard,
    onSetProjectActive,
  } = useSidebarContext();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const closeAndRun = useCallback((fn: () => void) => {
    setMenuOpen(false);
    fn();
  }, []);

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
            title="New session (Ctrl+Shift+N)"
            onClick={(e) => {
              e.stopPropagation();
              onShowNewSessionPopup(project.id);
            }}
          >
            <Icon name="plus" size={14} />
          </button>
          <div className="project-menu-wrapper" ref={menuRef}>
            <button
              className={`icon-btn${menuOpen ? " active" : ""}`}
              title="More actions"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((prev) => !prev);
              }}
            >
              <Icon name="ellipsis-vertical" size={14} />
            </button>
            {menuOpen && (
              <div className="project-menu">
                <button
                  className="project-menu-item"
                  onClick={(e) => { e.stopPropagation(); closeAndRun(() => onOpenProjectDashboard(project.id)); }}
                >
                  <Icon name="git-graph" size={13} />
                  <span>GitButler branches</span>
                </button>
                <button
                  className="project-menu-item"
                  onClick={(e) => { e.stopPropagation(); closeAndRun(() => onShowArchivedSessions(project.id)); }}
                >
                  <Icon name="archive" size={13} />
                  <span>Archived sessions</span>
                </button>
                <button
                  className="project-menu-item"
                  onClick={(e) => { e.stopPropagation(); closeAndRun(() => onEditProject(project)); }}
                >
                  <Icon name="pencil" size={13} />
                  <span>Edit project</span>
                </button>
                <button
                  className="project-menu-item"
                  onClick={(e) => { e.stopPropagation(); closeAndRun(() => onSetProjectActive(project.id, false)); }}
                >
                  <Icon name="eye-off" size={13} />
                  <span>Deactivate project</span>
                </button>
                <div className="project-menu-divider" />
                <button
                  className="project-menu-item danger"
                  onClick={(e) => { e.stopPropagation(); closeAndRun(() => onDeleteProject(project.id)); }}
                >
                  <Icon name="x" size={13} />
                  <span>Delete project</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

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
