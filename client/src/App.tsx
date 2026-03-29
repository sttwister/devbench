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
  fetchAgentStatuses,
  createProject,
  updateProject,
  deleteProject,
  createSession,
  deleteSession,
  renameSession,
  updateSessionBrowserState,
} from "./api";
import type { Project, Session, SessionType, AgentStatus } from "./api";

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
  const [browserSessions, setBrowserSessions] = useState<Map<number, string>>(new Map());
  const [browserOpenSessions, setBrowserOpenSessions] = useState<Set<number>>(new Set());
  const [viewModeSessions, setViewModeSessions] = useState<Map<number, string>>(new Map());
  const [browserStateInitialized, setBrowserStateInitialized] = useState(false);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({});

  // Is browser open for the current session?
  // Electron: single global toggle synced from main process.
  // Non-Electron: per-session tracking.
  const browserOpenForSession = devbench
    ? browserOpen
    : activeSession
      ? browserOpenSessions.has(activeSession.id)
      : false;

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

  // Poll agent statuses (lightweight, faster than full project refresh)
  useEffect(() => {
    const poll = () => fetchAgentStatuses().then(setAgentStatuses);
    poll();
    const interval = setInterval(poll, 5_000);
    return () => clearInterval(interval);
  }, []);

  // Initialize browser open/view-mode state from DB on first load
  useEffect(() => {
    if (browserStateInitialized || projects.length === 0) return;
    const openSet = new Set<number>();
    const vmMap = new Map<number, string>();
    const bsMap = new Map<number, string>();
    for (const p of projects) {
      for (const s of p.sessions) {
        if (s.browser_open && p.browser_url) {
          openSet.add(s.id);
          bsMap.set(s.id, p.browser_url);
        }
        if (s.view_mode) {
          vmMap.set(s.id, s.view_mode);
        }
      }
    }
    if (openSet.size > 0) setBrowserOpenSessions(openSet);
    if (bsMap.size > 0) setBrowserSessions(bsMap);
    if (vmMap.size > 0) setViewModeSessions(vmMap);
    setBrowserStateInitialized(true);
  }, [projects, browserStateInitialized]);

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
      activeProject.browser_url,
      activeProject.default_view_mode || "desktop",
      activeSession.browser_open,
      activeSession.view_mode
    );
  }, [activeSession?.id, activeProject?.id, activeProject?.browser_url]);

  // ── Push MR URL changes to Electron toolbar ──────────────────────
  useEffect(() => {
    if (!devbench || !activeSession) return;
    const sess = projects
      .flatMap((p) => p.sessions)
      .find((s) => s.id === activeSession.id);
    if (sess) {
      devbench.updateMrUrls(activeSession.id, sess.mr_urls);
    }
  }, [projects, activeSession?.id]);

  // ── Sync browser state from Electron ─────────────────────────────
  useEffect(() => {
    if (!devbench) return;
    return devbench.onBrowserToggled((open) => {
      setBrowserOpen(open);
      // Persist to DB for the current session
      if (activeSession) {
        const vm = viewModeSessions.get(activeSession.id) ?? activeSession.view_mode;
        updateSessionBrowserState(activeSession.id, open, vm).catch(() => {});
      }
    });
  }, [activeSession?.id, viewModeSessions]);

  // ── Sync view mode from Electron toolbar ─────────────────────────
  useEffect(() => {
    if (!devbench) return;
    return devbench.onViewModeChanged((mode) => {
      if (!activeSession) return;
      setViewModeSessions((prev) => {
        const next = new Map(prev);
        next.set(activeSession.id, mode);
        return next;
      });
      updateSessionBrowserState(activeSession.id, browserOpen, mode).catch(() => {});
    });
  }, [activeSession?.id, browserOpen]);

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
          toggleSessionBrowser(activeSession.id);
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

  // ── Per-session browser iframe management ──────────────────────
  const getSessionViewMode = useCallback((sessionId: number): "desktop" | "mobile" => {
    const stored = viewModeSessions.get(sessionId);
    if (stored === "desktop" || stored === "mobile") return stored;
    // Fall back to project default
    const proj = projects.find((p) => p.sessions.some((s) => s.id === sessionId));
    return (proj?.default_view_mode as "desktop" | "mobile") ?? "desktop";
  }, [viewModeSessions, projects]);

  const persistBrowserState = useCallback((sessionId: number, open: boolean, viewMode: string | null) => {
    updateSessionBrowserState(sessionId, open, viewMode).catch((e) =>
      console.error("Failed to persist browser state:", e)
    );
  }, []);

  const toggleSessionBrowser = useCallback((sessionId: number) => {
    setBrowserOpenSessions((prev) => {
      const next = new Set(prev);
      const nowOpen = !next.has(sessionId);
      if (nowOpen) next.add(sessionId);
      else next.delete(sessionId);
      const vm = viewModeSessions.get(sessionId) ?? null;
      persistBrowserState(sessionId, nowOpen, vm);
      return next;
    });
  }, [viewModeSessions, persistBrowserState]);

  const closeSessionBrowser = useCallback((sessionId: number) => {
    setBrowserOpenSessions((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      const vm = viewModeSessions.get(sessionId) ?? null;
      persistBrowserState(sessionId, false, vm);
      return next;
    });
  }, [viewModeSessions, persistBrowserState]);

  const handleViewModeChange = useCallback((sessionId: number, mode: "desktop" | "mobile") => {
    setViewModeSessions((prev) => {
      const next = new Map(prev);
      next.set(sessionId, mode);
      return next;
    });
    const open = browserOpenSessions.has(sessionId);
    persistBrowserState(sessionId, open, mode);
  }, [browserOpenSessions, persistBrowserState]);

  // Register the active session's browser iframe when inline browser is shown
  useEffect(() => {
    if (devbench || !browserOpenForSession || !activeSession || !activeProject?.browser_url) return;
    setBrowserSessions((prev) => {
      if (prev.has(activeSession.id)) return prev;
      const next = new Map(prev);
      next.set(activeSession.id, activeProject.browser_url!);
      return next;
    });
  }, [browserOpenForSession, activeSession?.id, activeProject?.browser_url]);

  // Prune stale sessions from both browser maps
  useEffect(() => {
    const allSessionIds = new Set(
      projects.flatMap((p) => p.sessions.map((s) => s.id))
    );
    setBrowserSessions((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const sid of next.keys()) {
        if (!allSessionIds.has(sid)) { next.delete(sid); changed = true; }
      }
      return changed ? next : prev;
    });
    setBrowserOpenSessions((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const sid of next) {
        if (!allSessionIds.has(sid)) { next.delete(sid); changed = true; }
      }
      return changed ? next : prev;
    });
    setViewModeSessions((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const sid of next.keys()) {
        if (!allSessionIds.has(sid)) { next.delete(sid); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [projects]);

  const cleanupBrowserSession = useCallback((sessionId: number) => {
    setBrowserSessions((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
    setBrowserOpenSessions((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    setViewModeSessions((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  // ── Open MR link in browser pane ──────────────────────────────────
  const handleOpenMrLink = useCallback(
    (session: Session, url: string) => {
      selectSession(session);

      if (devbench) {
        // Electron: navigate the native browser view directly
        devbench.navigateTo(session.id, url, session.mr_urls);
      } else {
        // Non-Electron: GitHub/GitLab block iframe embedding via
        // X-Frame-Options, so always open MR links in a new tab.
        window.open(url, "_blank");
      }
    },
    [selectSession]
  );

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
    default_view_mode?: string;
  }) => {
    try {
      if (editingProject) {
        await updateProject(editingProject.id, {
          name: data.name,
          path: data.path,
          browser_url: data.browser_url || null,
          default_view_mode: data.default_view_mode || "desktop",
        });
      } else {
        await createProject(data.name, data.path, data.browser_url, data.default_view_mode);
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
        cleanupBrowserSession(s.id);
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
    type: SessionType
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
    cleanupBrowserSession(id);
    await deleteSession(id);
    await loadProjects();
  };

  const handleNewSessionFromPopup = useCallback(
    (type: SessionType) => {
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
      cleanupBrowserSession(sessionId);
      await loadProjects();
    },
    [activeSession, loadProjects, cleanupBrowserSession]
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
    cleanupBrowserSession(id);
    await deleteSession(id);
    await loadProjects();
  }, [activeSession, loadProjects, cleanupBrowserSession]);

  // ── Render ───────────────────────────────────────────────────────
  const showInlineBrowser =
    !devbench && browserOpenForSession && !!activeProject?.browser_url;
  const isDragging = dragX !== null;

  return (
    <div className="app">
      <div
        className={`sidebar-backdrop ${sidebarOpen ? "visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <Sidebar
        projects={projects}
        agentStatuses={agentStatuses}
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
        onOpenMrLink={(session, url) => {
          handleOpenMrLink(session, url);
          setSidebarOpen(false);
        }}
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
              onSessionRenamed={(newName) => {
                setActiveSession((prev) => prev ? { ...prev, name: newName } : prev);
                loadProjects();
              }}
              onMrLinkFound={() => loadProjects()}
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
                    className={`icon-btn browser-toggle ${browserOpenForSession ? "active" : ""}`}
                    onClick={() => devbench.toggleBrowser()}
                    title={
                      browserOpenForSession
                        ? "Close browser (Ctrl+Shift+B)"
                        : "Open browser (Ctrl+Shift+B)"
                    }
                  >
                    🌐
                  </button>
                ) : activeProject?.browser_url ? (
                  <button
                    className={`icon-btn browser-toggle ${browserOpenForSession ? "active" : ""}`}
                    onClick={() => toggleSessionBrowser(activeSession.id)}
                    title={
                      browserOpenForSession
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
              <div
                className={`pane-resizer ${inlineDragging ? "active" : ""}`}
                onPointerDown={handleInlineResizerDown}
                onPointerMove={handleInlineResizerMove}
                onPointerUp={handleInlineResizerUp}
              />
            )}
            {browserSessions.size > 0 && (
              <div
                className="browser-stack"
                style={showInlineBrowser ? undefined : { display: "none" }}
              >
                {Array.from(browserSessions).map(([sid, initialUrl]) => {
                  const proj = projects.find((p) =>
                    p.sessions.some((s) => s.id === sid)
                  );
                  return (
                    <BrowserPane
                      key={sid}
                      url={initialUrl}
                      defaultUrl={proj?.browser_url ?? initialUrl}
                      viewMode={getSessionViewMode(sid)}
                      visible={showInlineBrowser && sid === activeSession?.id}
                      onClose={() => closeSessionBrowser(sid)}
                      onViewModeChange={(mode) => handleViewModeChange(sid, mode)}
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
                  );
                })}
              </div>
            )}
            {devbench && browserOpenForSession && (
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
