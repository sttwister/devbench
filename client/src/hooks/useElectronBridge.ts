import { useEffect } from "react";
import type { Project, Session } from "../api";
import { isElectron, devbench } from "../platform";

interface ElectronBridgeOpts {
  activeSession: Session | null;
  activeProject: Project | null;
  projects: Project[];
  browserOpen: boolean;
  setBrowserOpen: (open: boolean) => void;
  navigate: (delta: number) => void;
  loadProjects: () => Promise<void>;
  onToggleBrowser: () => void;
  onToggleTerminal: () => void;
  onGitCommitPush: () => void;
  onNewSession: () => void;
  onKillSession: () => void;
  onReviveSession: () => void;
  onRenameSession: () => void;
  onShowShortcuts: () => void;
  onToggleProjectDashboard?: () => void;
  onToggleAllDashboard?: () => void;
  onGitButlerPull?: () => void;
  onToggleDiff?: () => void;
  onToggleFullscreen?: () => void;
  onForkSession?: () => void;
  onBrowserToggled: (open: boolean) => void;
  onViewModeChanged: (sessionId: number, mode: string) => void;
}

/**
 * Manages all Electron ↔ renderer bridge communication.
 * No-ops when running in a regular browser.
 */
export function useElectronBridge(opts: ElectronBridgeOpts) {
  const {
    activeSession,
    activeProject,
    projects,
    browserOpen,
    navigate,
    loadProjects,
    onToggleBrowser,
    onToggleTerminal,
    onGitCommitPush,
    onNewSession,
    onKillSession,
    onReviveSession,
    onRenameSession,
    onShowShortcuts,
    onToggleProjectDashboard,
    onToggleAllDashboard,
    onGitButlerPull,
    onToggleDiff,
    onToggleFullscreen,
    onForkSession,
    onBrowserToggled,
    onViewModeChanged,
  } = opts;

  // Notify Electron of session changes
  useEffect(() => {
    if (!isElectron || !devbench || !activeSession || !activeProject) return;
    devbench.sessionChanged(
      activeSession.id,
      activeProject.id,
      activeProject.browser_url,
      activeProject.default_view_mode || "desktop",
      activeSession.browser_open,
      activeSession.view_mode
    );
  }, [activeSession?.id, activeProject?.id, activeProject?.browser_url]);

  // Push MR URL changes to Electron toolbar
  useEffect(() => {
    if (!isElectron || !devbench || !activeSession) return;
    const sess = projects
      .flatMap((p) => p.sessions)
      .find((s) => s.id === activeSession.id);
    if (sess) {
      devbench.updateMrUrls(activeSession.id, sess.mr_urls);
    }
  }, [projects, activeSession?.id]);

  // Sync browser state from Electron
  useEffect(() => {
    if (!isElectron) return;
    return devbench.onBrowserToggled(onBrowserToggled);
  }, [onBrowserToggled]);

  // Sync view mode from Electron toolbar
  useEffect(() => {
    if (!isElectron) return;
    return devbench.onViewModeChanged((mode) => {
      if (!activeSession) return;
      onViewModeChanged(activeSession.id, mode);
    });
  }, [activeSession?.id, onViewModeChanged]);

  // Listen for projects-changed from Electron
  useEffect(() => {
    if (!isElectron) return;
    return devbench.onProjectsChanged(() => loadProjects());
  }, [loadProjects]);

  // Handle Electron shortcuts
  useEffect(() => {
    if (!isElectron) return;
    return devbench.onShortcut((action) => {
      switch (action) {
        case "next-session":
          navigate(1);
          break;
        case "prev-session":
          navigate(-1);
          break;
        case "toggle-browser":
          onToggleBrowser();
          break;
        case "toggle-terminal":
          onToggleTerminal();
          break;
        case "new-session":
          onNewSession();
          break;
        case "kill-session":
          onKillSession();
          break;
        case "revive-session":
          onReviveSession();
          break;
        case "rename-session":
          onRenameSession();
          break;
        case "git-commit-push":
          onGitCommitPush();
          break;
        case "show-shortcuts":
          onShowShortcuts();
          break;
        case "toggle-project-dashboard":
          onToggleProjectDashboard?.();
          break;
        case "toggle-all-dashboard":
          onToggleAllDashboard?.();
          break;
        case "gitbutler-pull":
          onGitButlerPull?.();
          break;
        case "toggle-diff":
          onToggleDiff?.();
          break;
        case "toggle-diff-fullscreen":
          onToggleFullscreen?.();
          break;
        case "fork-session":
          onForkSession?.();
          break;
      }
    });
  }, [navigate, onToggleBrowser, onToggleTerminal, onGitCommitPush, onNewSession, onKillSession, onReviveSession, onRenameSession, onShowShortcuts, onToggleProjectDashboard, onToggleAllDashboard, onGitButlerPull, onToggleDiff, onToggleFullscreen, onForkSession]);
}
