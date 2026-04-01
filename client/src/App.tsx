// @lat: [[client#App Shell]]
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Sidebar from "./components/Sidebar";
import ProjectFormModal from "./components/ProjectFormModal";
import NewSessionPopup from "./components/NewSessionPopup";
import KillSessionPopup from "./components/KillSessionPopup";
import RenameSessionPopup from "./components/RenameSessionPopup";
import ShortcutsHelpPopup from "./components/ShortcutsHelpPopup";
import ArchivedSessionsPopup from "./components/ArchivedSessionsPopup";
import EditSessionPopup from "./components/EditSessionPopup";
import ConfirmPopup from "./components/ConfirmPopup";
import ErrorPopup from "./components/ErrorPopup";
import CloseSessionPopup from "./components/CloseSessionPopup";
import SettingsPane from "./components/SettingsModal";
import MainContent from "./components/MainContent";
import GitButlerDashboard from "./components/GitButlerDashboard";
import type { GitButlerDashboardHandle } from "./components/GitButlerDashboard";
import { useBrowserState } from "./hooks/useBrowserState";
import { useSessionNavigation } from "./hooks/useSessionNavigation";
import { useElectronBridge } from "./hooks/useElectronBridge";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useProjectActions } from "./hooks/useProjectActions";
import { useSessionActions } from "./hooks/useSessionActions";
import { useResizer } from "./hooks/useResizer";
import {
  fetchProjects,
  fetchPollData,
  deleteSessionPermanently,
  prepareCommitPush,
} from "./api";
import type { Project, Session, AgentStatus, MrStatus } from "./api";
import { MrStatusProvider, useMrStatus } from "./contexts/MrStatusContext";
import { isElectron, devbench } from "./platform";

export default function App() {
  return (
    <MrStatusProvider>
      <AppContent />
    </MrStatusProvider>
  );
}

function AppContent() {
  // ── Core state ───────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({});
  const [orphanedSessionIds, setOrphanedSessionIds] = useState<Set<number>>(new Set());

  // ── UI state ─────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dashboardMode, setDashboardMode] = useState<null | "project" | "all">(null);
  const preDashboardSessionRef = useRef<Session | null>(null);
  const preDashboardProjectIdRef = useRef<number | null>(null);
  const gitButlerDashboardRef = useRef<GitButlerDashboardHandle>(null);


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

  // ── MR status store ──────────────────────────────────────────────
  const { mergeStatuses } = useMrStatus();

  // Populate the global MR status store whenever project data changes.
  // This aggregates mr_statuses from every active session so MrBadge
  // components can look up status by URL without prop-drilling.
  useEffect(() => {
    const all: Record<string, MrStatus> = {};
    for (const p of projects) {
      for (const s of p.sessions) {
        if (s.mr_statuses) {
          for (const [url, status] of Object.entries(s.mr_statuses)) {
            const existing = all[url];
            if (
              !existing ||
              !existing.last_checked ||
              (status.last_checked && status.last_checked > existing.last_checked)
            ) {
              all[url] = status;
            }
          }
        }
      }
    }
    if (Object.keys(all).length > 0) mergeStatuses(all);
  }, [projects, mergeStatuses]);

  // Keep activeSession in sync with fresh project data so the terminal
  // header reflects up-to-date MR URLs, source URLs, etc.
  // (MR statuses are handled by the global store — no comparison needed.)
  useEffect(() => {
    if (!activeSession) return;
    for (const project of projects) {
      const fresh = project.sessions.find(s => s.id === activeSession.id);
      if (fresh) {
        const changed =
          fresh.name !== activeSession.name ||
          fresh.source_url !== activeSession.source_url ||
          fresh.source_type !== activeSession.source_type ||
          fresh.mr_urls.length !== activeSession.mr_urls.length ||
          fresh.mr_urls.some((u, i) => u !== activeSession.mr_urls[i]);
        if (changed) {
          setActiveSession(fresh);
        }
        return;
      }
    }
  }, [projects]);

  // Poll agent statuses and orphaned sessions (single combined request)
  useEffect(() => {
    const poll = () => {
      fetchPollData().then((data) => {
        setAgentStatuses(data.agentStatuses);
        setOrphanedSessionIds(new Set(data.orphanedSessionIds));
      });
    };
    poll();
    const interval = setInterval(poll, 5_000);
    return () => clearInterval(interval);
  }, []);

  // ── URL-based session persistence ───────────────────────────────
  // Restore session from URL on first project load (survives server restarts)
  const [urlRestored, setUrlRestored] = useState(false);

  useEffect(() => {
    if (urlRestored || projects.length === 0) return;
    setUrlRestored(true);

    const pathname = window.location.pathname;

    // Restore dashboard views
    if (pathname === "/gitbutler") {
      setDashboardMode("all");
      return;
    }
    const dashboardMatch = pathname.match(/^\/gitbutler\/project\/(\d+)$/);
    if (dashboardMatch) {
      const projId = parseInt(dashboardMatch[1], 10);
      setDashboardMode("project");
      setActiveProjectId(projId);
      return;
    }

    // Restore session
    const match = pathname.match(/^\/session\/(\d+)$/);
    if (!match) return;
    const sessionId = parseInt(match[1], 10);

    for (const project of projects) {
      const session = project.sessions.find((s) => s.id === sessionId);
      if (session) {
        setActiveSession(session);
        setActiveProjectId(session.project_id);
        return;
      }
    }
  }, [projects, urlRestored]);

  // Keep URL in sync with active session / dashboard (only after initial restore attempted)
  useEffect(() => {
    if (!urlRestored) return;
    let targetPath: string;
    if (dashboardMode === "all") {
      targetPath = "/gitbutler";
    } else if (dashboardMode === "project" && activeProjectId) {
      targetPath = `/gitbutler/project/${activeProjectId}`;
    } else if (activeSession) {
      targetPath = `/session/${activeSession.id}`;
    } else {
      targetPath = "/";
    }
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(null, "", targetPath);
    }
  }, [activeSession, dashboardMode, activeProjectId, urlRestored]);

  // ── Selection ────────────────────────────────────────────────────
  const selectSession = useCallback((session: Session) => {
    setActiveSession(session);
    setActiveProjectId(session.project_id);
    setDashboardMode(null);
    setSettingsOpen(false);
  }, []);

  const selectProject = useCallback((projectId: number) => {
    setActiveSession(null);
    setActiveProjectId(projectId);
    setDashboardMode(null);
    setSettingsOpen(false);
  }, []);

  // ── Browser state ────────────────────────────────────────────────
  const browser = useBrowserState(projects);

  const browserOpenForSession = isElectron
    ? browserOpen
    : activeSession
      ? browser.isOpen(activeSession.id)
      : false;

  // Register the active session's browser iframe when inline browser is shown
  useEffect(() => {
    if (isElectron || !browserOpenForSession || !activeSession || !activeProject?.browser_url) return;
    browser.ensureRegistered(activeSession.id, activeProject.browser_url);
  }, [browserOpenForSession, activeSession?.id, activeProject?.browser_url]);

  // ── Navigation ───────────────────────────────────────────────────
  const { navigate } = useSessionNavigation(
    projects, activeSession, activeProjectId, selectSession, selectProject
  );

  // ── Project actions ──────────────────────────────────────────────
  const projectActions = useProjectActions({
    projects, setProjects,
    activeProjectId, setActiveProjectId, setActiveSession,
    loadProjects,
    browserCleanup: browser.cleanup,
  });

  // ── Session actions ──────────────────────────────────────────────
  const sessionActions = useSessionActions({
    projects, setProjects,
    activeSession, setActiveSession,
    selectSession, loadProjects,
    browserCleanup: browser.cleanup,
    setOrphanedSessionIds,
  });

  // ── Resizer ──────────────────────────────────────────────────────
  const resizer = useResizer();

  // ── Terminal toggle state ──────────────────────────────────────────
  const preTerminalSessionRef = useRef<Session | null>(null);

  // ── Shortcut callbacks (stable refs for hooks) ───────────────────
  const handleToggleBrowserShortcut = useCallback(() => {
    if (!activeSession) return;
    if (isElectron) {
      devbench.toggleBrowser();
    } else if (activeProject?.browser_url) {
      browser.toggle(activeSession.id);
    }
  }, [activeSession, activeProject]);

  const handleNewSessionShortcut = useCallback(() => {
    if (projects.length === 0) return;
    sessionActions.setNewSessionPopupProjectId(activeProject?.id ?? null);
    sessionActions.setNewSessionPopupOpen(true);
  }, [activeProject, projects]);

  const handleKillSessionShortcut = useCallback(() => {
    if (activeSession) sessionActions.setKillSessionPopupOpen(true);
  }, [activeSession]);

  const handleReviveSessionShortcut = useCallback(() => {
    if (activeProject) sessionActions.setArchivedProjectId(activeProject.id);
  }, [activeProject]);

  const handleRenameSessionShortcut = useCallback(() => {
    if (activeSession) sessionActions.setRenameSessionPopupOpen(true);
  }, [activeSession]);

  const handleToggleTerminalShortcut = useCallback(() => {
    if (!activeProject) return;
    const terminalSession = activeProject.sessions.find((s) => s.type === "terminal");
    if (!terminalSession) return;

    if (activeSession?.id === terminalSession.id) {
      // Already on the terminal — revert to previous session
      if (preTerminalSessionRef.current) {
        selectSession(preTerminalSessionRef.current);
        preTerminalSessionRef.current = null;
      }
    } else {
      // Save current session and jump to terminal
      preTerminalSessionRef.current = activeSession;
      selectSession(terminalSession);
    }
  }, [activeProject, activeSession, selectSession]);

  const gitCommitPushRef = useRef<((branchName?: string | null, staleBranch?: string | null) => void) | null>(null);
  const [gitCommitPushPending, setGitCommitPushPending] = useState(false);

  const handleGitCommitPush = useCallback(async () => {
    if (!activeSession || activeSession.type === "terminal") return;
    if (gitCommitPushPending) return; // already in flight

    // Capture the send-callback synchronously BEFORE any async work.
    // If the user switches sessions while prepareCommitPush is in flight,
    // gitCommitPushRef.current will be updated to the new session's callback.
    // Using the captured value ensures the command always targets the session
    // that originally triggered the shortcut, not whatever is active later.
    const capturedSend = gitCommitPushRef.current;

    setGitCommitPushPending(true);
    let preparedBranchName: string | null = null;
    let preparedStaleBranch: string | null = null;
    try {
      const prepared = await prepareCommitPush(activeSession.id);
      preparedBranchName = prepared.branchName;
      preparedStaleBranch = prepared.staleBranch ?? null;
      await loadProjects();
    } catch (e: any) {
      sessionActions.setErrorMessage(e.message || "Failed to prepare commit and push");
      return;
    } finally {
      setGitCommitPushPending(false);
    }

    capturedSend?.(preparedBranchName, preparedStaleBranch);
  }, [activeSession, gitCommitPushPending, loadProjects, sessionActions]);

  const handleShowShortcuts = useCallback(() => {
    setShortcutsHelpOpen(true);
  }, []);

  // ── GitButler dashboard toggle handlers ─────────────────────────
  const handleToggleProjectDashboard = useCallback(() => {
    if (dashboardMode === "project") {
      // Go back to previous view
      setDashboardMode(null);
      setSettingsOpen(false);
      if (preDashboardSessionRef.current) {
        selectSession(preDashboardSessionRef.current);
        preDashboardSessionRef.current = null;
      } else if (preDashboardProjectIdRef.current !== null) {
        selectProject(preDashboardProjectIdRef.current);
      }
    } else {
      // Save current state and show project dashboard
      preDashboardSessionRef.current = activeSession;
      preDashboardProjectIdRef.current = activeProjectId;
      setSettingsOpen(false);
      setDashboardMode("project");
    }
  }, [dashboardMode, activeSession, activeProjectId, selectSession, selectProject]);

  const handleToggleAllDashboard = useCallback(() => {
    if (dashboardMode === "all") {
      // Go back to previous view
      setDashboardMode(null);
      setSettingsOpen(false);
      if (preDashboardSessionRef.current) {
        selectSession(preDashboardSessionRef.current);
        preDashboardSessionRef.current = null;
      } else if (preDashboardProjectIdRef.current !== null) {
        selectProject(preDashboardProjectIdRef.current);
      }
    } else {
      // Save current state and show all-projects dashboard
      preDashboardSessionRef.current = activeSession;
      preDashboardProjectIdRef.current = activeProjectId;
      setSettingsOpen(false);
      setDashboardMode("all");
    }
  }, [dashboardMode, activeSession, activeProjectId, selectSession, selectProject]);

  const handleGitButlerPull = useCallback(() => {
    gitButlerDashboardRef.current?.triggerPull();
  }, []);

  const handleCloseSessionShortcut = useCallback(() => {
    if (activeSession) sessionActions.handleCloseSession(activeSession.id);
  }, [activeSession, sessionActions]);

  const handleDashboardNavigateToSession = useCallback((sessionId: number) => {
    for (const project of projects) {
      const session = project.sessions.find((s) => s.id === sessionId);
      if (session) {
        setDashboardMode(null);
        selectSession(session);
        return;
      }
    }
  }, [projects, selectSession]);

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
    onToggleTerminal: handleToggleTerminalShortcut,
    onNewSession: handleNewSessionShortcut,
    onKillSession: handleKillSessionShortcut,
    onReviveSession: handleReviveSessionShortcut,
    onRenameSession: handleRenameSessionShortcut,
    onGitCommitPush: handleGitCommitPush,
    onShowShortcuts: handleShowShortcuts,
    onToggleProjectDashboard: handleToggleProjectDashboard,
    onToggleAllDashboard: handleToggleAllDashboard,
    onGitButlerPull: handleGitButlerPull,
    onBrowserToggled: useCallback((open: boolean) => {
      setBrowserOpen(open);
      if (activeSession) {
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
    dashboardMode,
    navigate,
    onNewSession: handleNewSessionShortcut,
    onKillSession: handleKillSessionShortcut,
    onReviveSession: handleReviveSessionShortcut,
    onRenameSession: handleRenameSessionShortcut,
    onToggleBrowser: handleToggleBrowserShortcut,
    onToggleTerminal: handleToggleTerminalShortcut,
    onGitCommitPush: handleGitCommitPush,
    onShowShortcuts: handleShowShortcuts,
    onToggleProjectDashboard: handleToggleProjectDashboard,
    onToggleAllDashboard: handleToggleAllDashboard,
    onGitButlerPull: handleGitButlerPull,
    onCloseSession: handleCloseSessionShortcut,
  });

  // ── MR link handling ─────────────────────────────────────────────
  const handleOpenMrLink = useCallback(
    (session: Session, url: string) => {
      selectSession(session);
      if (isElectron) {
        devbench.navigateTo(session.id, url, session.mr_urls);
      } else {
        window.open(url, "_blank");
      }
    },
    [selectSession]
  );

  // ── Render ───────────────────────────────────────────────────────
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
        onAddProject={projectActions.handleAddProject}
        onEditProject={projectActions.handleEditProject}
        onDeleteProject={projectActions.handleDeleteProject}
        onNewSession={(projectId, type) => {
          sessionActions.handleNewSession(projectId, type);
          setSidebarOpen(false);
        }}
        onShowNewSessionPopup={(projectId) => {
          sessionActions.setNewSessionPopupProjectId(projectId);
          sessionActions.setNewSessionPopupOpen(true);
        }}
        onDeleteSession={sessionActions.handleDeleteSession}
        onReviveSession={sessionActions.handleReviveSession}
        onShowArchivedSessions={(projectId) => sessionActions.setArchivedProjectId(projectId)}
        onSelectSession={(session) => {
          selectSession(session);
          setSidebarOpen(false);
        }}
        onSelectProject={(projectId) => {
          selectProject(projectId);
          setSidebarOpen(false);
        }}
        onRenameSession={sessionActions.handleRenameSession}
        onEditSession={(id) => sessionActions.setEditingSessionId(id)}
        onOpenMrLink={(session, url) => {
          handleOpenMrLink(session, url);
          setSidebarOpen(false);
        }}
        onReorderProjects={projectActions.handleReorderProjects}
        onReorderSessions={sessionActions.handleReorderSessions}
        onOpenSettings={() => {
          setSettingsOpen((prev) => !prev);
          setSidebarOpen(false);
        }}
        onOpenGitButler={() => {
          preDashboardSessionRef.current = activeSession;
          preDashboardProjectIdRef.current = activeProjectId;
          setSettingsOpen(false);
          setDashboardMode("all");
          setSidebarOpen(false);
        }}
        onOpenProjectDashboard={(projId) => {
          preDashboardSessionRef.current = activeSession;
          preDashboardProjectIdRef.current = activeProjectId;
          setActiveProjectId(projId);
          setSettingsOpen(false);
          setDashboardMode("project");
          setSidebarOpen(false);
        }}
      />
      {projectActions.projectFormOpen && (
        <ProjectFormModal
          project={projectActions.editingProject}
          onSubmit={projectActions.handleProjectFormSubmit}
          onCancel={projectActions.handleProjectFormCancel}
        />
      )}
      {sessionActions.newSessionPopupOpen && projects.length > 0 && (
        <NewSessionPopup
          projects={projects}
          initialProjectId={sessionActions.newSessionPopupProjectId}
          onSelect={(projectId, type, sourceUrl) => {
            sessionActions.handleNewSessionFromPopup(projectId, type, sourceUrl);
            setSidebarOpen(false);
          }}
          onClose={() => {
            sessionActions.setNewSessionPopupOpen(false);
            sessionActions.setNewSessionPopupProjectId(null);
          }}
        />
      )}
      {sessionActions.killSessionPopupOpen && activeSession && (
        <KillSessionPopup
          sessionName={activeSession.name}
          onConfirm={sessionActions.handleKillSessionConfirm}
          onCancel={() => sessionActions.setKillSessionPopupOpen(false)}
        />
      )}
      {sessionActions.renameSessionPopupOpen && activeSession && (
        <RenameSessionPopup
          sessionName={activeSession.name}
          onConfirm={sessionActions.handleRenameSessionConfirm}
          onCancel={() => sessionActions.setRenameSessionPopupOpen(false)}
        />
      )}
      {shortcutsHelpOpen && (
        <ShortcutsHelpPopup onClose={() => setShortcutsHelpOpen(false)} activeSessionType={activeSession?.type} />
      )}

      {sessionActions.archivedProjectId !== null && (
        <ArchivedSessionsPopup
          projectId={sessionActions.archivedProjectId}
          projectName={projects.find((p) => p.id === sessionActions.archivedProjectId)?.name ?? ""}
          onRevive={sessionActions.handleReviveSession}
          onDelete={(id) => deleteSessionPermanently(id)}
          onClose={() => sessionActions.setArchivedProjectId(null)}
        />
      )}
      {sessionActions.editingSessionId !== null && (() => {
        const editSession = projects.flatMap(p => p.sessions).find(s => s.id === sessionActions.editingSessionId);
        return editSession ? (
          <EditSessionPopup
            session={editSession}
            onClose={() => sessionActions.setEditingSessionId(null)}
            onUpdated={loadProjects}
          />
        ) : null;
      })()}
      {sessionActions.confirmDeleteSessionId !== null && (
        <ConfirmPopup
          title="Archive this session?"
          danger
          confirmLabel="Yes, archive it"
          onConfirm={sessionActions.handleConfirmDeleteSession}
          onCancel={() => sessionActions.setConfirmDeleteSessionId(null)}
        />
      )}
      {projectActions.confirmDeleteProjectId !== null && (
        <ConfirmPopup
          title="Delete this project?"
          message="This will delete the project and kill all its sessions."
          danger
          confirmLabel="Yes, delete"
          onConfirm={projectActions.handleConfirmDeleteProject}
          onCancel={() => projectActions.setConfirmDeleteProjectId(null)}
        />
      )}
      {projectActions.errorMessage && (
        <ErrorPopup
          message={projectActions.errorMessage}
          onClose={() => projectActions.setErrorMessage(null)}
        />
      )}
      {sessionActions.errorMessage && (
        <ErrorPopup
          message={sessionActions.errorMessage}
          onClose={() => sessionActions.setErrorMessage(null)}
        />
      )}
      {sessionActions.closingSessionId !== null && (() => {
        const closeSession = projects.flatMap(p => p.sessions).find(s => s.id === sessionActions.closingSessionId);
        return closeSession ? (
          <CloseSessionPopup
            session={closeSession}
            onClose={() => sessionActions.setClosingSessionId(null)}
            onSessionClosed={sessionActions.handleSessionClosed}
          />
        ) : null;
      })()}
      {settingsOpen ? (
        <SettingsPane
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          onClose={() => setSettingsOpen(false)}
        />
      ) : dashboardMode ? (
        <GitButlerDashboard
          ref={gitButlerDashboardRef}
          mode={dashboardMode}
          projectId={activeProjectId}
          projects={projects}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          onClose={() => {
            setDashboardMode(null);
            if (preDashboardSessionRef.current) {
              selectSession(preDashboardSessionRef.current);
              preDashboardSessionRef.current = null;
            }
          }}
          onNavigateToSession={handleDashboardNavigateToSession}
        />
      ) : (
        <MainContent
          activeSession={activeSession}
          activeProject={activeProject}
          projects={projects}
          orphanedSessionIds={orphanedSessionIds}
          browserOpenForSession={browserOpenForSession}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          browser={browser}
          resizer={resizer}
          onSessionEnded={sessionActions.handleSessionEnded}
          onSessionRenamed={(newName) => {
            setActiveSession((prev) => prev ? { ...prev, name: newName } : prev);
            loadProjects();
          }}
          onMrLinkFound={() => loadProjects()}
          onReviveSession={sessionActions.handleReviveSession}
          onDeleteSession={sessionActions.handleDeleteSession}
          navigate={navigate}
          gitCommitPushRef={gitCommitPushRef}
          gitCommitPushPending={gitCommitPushPending}
          onOpenGitButlerDashboard={handleToggleProjectDashboard}
          onCloseSession={sessionActions.handleCloseSession}
        />
      )}
    </div>
  );
}
