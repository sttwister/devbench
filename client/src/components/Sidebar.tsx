import { useState, useEffect, useRef } from "react";
import type { Project, Session, SessionType, AgentStatus } from "../api";
import { getMrLabel } from "../api";

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
}: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [newSessionFor, setNewSessionFor] = useState<number | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Auto-expand projects when they appear
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      projects.forEach((p) => next.add(p.id));
      return next;
    });
  }, [projects]);

  useEffect(() => {
    if (renamingSessionId !== null && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingSessionId]);

  const commitRename = (sessionId: number) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      onRenameSession(sessionId, trimmed);
    }
    setRenamingSessionId(null);
  };

  const cancelRename = () => {
    setRenamingSessionId(null);
  };

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <aside className={`sidebar ${isOpen ? "open" : ""}`}>
      <div className="sidebar-header">
        <h1>Devbench</h1>
        <button className="icon-btn sidebar-close-btn" onClick={onClose} title="Close sidebar">✕</button>
      </div>

      <div className="sidebar-content">
        {projects.length === 0 && (
          <div className="sidebar-empty">No projects yet. Add one below.</div>
        )}

        {projects.map((project) => (
          <div key={project.id} className="project-group">
            {/* Project header */}
            <div
              className={`project-header ${
                activeProjectId === project.id && activeSessionId === null
                  ? "active"
                  : ""
              }`}
              onClick={() => {
                toggle(project.id);
                onSelectProject(project.id);
              }}
            >
              <span className="project-toggle">
                {expanded.has(project.id) ? "▼" : "▶"}
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
                    setNewSessionFor(
                      newSessionFor === project.id ? null : project.id
                    );
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
            {newSessionFor === project.id && (
              <div className="new-session-menu">
                <button
                  onClick={() => {
                    onNewSession(project.id, "terminal");
                    setNewSessionFor(null);
                  }}
                >
                  🖥 Terminal
                </button>
                <button
                  onClick={() => {
                    onNewSession(project.id, "claude");
                    setNewSessionFor(null);
                  }}
                >
                  🤖 Claude Code
                </button>
                <button
                  onClick={() => {
                    onNewSession(project.id, "pi");
                    setNewSessionFor(null);
                  }}
                >
                  🥧 Pi
                </button>
                <button
                  onClick={() => {
                    onNewSession(project.id, "codex");
                    setNewSessionFor(null);
                  }}
                >
                  🧬 Codex
                </button>
              </div>
            )}

            {/* Session list */}
            {expanded.has(project.id) && (
              <div className="session-list">
                {project.sessions.map((session) => {
                  const isOrphaned = orphanedSessionIds.has(session.id);
                  return (
                  <div
                    key={session.id}
                    className={`session-item ${
                      activeSessionId === session.id ? "active" : ""
                    }${isOrphaned ? " orphaned" : ""}`}
                    onClick={() => onSelectSession(session)}
                  >
                    <div className="session-row">
                      <span className={`session-icon${isOrphaned ? " dimmed" : ""}`}>
                        {session.type === "claude" ? "🤖" : session.type === "pi" ? "🥧" : session.type === "codex" ? "🧬" : "🖥"}
                      </span>
                      {!isOrphaned && agentStatuses[session.id] && (
                        <span
                          className={`agent-status-dot ${agentStatuses[session.id]}`}
                          title={agentStatuses[session.id] === "working" ? "Working" : "Waiting for input"}
                        />
                      )}
                      {renamingSessionId === session.id ? (
                        <input
                          ref={renameInputRef}
                          className="session-rename-input"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(session.id);
                            else if (e.key === "Escape") cancelRename();
                            e.stopPropagation();
                          }}
                          onBlur={() => commitRename(session.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className={`session-name${isOrphaned ? " dimmed" : ""}`}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setRenamingSessionId(session.id);
                            setRenameValue(session.name);
                          }}
                        >
                          {session.name}
                        </span>
                      )}
                      {isOrphaned && (
                        <button
                          className="icon-btn revive small"
                          title="Revive session"
                          onClick={(e) => {
                            e.stopPropagation();
                            onReviveSession(session.id);
                          }}
                        >
                          🔄
                        </button>
                      )}
                      <button
                        className="icon-btn danger small"
                        title={isOrphaned ? "Remove session" : "Kill session"}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {session.mr_urls.length > 0 && (
                      <div className="session-meta" onClick={(e) => e.stopPropagation()}>
                        {session.mr_urls.map((url) => (
                          <button
                            key={url}
                            className="session-mr-link"
                            title={url}
                            onClick={() => onOpenMrLink(session, url)}
                          >
                            {getMrLabel(url)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  );
                })}
                {project.sessions.length === 0 && (
                  <div className="no-sessions">No sessions</div>
                )}
              </div>
            )}
          </div>
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
