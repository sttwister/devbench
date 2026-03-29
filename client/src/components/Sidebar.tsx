import { useState, useEffect, useRef, useCallback } from "react";
import type { Project, Session, SessionType, AgentStatus } from "../api";
import { getMrLabel, getSessionIcon, SESSION_TYPES_LIST } from "../api";

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

// ── Reorder helper ──────────────────────────────────────────────
function computeReorder(items: number[], fromId: number, toIndex: number): number[] {
  const fromIndex = items.indexOf(fromId);
  if (fromIndex === -1 || fromIndex === toIndex) return items;
  const result = [...items];
  result.splice(fromIndex, 1);
  const adjustedTo = toIndex > fromIndex ? toIndex - 1 : toIndex;
  result.splice(Math.max(0, Math.min(result.length, adjustedTo)), 0, fromId);
  return result;
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
  const [newSessionFor, setNewSessionFor] = useState<number | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── Drag & Drop state ─────────────────────────────────────────
  const [activeDrag, setActiveDrag] = useState<{
    kind: "project" | "session";
    id: number;
    projectId?: number;
  } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    kind: "project" | "session";
    index: number;
    projectId?: number;
  } | null>(null);

  const gripInitiated = useRef(false);
  const sidebarContentRef = useRef<HTMLDivElement>(null);

  // Refs for stable access in touch handlers (avoid stale closures)
  const projectsRef = useRef(projects);
  const onReorderProjectsRef = useRef(onReorderProjects);
  const onReorderSessionsRef = useRef(onReorderSessions);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { onReorderProjectsRef.current = onReorderProjects; }, [onReorderProjects]);
  useEffect(() => { onReorderSessionsRef.current = onReorderSessions; }, [onReorderSessions]);

  // Touch DnD refs
  const touchDragRef = useRef<{
    kind: "project" | "session";
    id: number;
    projectId: number | null;
    ghost: HTMLElement;
    originEl: HTMLElement;
  } | null>(null);

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

  // Reset grip flag on mouseup
  useEffect(() => {
    const reset = () => { gripInitiated.current = false; };
    document.addEventListener("mouseup", reset);
    return () => document.removeEventListener("mouseup", reset);
  }, []);

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

  // ── Drop index computation ────────────────────────────────────
  const computeProjectDropIndex = useCallback((clientY: number): number => {
    const container = sidebarContentRef.current;
    if (!container) return 0;
    const headers = container.querySelectorAll("[data-project-drag-id] > .project-header");
    for (let i = 0; i < headers.length; i++) {
      const rect = headers[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return headers.length;
  }, []);

  const computeSessionDropIndex = useCallback((clientY: number, projectId: number): number => {
    const container = sidebarContentRef.current;
    if (!container) return 0;
    const items = container.querySelectorAll(
      `[data-session-drag-id][data-session-project-id="${projectId}"]`
    );
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return items.length;
  }, []);

  // ── Commit reorder ────────────────────────────────────────────
  const commitDrop = useCallback((
    dragInfo: { kind: string; id: number; projectId?: number | null },
    dropIdx: { kind: string; index: number; projectId?: number }
  ) => {
    const projs = projectsRef.current;
    if (dragInfo.kind === "project") {
      const ids = projs.map(p => p.id);
      const newOrder = computeReorder(ids, dragInfo.id, dropIdx.index);
      if (newOrder.join(",") !== ids.join(",")) {
        onReorderProjectsRef.current(newOrder);
      }
    } else if (dragInfo.kind === "session" && dragInfo.projectId) {
      const project = projs.find(p => p.id === dragInfo.projectId);
      if (!project) return;
      const ids = project.sessions.map(s => s.id);
      const newOrder = computeReorder(ids, dragInfo.id, dropIdx.index);
      if (newOrder.join(",") !== ids.join(",")) {
        onReorderSessionsRef.current(dragInfo.projectId, newOrder);
      }
    }
  }, []);

  // ── DnD cleanup ───────────────────────────────────────────────
  const cleanupDrag = useCallback(() => {
    document.querySelectorAll(".drag-source").forEach(el => el.classList.remove("drag-source"));
    setActiveDrag(null);
    setDropIndicator(null);
    gripInitiated.current = false;
    if (touchDragRef.current) {
      touchDragRef.current.ghost.remove();
      touchDragRef.current.originEl.classList.remove("drag-source");
      touchDragRef.current = null;
    }
  }, []);

  // ── Desktop DnD: grip mousedown ───────────────────────────────
  const handleGripMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    gripInitiated.current = true;
  }, []);

  // ── Desktop DnD: project drag ─────────────────────────────────
  const handleProjectDragStart = useCallback((e: React.DragEvent, projectId: number) => {
    if (!gripInitiated.current) {
      e.preventDefault();
      return;
    }
    gripInitiated.current = false;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    setActiveDrag({ kind: "project", id: projectId });
    requestAnimationFrame(() => {
      (e.target as HTMLElement).classList.add("drag-source");
    });
  }, []);

  // ── Desktop DnD: session drag ─────────────────────────────────
  const handleSessionDragStart = useCallback((e: React.DragEvent, sessionId: number, projectId: number) => {
    if (!gripInitiated.current) {
      e.preventDefault();
      return;
    }
    gripInitiated.current = false;
    e.stopPropagation(); // don't trigger project drag
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    setActiveDrag({ kind: "session", id: sessionId, projectId });
    requestAnimationFrame(() => {
      (e.target as HTMLElement).classList.add("drag-source");
    });
  }, []);

  // ── Desktop DnD: dragover on sidebar content ──────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!activeDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    if (activeDrag.kind === "project") {
      setDropIndicator({ kind: "project", index: computeProjectDropIndex(e.clientY) });
    } else if (activeDrag.kind === "session" && activeDrag.projectId) {
      setDropIndicator({
        kind: "session",
        index: computeSessionDropIndex(e.clientY, activeDrag.projectId),
        projectId: activeDrag.projectId,
      });
    }
  }, [activeDrag, computeProjectDropIndex, computeSessionDropIndex]);

  // ── Desktop DnD: drop ─────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!activeDrag) return;
    // Compute final position from current mouse Y
    let dropIdx;
    if (activeDrag.kind === "project") {
      dropIdx = { kind: "project", index: computeProjectDropIndex(e.clientY) };
    } else if (activeDrag.kind === "session" && activeDrag.projectId) {
      dropIdx = {
        kind: "session",
        index: computeSessionDropIndex(e.clientY, activeDrag.projectId),
        projectId: activeDrag.projectId,
      };
    }
    if (dropIdx) commitDrop(activeDrag, dropIdx);
    cleanupDrag();
  }, [activeDrag, computeProjectDropIndex, computeSessionDropIndex, commitDrop, cleanupDrag]);

  const handleDragEnd = useCallback(() => {
    cleanupDrag();
  }, [cleanupDrag]);

  // ── Touch DnD: start ──────────────────────────────────────────
  const handleTouchGripStart = useCallback((
    e: React.TouchEvent,
    kind: "project" | "session",
    id: number,
    projectId?: number
  ) => {
    const touch = e.touches[0];
    const itemSelector = kind === "project" ? ".project-group" : ".session-item";
    const itemEl = (e.currentTarget as HTMLElement).closest(itemSelector) as HTMLElement;
    if (!itemEl) return;
    e.preventDefault();
    e.stopPropagation();

    // Create ghost
    const ghost = document.createElement("div");
    ghost.className = "touch-drag-ghost";
    // Find a label for the ghost
    const label = kind === "project"
      ? projectsRef.current.find(p => p.id === id)?.name ?? "Project"
      : projectsRef.current.flatMap(p => p.sessions).find(s => s.id === id)?.name ?? "Session";
    ghost.textContent = label;
    ghost.style.position = "fixed";
    ghost.style.left = `${itemEl.getBoundingClientRect().left}px`;
    ghost.style.top = `${touch.clientY - 20}px`;
    ghost.style.width = `${itemEl.offsetWidth}px`;
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "10000";
    document.body.appendChild(ghost);

    itemEl.classList.add("drag-source");
    touchDragRef.current = { kind, id, projectId: projectId ?? null, ghost, originEl: itemEl };
    setActiveDrag({ kind, id, projectId });
  }, []);

  // ── Touch DnD: move & end (document-level listeners) ──────────
  useEffect(() => {
    if (!activeDrag || !touchDragRef.current) return;

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const drag = touchDragRef.current;
      if (!drag) return;

      // Move ghost
      drag.ghost.style.top = `${touch.clientY - 20}px`;

      // Compute drop position
      if (drag.kind === "project") {
        setDropIndicator({ kind: "project", index: computeProjectDropIndex(touch.clientY) });
      } else if (drag.kind === "session" && drag.projectId !== null) {
        setDropIndicator({
          kind: "session",
          index: computeSessionDropIndex(touch.clientY, drag.projectId),
          projectId: drag.projectId,
        });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const drag = touchDragRef.current;
      if (!drag) { cleanupDrag(); return; }

      const lastTouch = e.changedTouches[0];
      let dropIdx;
      if (drag.kind === "project") {
        dropIdx = { kind: "project", index: computeProjectDropIndex(lastTouch.clientY) };
      } else if (drag.kind === "session" && drag.projectId !== null) {
        dropIdx = {
          kind: "session",
          index: computeSessionDropIndex(lastTouch.clientY, drag.projectId),
          projectId: drag.projectId,
        };
      }
      if (dropIdx) {
        commitDrop(
          { kind: drag.kind, id: drag.id, projectId: drag.projectId },
          dropIdx,
        );
      }
      cleanupDrag();
    };

    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [activeDrag, computeProjectDropIndex, computeSessionDropIndex, commitDrop, cleanupDrag]);

  // ── Drop indicator helpers ────────────────────────────────────
  const getProjectDropClass = (index: number): string => {
    if (!dropIndicator || dropIndicator.kind !== "project" || !activeDrag || activeDrag.kind !== "project") return "";
    if (dropIndicator.index === index) return "drop-before";
    if (dropIndicator.index === projects.length && index === projects.length - 1) return "drop-after";
    return "";
  };

  const getSessionDropClass = (projectId: number, index: number, totalSessions: number): string => {
    if (!dropIndicator || dropIndicator.kind !== "session" || dropIndicator.projectId !== projectId) return "";
    if (!activeDrag || activeDrag.kind !== "session") return "";
    if (dropIndicator.index === index) return "drop-before";
    if (dropIndicator.index === totalSessions && index === totalSessions - 1) return "drop-after";
    return "";
  };

  return (
    <aside className={`sidebar ${isOpen ? "open" : ""}`}>
      <div className="sidebar-header">
        <h1>Devbench</h1>
        <button className="icon-btn sidebar-close-btn" onClick={onClose} title="Close sidebar">✕</button>
      </div>

      <div
        className="sidebar-content"
        ref={sidebarContentRef}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {projects.length === 0 && (
          <div className="sidebar-empty">No projects yet. Add one below.</div>
        )}

        {projects.map((project, projectIndex) => (
          <div
            key={project.id}
            className={`project-group ${getProjectDropClass(projectIndex)} ${
              activeDrag?.kind === "project" && activeDrag.id === project.id ? "drag-source" : ""
            }`}
            data-project-drag-id={project.id}
            draggable
            onDragStart={(e) => handleProjectDragStart(e, project.id)}
            onDragEnd={handleDragEnd}
          >
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
              <span
                className="drag-handle"
                onMouseDown={handleGripMouseDown}
                onTouchStart={(e) => handleTouchGripStart(e, "project", project.id)}
                title="Drag to reorder"
              >⠿</span>
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
                {SESSION_TYPES_LIST.map((st) => (
                  <button
                    key={st.type}
                    onClick={() => {
                      onNewSession(project.id, st.type);
                      setNewSessionFor(null);
                    }}
                  >
                    {st.icon} {st.label}
                  </button>
                ))}
              </div>
            )}

            {/* Session list */}
            {expanded.has(project.id) && (
              <div className="session-list">
                {project.sessions.map((session, sessionIndex) => {
                  const isOrphaned = orphanedSessionIds.has(session.id);
                  const sessDropClass = getSessionDropClass(project.id, sessionIndex, project.sessions.length);
                  const isDragSource = activeDrag?.kind === "session" && activeDrag.id === session.id;
                  return (
                  <div
                    key={session.id}
                    className={`session-item ${
                      activeSessionId === session.id ? "active" : ""
                    }${isOrphaned ? " orphaned" : ""} ${sessDropClass} ${isDragSource ? "drag-source" : ""}`}
                    data-session-drag-id={session.id}
                    data-session-project-id={project.id}
                    draggable
                    onDragStart={(e) => handleSessionDragStart(e, session.id, project.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => onSelectSession(session)}
                  >
                    <div className="session-row">
                      <span
                        className="drag-handle session-drag-handle"
                        onMouseDown={handleGripMouseDown}
                        onTouchStart={(e) => handleTouchGripStart(e, "session", session.id, project.id)}
                        onClick={(e) => e.stopPropagation()}
                        title="Drag to reorder"
                      >⠿</span>
                      <span className={`session-icon${isOrphaned ? " dimmed" : ""}`}>
                        {getSessionIcon(session.type)}
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
                      <div className="session-meta">
                        {session.mr_urls.map((url) => (
                          <button
                            key={url}
                            className="session-mr-link"
                            title={url}
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenMrLink(session, url);
                            }}
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
