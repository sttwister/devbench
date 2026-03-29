import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Sidebar from "./components/Sidebar";
import TerminalPane from "./components/TerminalPane";
import BrowserPane from "./components/BrowserPane";
import ProjectFormModal from "./components/ProjectFormModal";
import NewSessionPopup from "./components/NewSessionPopup";
import KillSessionPopup from "./components/KillSessionPopup";
import RenameSessionPopup from "./components/RenameSessionPopup";
import ShortcutsHelpPopup from "./components/ShortcutsHelpPopup";
import ArchivedSessionsPopup from "./components/ArchivedSessionsPopup";
import { useBrowserState } from "./hooks/useBrowserState";
import { useSessionNavigation } from "./hooks/useSessionNavigation";
import { useElectronBridge } from "./hooks/useElectronBridge";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import {
  fetchProjects,
  fetchAgentStatuses,
  fetchOrphanedSessions,
  createProject,
  updateProject,
  deleteProject,
  createSession,
  deleteSession,
  deleteSessionPermanently,
  renameSession,
  reviveSession,
  reorderProjects as apiReorderProjects,
  reorderSessions as apiReorderSessions,
  getSessionIcon,
  getSessionLabel,
} from "./api";
import type { Project, Session, SessionType, AgentStatus } from "./api";

const devbench = window.devbench;

export default function App() {
  // ── Core state ───────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({});
  const [orphanedSessionIds, setOrphanedSessionIds] = useState<Set<number>>(new Set());

  // ── Popup / UI state ─────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [newSessionPopupOpen, setNewSessionPopupOpen] = useState(false);
  const [killSessionPopupOpen, setKillSessionPopupOpen] = useState(false);
  const [renameSessionPopupOpen, setRenameSessionPopupOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [archivedProjectId, setArchivedProjectId] = useState<number | null>(null);

  // ── Electron resizer state ───────────────────────────────────────
  const [browserOpen, setBrowserOpen] = useState(false);
  const [dragX, setDragX] = useState<number | null>(null);

  // ── Inline browser resizer (non-Electron) ────────────────────────
  const [inlineSplitPercent, setInlineSplitPercent] = useState(50);
  const [inlineDragging, setInlineDragging] = useState(false);
  const sessionAreaRef = useRef<HTMLDivElement>(null);

  // ── Derived state ────────────────────────────────────────────────
  const activeProject = useMemo(() => {
    if (activeProjectId === null) return null;
    return projects.find((p) => p.id === activeProjectId) ?? null;
  }, [projects, activeProjectId]);

  // ── Data loading ─────────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    try {
      setProjects(await fetchProjects());
    } catch (e) {
      console.error("Failed to load projects:", e);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // Poll for project updates (catches background session deaths)
  useEffect(() => {
    const interval = setInterval(loadProjects, 10_000);
    return () => clearInterval(interval);
  }, [loadProjects]);

  // Poll agent statuses and orphaned sessions
  useEffect(() => {
    const poll = () => {
      fetchAgentStatuses().then(setAgentStatuses);
      fetchOrphanedSessions().then((ids) => setOrphanedSessionIds(new Set(ids)));
    };
    poll();
    const interval = setInterval(poll, 5_000);
    return () => clearInterval(interval);
  }, []);

  // ── Selection ────────────────────────────────────────────────────
  const selectSession = useCallback((session: Session) => {
    setActiveSession(session);
    setActiveProjectId(session.project_id);
  }, []);

  const selectProject = useCallback((projectId: number) => {
    setActiveSession(null);
    setActiveProjectId(projectId);
  }, []);

  // ── Browser state (consolidated) ─────────────────────────────────
  const browser = useBrowserState(projects);

  const browserOpenForSession = devbench
    ? browserOpen
    : activeSession
      ? browser.isOpen(activeSession.id)
      : false;

  // Register the active session's browser iframe when inline browser is shown
  useEffect(() => {
    if (devbench || !browserOpenForSession || !activeSession || !activeProject?.browser_url) return;
    browser.ensureRegistered(activeSession.id, activeProject.browser_url);
  }, [browserOpenForSession, activeSession?.id, activeProject?.browser_url]);

  // ── Navigation ───────────────────────────────────────────────────
  const { navigate } = useSessionNavigation(
    projects, activeSession, activeProjectId, selectSession, selectProject
  );

  // ── Shortcut callbacks (stable refs for hooks) ───────────────────
  const handleToggleBrowserShortcut = useCallback(() => {
    if (!activeSession) return;
    if (devbench) {
      devbench.toggleBrowser();
    } else if (activeProject?.browser_url) {
      browser.toggle(activeSession.id);
    }
  }, [activeSession, activeProject]);

  const handleNewSessionShortcut = useCallback(() => {
    if (activeProject) setNewSessionPopupOpen(true);
  }, [activeProject]);

  const handleKillSessionShortcut = useCallback(() => {
    if (activeSession) setKillSessionPopupOpen(true);
  }, [activeSession]);

  const handleReviveSessionShortcut = useCallback(() => {
    if (activeProject) setArchivedProjectId(activeProject.id);
  }, [activeProject]);

  const handleRenameSessionShortcut = useCallback(() => {
    if (activeSession) setRenameSessionPopupOpen(true);
  }, [activeSession]);

  const handleShowShortcuts = useCallback(() => {
    setShortcutsHelpOpen(true);
  }, []);

  // ── Electron bridge ──────────────────────────────────────────────
  useElectronBridge({
    activeSession,
    activeProject,
    projects,
    browserOpen,
    setBrowserOpen,
    navigate,
    loadProjects,
    onToggleBrowser: handleToggleBrowserShortcut,
    onNewSession: handleNewSessionShortcut,
    onKillSession: handleKillSessionShortcut,
    onReviveSession: handleReviveSessionShortcut,
    onRenameSession: handleRenameSessionShortcut,
    onShowShortcuts: handleShowShortcuts,
    onBrowserToggled: useCallback((open: boolean) => {
      setBrowserOpen(open);
      if (activeSession) {
        const vm = browser.getViewMode(activeSession.id);
        browser.setOpen(activeSession.id, open);
      }
    }, [activeSession?.id]),
    onViewModeChanged: useCallback((sessionId: number, mode: string) => {
      browser.setViewMode(sessionId, mode as "desktop" | "mobile");
    }, []),
  });

  // ── Browser keyboard shortcuts (non-Electron) ───────────────────
  useKeyboardShortcuts({
    activeSession,
    activeProject,
    navigate,
    onNewSession: handleNewSessionShortcut,
    onKillSession: handleKillSessionShortcut,
    onReviveSession: handleReviveSessionShortcut,
    onRenameSession: handleRenameSessionShortcut,
    onToggleBrowser: handleToggleBrowserShortcut,
    onShowShortcuts: handleShowShortcuts,
  });

  // ── Resizer (Electron) ──────────────────────────────────────────
  const handleResizerPointerDown = useCallback((e: React.PointerEvent) => {
    if (!devbench) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragX(e.clientX);
    devbench.resizeStart();
  }, []);

  const handleResizerPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    setDragX(e.clientX);
  }, []);

  const handleResizerPointerUp = useCallback((e: React.PointerEvent) => {
    if (!devbench) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    devbench.resizeEnd(e.clientX);
    setDragX(null);
  }, []);

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

  // ── MR link handling ─────────────────────────────────────────────
  const handleOpenMrLink = useCallback(
    (session: Session, url: string) => {
      selectSession(session);
      if (devbench) {
        devbench.navigateTo(session.id, url, session.mr_urls);
      } else {
        window.open(url, "_blank");
      }
    },
    [selectSession]
  );

  // ── Project CRUD ─────────────────────────────────────────────────
  const handleReorderProjects = useCallback(async (orderedIds: number[]) => {
    setProjects(prev => {
      const map = new Map(prev.map(p => [p.id, p]));
      return orderedIds.map(id => map.get(id)!).filter(Boolean);
    });
    try { await apiReorderProjects(orderedIds); }
    catch (e) { console.error("Failed to reorder projects:", e); loadProjects(); }
  }, [loadProjects]);

  const handleReorderSessions = useCallback(async (projectId: number, orderedIds: number[]) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      const map = new Map(p.sessions.map(s => [s.id, s]));
      return { ...p, sessions: orderedIds.map(id => map.get(id)!).filter(Boolean) };
    }));
    try { await apiReorderSessions(projectId, orderedIds); }
    catch (e) { console.error("Failed to reorder sessions:", e); loadProjects(); }
  }, [loadProjects]);

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
        browser.cleanup(s.id);
      }
    }
    if (activeProjectId === id) {
      setActiveSession(null);
      setActiveProjectId(null);
    }
    await deleteProject(id);
    await loadProjects();
  };

  // ── Session CRUD ─────────────────────────────────────────────────
  const handleNewSession = async (projectId: number, type: SessionType) => {
    const label = getSessionLabel(type);
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
    devbench?.sessionDestroyed(id);
    browser.cleanup(id);
    await deleteSession(id);
    await loadProjects();
  };

  const handleNewSessionFromPopup = useCallback(
    (type: SessionType) => {
      if (activeProject) handleNewSession(activeProject.id, type);
      setNewSessionPopupOpen(false);
    },
    [activeProject, handleNewSession]
  );

  const handleSessionEnded = useCallback(
    async (sessionId: number) => {
      if (activeSession?.id === sessionId) setActiveSession(null);
      devbench?.sessionDestroyed(sessionId);
      browser.cleanup(sessionId);
      await loadProjects();
    },
    [activeSession, loadProjects]
  );

  const handleReviveSession = useCallback(
    async (id: number) => {
      try {
        const session = await reviveSession(id);
        setOrphanedSessionIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        await loadProjects();
        selectSession(session);
        setArchivedProjectId(null);
      } catch (e: any) {
        alert(`Failed to revive session: ${e.message}`);
      }
    },
    [loadProjects, selectSession]
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
    setKillSessionPopupOpen(false);
    devbench?.sessionDestroyed(id);
    browser.cleanup(id);
    await deleteSession(id);
    await loadProjects();
  }, [activeSession, loadProjects]);

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
        orphanedSessionIds={orphanedSessionIds}
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
        onReviveSession={handleReviveSession}
        onShowArchivedSessions={(projectId) => setArchivedProjectId(projectId)}
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
        onReorderProjects={handleReorderProjects}
        onReorderSessions={handleReorderSessions}
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
      {archivedProjectId !== null && (
        <ArchivedSessionsPopup
          projectId={archivedProjectId}
          projectName={projects.find((p) => p.id === archivedProjectId)?.name ?? ""}
          onRevive={handleReviveSession}
          onDelete={(id) => deleteSessionPermanently(id)}
          onClose={() => setArchivedProjectId(null)}
        />
      )}
      <main className="main-content">
        {activeSession && orphanedSessionIds.has(activeSession.id) ? (
          <div className="orphaned-session-panel">
            <button
              className="sidebar-open-btn empty-state-toggle"
              onClick={() => setSidebarOpen(true)}
              title="Open sidebar"
            >
              ☰
            </button>
            <div className="orphaned-session-content">
              <span className="orphaned-icon">
                {getSessionIcon(activeSession.type)}
              </span>
              <h2>{activeSession.name}</h2>
              <p className="orphaned-description">
                This session's terminal was lost (server restart / power failure).
                {activeSession.type !== "terminal" && activeSession.agent_session_id
                  ? " The agent conversation can be resumed."
                  : activeSession.type !== "terminal"
                    ? " A fresh agent session will be started."
                    : " A new terminal will be created."}
              </p>
              <div className="orphaned-actions">
                <button
                  className="orphaned-revive-btn"
                  onClick={() => handleReviveSession(activeSession.id)}
                >
                  🔄 Revive Session
                </button>
                <button
                  className="orphaned-remove-btn"
                  onClick={() => handleDeleteSession(activeSession.id)}
                >
                  × Remove
                </button>
              </div>
              {activeSession.mr_urls.length > 0 && (
                <div className="orphaned-mr-links">
                  <span>MR links: </span>
                  {activeSession.mr_urls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                      {url}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : activeSession ? (
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
                    onClick={() => browser.toggle(activeSession.id)}
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
            {browser.sessions.size > 0 && (
              <div
                className="browser-stack"
                style={showInlineBrowser ? undefined : { display: "none" }}
              >
                {Array.from(browser.sessions).map(([sid, state]) => {
                  const proj = projects.find((p) =>
                    p.sessions.some((s) => s.id === sid)
                  );
                  return (
                    <BrowserPane
                      key={sid}
                      url={state.url}
                      defaultUrl={proj?.browser_url ?? state.url}
                      viewMode={browser.getViewMode(sid)}
                      visible={showInlineBrowser && sid === activeSession?.id}
                      onClose={() => browser.close(sid)}
                      onViewModeChange={(mode) => browser.setViewMode(sid, mode)}
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
