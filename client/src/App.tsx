import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Sidebar from "./components/Sidebar";
import TerminalPane from "./components/TerminalPane";
import BrowserPane from "./components/BrowserPane";
import ProjectFormModal from "./components/ProjectFormModal";
import NewSessionPopup from "./components/NewSessionPopup";
import KillSessionPopup from "./components/KillSessionPopup";
import RenameSessionPopup from "./components/RenameSessionPopup";
import ShortcutsHelpPopup from "./components/ShortcutsHelpPopup";
import {
  fetchProjects,
  createProject,
  updateProject,
  deleteProject,
  createSession,
  deleteSession,
  renameSession,
} from "./api";
import type { Project, Session } from "./api";

const devbench = window.devbench;

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [newSessionPopupOpen, setNewSessionPopupOpen] = useState(false);
  const [killSessionPopupOpen, setKillSessionPopupOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [renameSessionPopupOpen, setRenameSessionPopupOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [inlineSplitPercent, setInlineSplitPercent] = useState(50);
  const [inlineDragging, setInlineDragging] = useState(false);
  const sessionAreaRef = useRef<HTMLDivElement>(null);

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

  // Poll for project updates (catches background session deaths)
  useEffect(() => {
    const interval = setInterval(loadProjects, 10_000);
    return () => clearInterval(interval);
  }, [loadProjects]);

  const activeProject = useMemo(() => {
    if (activeProjectId === null) return null;
    return projects.find((p) => p.id === activeProjectId) ?? null;
  }, [projects, activeProjectId]);

  // Navigation items: sessions for projects that have them, project
  // placeholders for empty ones — mirrors sidebar order.
  type NavItem =
    | { kind: "session"; session: Session; projectId: number }
    | { kind: "project"; projectId: number };

  const navItems = useMemo<NavItem[]>(
    () =>
      projects.flatMap((p): NavItem[] =>
        p.sessions.length > 0
          ? p.sessions.map((s) => ({ kind: "session", session: s, projectId: p.id }))
          : [{ kind: "project", projectId: p.id }]
      ),
    [projects]
  );

  const selectSession = useCallback(
    (session: Session) => {
      setActiveSession(session);
      setActiveProjectId(session.project_id);
    },
    []
  );

  const selectProject = useCallback(
    (projectId: number) => {
      setActiveSession(null);
      setActiveProjectId(projectId);
    },
    []
  );

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
  const navigate = useCallback(
    (delta: number) => {
      if (navItems.length === 0) return;
      const curIdx = navItems.findIndex((item) => {
        if (activeSession && item.kind === "session")
          return item.session.id === activeSession.id;
        if (!activeSession && activeProjectId !== null && item.kind === "project")
          return item.projectId === activeProjectId;
        return false;
      });
      let next: number;
      if (delta > 0) {
        next = curIdx < 0 ? 0 : Math.min(curIdx + 1, navItems.length - 1);
      } else {
        next = curIdx < 0 ? navItems.length - 1 : Math.max(curIdx - 1, 0);
      }
      const item = navItems[next];
      if (item.kind === "session") {
        selectSession(item.session);
      } else {
        selectProject(item.projectId);
      }
    },
    [navItems, activeSession, activeProjectId, selectSession, selectProject]
  );

  useEffect(() => {
    if (!devbench) return;
    return devbench.onShortcut((action) => {
      switch (action) {
        case "next-session":
          navigate(1);
          break;
        case "prev-session":
          navigate(-1);
          break;
        case "toggle-browser":
          if (activeSession) devbench.toggleBrowser();
          break;
        case "new-session":
          if (activeProject) setNewSessionPopupOpen(true);
          break;
        case "kill-session":
          if (activeSession) setKillSessionPopupOpen(true);
          break;
        case "rename-session":
          if (activeSession) setRenameSessionPopupOpen(true);
          break;
        case "show-shortcuts":
          setShortcutsHelpOpen(true);
          break;
      }
    });
  }, [navigate, activeSession, activeProject]);

  useEffect(() => {
    if (devbench) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      if (e.key === "J") {
        e.preventDefault();
        navigate(1);
      } else if (e.key === "K") {
        e.preventDefault();
        navigate(-1);
      } else if (e.key === "N") {
        e.preventDefault();
        if (activeProject) setNewSessionPopupOpen(true);
      } else if (e.key === "X") {
        e.preventDefault();
        if (activeSession) setKillSessionPopupOpen(true);
      } else if (e.key === "R") {
        e.preventDefault();
        if (activeSession) setRenameSessionPopupOpen(true);
      } else if (e.key === "B") {
        e.preventDefault();
        if (activeSession && activeProject?.browser_url) {
          setBrowserOpen((o) => !o);
        }
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, activeProject, activeSession]);

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

  // ── Inline browser resizer (non-Electron) ────────────────────────
  const handleInlineResizerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setInlineDragging(true);
  }, []);

  const handleInlineResizerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0 || !sessionAreaRef.current) return;
    const rect = sessionAreaRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = (x / rect.width) * 100;
    setInlineSplitPercent(Math.max(20, Math.min(80, pct)));
  }, []);

  const handleInlineResizerUp = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setInlineDragging(false);
  }, []);

  // ── Project / session CRUD ───────────────────────────────────────
  const handleAddProject = () => {
    setEditingProject(null);
    setProjectFormOpen(true);
  };

  const handleEditProject = (project: Project) => {
    setEditingProject(project);
    setProjectFormOpen(true);
  };

  const handleProjectFormSubmit = async (data: {
    name: string;
    path: string;
    browser_url?: string;
  }) => {
    try {
      if (editingProject) {
        await updateProject(editingProject.id, {
          name: data.name,
          path: data.path,
          browser_url: data.browser_url || null,
        });
      } else {
        await createProject(data.name, data.path, data.browser_url);
      }
      setProjectFormOpen(false);
      setEditingProject(null);
      await loadProjects();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleProjectFormCancel = () => {
    setProjectFormOpen(false);
    setEditingProject(null);
  };

  const handleDeleteProject = async (id: number) => {
    if (!confirm("Delete this project and all its sessions?")) return;
    const project = projects.find((p) => p.id === id);
    if (project) {
      for (const s of project.sessions) {
        devbench?.sessionDestroyed(s.id);
      }
    }
    if (activeProjectId === id) {
      setActiveSession(null);
      setActiveProjectId(null);
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
      selectSession(session);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleRenameSession = async (id: number, name: string) => {
    try {
      await renameSession(id, name);
      await loadProjects();
      if (activeSession?.id === id) {
        setActiveSession((prev) => (prev ? { ...prev, name } : prev));
      }
    } catch (e: any) {
      console.error("Failed to rename session:", e);
    }
  };

  const handleDeleteSession = async (id: number) => {
    if (!confirm("Kill this session?")) return;
    if (activeSession?.id === id) setActiveSession(null);
    // keep activeProjectId so user stays on the project
    devbench?.sessionDestroyed(id);
    await deleteSession(id);
    await loadProjects();
  };

  const handleNewSessionFromPopup = useCallback(
    (type: "terminal" | "claude" | "pi" | "codex") => {
      if (activeProject) {
        handleNewSession(activeProject.id, type);
      }
      setNewSessionPopupOpen(false);
    },
    [activeProject, handleNewSession]
  );

  const handleSessionEnded = useCallback(
    async (sessionId: number) => {
      if (activeSession?.id === sessionId) {
        setActiveSession(null);
      }
      devbench?.sessionDestroyed(sessionId);
      await loadProjects();
    },
    [activeSession, loadProjects]
  );

  const handleRenameSessionConfirm = useCallback(
    async (newName: string) => {
      if (!activeSession) return;
      setRenameSessionPopupOpen(false);
      await handleRenameSession(activeSession.id, newName);
    },
    [activeSession, handleRenameSession]
  );

  const handleKillSessionConfirm = useCallback(async () => {
    if (!activeSession) return;
    const id = activeSession.id;
    setActiveSession(null);
    // keep activeProjectId so user can immediately Ctrl+Shift+N
    setKillSessionPopupOpen(false);
    devbench?.sessionDestroyed(id);
    await deleteSession(id);
    await loadProjects();
  }, [activeSession, loadProjects]);

  // ── Render ───────────────────────────────────────────────────────
  const showInlineBrowser =
    !devbench && browserOpen && !!activeProject?.browser_url;
  const isDragging = dragX !== null;

  return (
    <div className="app">
      <div
        className={`sidebar-backdrop ${sidebarOpen ? "visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <Sidebar
        projects={projects}
        activeSessionId={activeSession?.id ?? null}
        activeProjectId={activeProjectId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onAddProject={handleAddProject}
        onEditProject={handleEditProject}
        onDeleteProject={handleDeleteProject}
        onNewSession={(projectId, type) => {
          handleNewSession(projectId, type);
          setSidebarOpen(false);
        }}
        onDeleteSession={handleDeleteSession}
        onSelectSession={(session) => {
          selectSession(session);
          setSidebarOpen(false);
        }}
        onSelectProject={(projectId) => {
          selectProject(projectId);
          setSidebarOpen(false);
        }}
        onRenameSession={handleRenameSession}
      />
      {projectFormOpen && (
        <ProjectFormModal
          project={editingProject}
          onSubmit={handleProjectFormSubmit}
          onCancel={handleProjectFormCancel}
        />
      )}
      {newSessionPopupOpen && activeProject && (
        <NewSessionPopup
          projectName={activeProject.name}
          onSelect={handleNewSessionFromPopup}
          onClose={() => setNewSessionPopupOpen(false)}
        />
      )}
      {killSessionPopupOpen && activeSession && (
        <KillSessionPopup
          sessionName={activeSession.name}
          onConfirm={handleKillSessionConfirm}
          onCancel={() => setKillSessionPopupOpen(false)}
        />
      )}
      {renameSessionPopupOpen && activeSession && (
        <RenameSessionPopup
          sessionName={activeSession.name}
          onConfirm={handleRenameSessionConfirm}
          onCancel={() => setRenameSessionPopupOpen(false)}
        />
      )}
      {shortcutsHelpOpen && (
        <ShortcutsHelpPopup onClose={() => setShortcutsHelpOpen(false)} />
      )}
      <main className="main-content">
        {activeSession ? (
          <div
            className={`session-area${showInlineBrowser ? " inline-browser" : ""}${inlineDragging ? " inline-dragging" : ""}`}
            ref={sessionAreaRef}
            style={
              showInlineBrowser
                ? ({ "--split": `${inlineSplitPercent}%` } as React.CSSProperties)
                : undefined
            }
          >
            <TerminalPane
              key={activeSession.id}
              sessionId={activeSession.id}
              sessionName={activeSession.name}
              sessionType={activeSession.type}
              onSessionEnded={() => handleSessionEnded(activeSession.id)}
              headerLeft={
                <button
                  className="sidebar-open-btn"
                  onClick={() => setSidebarOpen(true)}
                  title="Open sidebar"
                >
                  ☰
                </button>
              }
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
                ) : activeProject?.browser_url ? (
                  <button
                    className={`icon-btn browser-toggle ${browserOpen ? "active" : ""}`}
                    onClick={() => setBrowserOpen((o) => !o)}
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
            {showInlineBrowser && (
              <>
                <div
                  className={`pane-resizer ${inlineDragging ? "active" : ""}`}
                  onPointerDown={handleInlineResizerDown}
                  onPointerMove={handleInlineResizerMove}
                  onPointerUp={handleInlineResizerUp}
                />
                <BrowserPane
                  url={activeProject!.browser_url!}
                  onClose={() => setBrowserOpen(false)}
                  headerLeft={
                    <button
                      className="sidebar-open-btn"
                      onClick={() => setSidebarOpen(true)}
                      title="Open sidebar"
                    >
                      ☰
                    </button>
                  }
                />
              </>
            )}
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
            <button
              className="sidebar-open-btn empty-state-toggle"
              onClick={() => setSidebarOpen(true)}
              title="Open sidebar"
            >
              ☰
            </button>
            <div className="empty-state-content">
              {activeProject ? (
                <>
                  <h2>{activeProject.name}</h2>
                  <p>
                    No active session. Press{" "}
                    <kbd className="empty-state-kbd">Ctrl+Shift+N</kbd> to
                    create one.
                  </p>
                </>
              ) : (
                <>
                  <h2>Devbench</h2>
                  <p>
                    Select a session from the sidebar, or create a new one to
                    get started.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
