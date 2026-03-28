import { useState, useEffect, useCallback, useMemo } from "react";
import Sidebar from "./components/Sidebar";
import TerminalPane from "./components/TerminalPane";
import {
  fetchProjects,
  createProject,
  deleteProject,
  createSession,
  deleteSession,
} from "./api";
import type { Project, Session } from "./api";

const devbench = window.devbench;

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await fetchProjects());
    } catch (e) {
      console.error("Failed to load projects:", e);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const allSessions = useMemo(
    () => projects.flatMap((p) => p.sessions),
    [projects]
  );

  const activeProject = useMemo(() => {
    if (!activeSession) return null;
    return projects.find((p) => p.id === activeSession.project_id) ?? null;
  }, [projects, activeSession]);

  // ── Notify Electron of session changes ───────────────────────────
  useEffect(() => {
    if (!devbench || !activeSession || !activeProject) return;
    devbench.sessionChanged(
      activeSession.id,
      activeProject.id,
      activeProject.browser_url
    );
  }, [activeSession?.id, activeProject?.id, activeProject?.browser_url]);

  // ── Sync browser state from Electron ─────────────────────────────
  useEffect(() => {
    if (!devbench) return;
    return devbench.onBrowserToggled((open) => setBrowserOpen(open));
  }, []);

  useEffect(() => {
    if (!devbench) return;
    return devbench.onProjectsChanged(() => loadProjects());
  }, [loadProjects]);

  // ── Shortcut handling ────────────────────────────────────────────
  const navigateSession = useCallback(
    (delta: number) => {
      if (allSessions.length === 0) return;
      const curIdx = activeSession
        ? allSessions.findIndex((s) => s.id === activeSession.id)
        : -1;
      let next: number;
      if (delta > 0) {
        next = curIdx < 0 ? 0 : Math.min(curIdx + 1, allSessions.length - 1);
      } else {
        next =
          curIdx < 0 ? allSessions.length - 1 : Math.max(curIdx - 1, 0);
      }
      setActiveSession(allSessions[next]);
    },
    [allSessions, activeSession]
  );

  useEffect(() => {
    if (!devbench) return;
    return devbench.onShortcut((action) => {
      switch (action) {
        case "next-session":
          navigateSession(1);
          break;
        case "prev-session":
          navigateSession(-1);
          break;
        case "toggle-browser":
          if (activeSession) devbench.toggleBrowser();
          break;
      }
    });
  }, [navigateSession, activeSession]);

  useEffect(() => {
    if (devbench) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      if (e.key === "J") {
        e.preventDefault();
        navigateSession(1);
      } else if (e.key === "K") {
        e.preventDefault();
        navigateSession(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateSession]);

  // ── Resizer ──────────────────────────────────────────────────────
  const handleResizerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!devbench) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDragX(e.clientX);
      devbench.resizeStart();
    },
    []
  );

  const handleResizerPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.buttons === 0) return;
      setDragX(e.clientX);
    },
    []
  );

  const handleResizerPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!devbench) return;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      devbench.resizeEnd(e.clientX);
      setDragX(null);
    },
    []
  );

  // ── Project / session CRUD ───────────────────────────────────────
  const handleAddProject = async () => {
    const path = prompt("Project path (absolute):");
    if (!path) return;
    const name = prompt("Project name:", path.split("/").pop() || "project");
    if (!name) return;
    const browserUrl = prompt(
      "Default browser URL (optional, e.g. http://devbox:8000):"
    );
    try {
      await createProject(name, path, browserUrl || undefined);
      await loadProjects();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDeleteProject = async (id: number) => {
    if (!confirm("Delete this project and all its sessions?")) return;
    const project = projects.find((p) => p.id === id);
    if (project) {
      for (const s of project.sessions) {
        devbench?.sessionDestroyed(s.id);
      }
    }
    if (
      activeSession &&
      project?.sessions.some((s) => s.id === activeSession.id)
    ) {
      setActiveSession(null);
    }
    await deleteProject(id);
    await loadProjects();
  };

  const handleNewSession = async (
    projectId: number,
    type: "terminal" | "claude" | "pi" | "codex"
  ) => {
    const label = type === "claude" ? "Claude Code" : type === "pi" ? "Pi" : type === "codex" ? "Codex" : "Terminal";
    const existing =
      projects
        .find((p) => p.id === projectId)
        ?.sessions.filter((s) => s.type === type).length ?? 0;
    const name = `${label} ${existing + 1}`;
    try {
      const session = await createSession(projectId, name, type);
      await loadProjects();
      setActiveSession(session);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDeleteSession = async (id: number) => {
    if (!confirm("Kill this session?")) return;
    if (activeSession?.id === id) setActiveSession(null);
    devbench?.sessionDestroyed(id);
    await deleteSession(id);
    await loadProjects();
  };

  // ── Render ───────────────────────────────────────────────────────
  const isDragging = dragX !== null;

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        activeSessionId={activeSession?.id ?? null}
        onAddProject={handleAddProject}
        onDeleteProject={handleDeleteProject}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onSelectSession={setActiveSession}
      />
      <main className="main-content">
        {activeSession ? (
          <div className="session-area">
            <TerminalPane
              key={activeSession.id}
              sessionId={activeSession.id}
              sessionName={activeSession.name}
              sessionType={activeSession.type}
              headerActions={
                devbench ? (
                  <button
                    className={`icon-btn browser-toggle ${browserOpen ? "active" : ""}`}
                    onClick={() => devbench.toggleBrowser()}
                    title={
                      browserOpen
                        ? "Close browser (Ctrl+Shift+B)"
                        : "Open browser (Ctrl+Shift+B)"
                    }
                  >
                    🌐
                  </button>
                ) : undefined
              }
            />
            {devbench && browserOpen && (
              <div
                className={`pane-resizer ${isDragging ? "active" : ""}`}
                onPointerDown={handleResizerPointerDown}
                onPointerMove={handleResizerPointerMove}
                onPointerUp={handleResizerPointerUp}
              />
            )}
            {isDragging && (
              <div
                className="resize-preview-line"
                style={{ left: dragX }}
              />
            )}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-content">
              <h2>Devbench</h2>
              <p>
                Select a session from the sidebar, or create a new one to get
                started.
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
