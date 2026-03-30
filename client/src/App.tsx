import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Sidebar from "./components/Sidebar";
import ProjectFormModal from "./components/ProjectFormModal";
import NewSessionPopup from "./components/NewSessionPopup";
import KillSessionPopup from "./components/KillSessionPopup";
import RenameSessionPopup from "./components/RenameSessionPopup";
import ShortcutsHelpPopup from "./components/ShortcutsHelpPopup";
import ArchivedSessionsPopup from "./components/ArchivedSessionsPopup";
import ConfirmPopup from "./components/ConfirmPopup";
import ErrorPopup from "./components/ErrorPopup";
import SettingsPane from "./components/SettingsModal";
import MainContent from "./components/MainContent";
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
} from "./api";
import type { Project, Session, AgentStatus } from "./api";
import { isElectron, devbench } from "./platform";

export default function App() {
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

  // ── Selection ────────────────────────────────────────────────────
  const selectSession = useCallback((session: Session) => {
    setActiveSession(session);
    setActiveProjectId(session.project_id);
  }, []);

  const selectProject = useCallback((projectId: number) => {
    setActiveSession(null);
    setActiveProjectId(projectId);
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
    onToggleTerminal: handleToggleTerminalShortcut,
    onNewSession: handleNewSessionShortcut,
    onKillSession: handleKillSessionShortcut,
    onReviveSession: handleReviveSessionShortcut,
    onRenameSession: handleRenameSessionShortcut,
    onShowShortcuts: handleShowShortcuts,
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
    navigate,
    onNewSession: handleNewSessionShortcut,
    onKillSession: handleKillSessionShortcut,
    onReviveSession: handleReviveSessionShortcut,
    onRenameSession: handleRenameSessionShortcut,
    onToggleBrowser: handleToggleBrowserShortcut,
    onToggleTerminal: handleToggleTerminalShortcut,
    onShowShortcuts: handleShowShortcuts,
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
          onSelect={sessionActions.handleNewSessionFromPopup}
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
        <ShortcutsHelpPopup onClose={() => setShortcutsHelpOpen(false)} />
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
      {sessionActions.confirmDeleteSessionId !== null && (
        <ConfirmPopup
          title="Kill this session?"
          danger
          confirmLabel="Yes, kill it"
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
      {settingsOpen ? (
        <SettingsPane
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          onClose={() => setSettingsOpen(false)}
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
        />
      )}
    </div>
  );
}
