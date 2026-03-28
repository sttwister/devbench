import { useState, useEffect } from "react";
import type { Project, Session } from "../api";

interface Props {
  projects: Project[];
  activeSessionId: number | null;
  onAddProject: () => void;
  onDeleteProject: (id: number) => void;
  onNewSession: (projectId: number, type: "terminal" | "claude" | "pi" | "codex") => void;
  onDeleteSession: (id: number) => void;
  onSelectSession: (session: Session) => void;
}

export default function Sidebar({
  projects,
  activeSessionId,
  onAddProject,
  onDeleteProject,
  onNewSession,
  onDeleteSession,
  onSelectSession,
}: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [newSessionFor, setNewSessionFor] = useState<number | null>(null);

  // Auto-expand projects when they appear
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      projects.forEach((p) => next.add(p.id));
      return next;
    });
  }, [projects]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Devbench</h1>
      </div>

      <div className="sidebar-content">
        {projects.length === 0 && (
          <div className="sidebar-empty">No projects yet. Add one below.</div>
        )}

        {projects.map((project) => (
          <div key={project.id} className="project-group">
            {/* Project header */}
            <div
              className="project-header"
              onClick={() => toggle(project.id)}
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
                {project.sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`session-item ${
                      activeSessionId === session.id ? "active" : ""
                    }`}
                    onClick={() => onSelectSession(session)}
                  >
                    <span className="session-icon">
                      {session.type === "claude" ? "🤖" : session.type === "pi" ? "🥧" : session.type === "codex" ? "🧬" : "🖥"}
                    </span>
                    <span className="session-name">{session.name}</span>
                    <button
                      className="icon-btn danger small"
                      title="Kill session"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
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
      </div>
    </aside>
  );
}
