import { useEffect } from "react";
import type { Project, Session } from "../api";
import { isElectron } from "../platform";

interface KeyboardShortcutOpts {
  activeSession: Session | null;
  activeProject: Project | null;
  dashboardMode: null | "project" | "all";
  navigate: (delta: number) => void;
  onNewSession: () => void;
  onKillSession: () => void;
  onReviveSession: () => void;
  onRenameSession: () => void;
  onToggleBrowser: () => void;
  onToggleTerminal: () => void;
  onGitCommitPush: () => void;
  onShowShortcuts: () => void;
  onToggleProjectDashboard: () => void;
  onToggleAllDashboard: () => void;
  onGitButlerPull: () => void;
  onCloseSession?: () => void;
  onToggleDiff?: () => void;
  onToggleFullscreen?: () => void;
  onForkSession?: () => void;
}

/**
 * Registers browser-side keyboard shortcuts (Ctrl+Shift+…).
 * Skipped when running inside Electron (shortcuts come via IPC instead).
 */
export function useKeyboardShortcuts(opts: KeyboardShortcutOpts) {
  const {
    activeSession,
    activeProject,
    dashboardMode,
    navigate,
    onNewSession,
    onKillSession,
    onReviveSession,
    onRenameSession,
    onToggleBrowser,
    onToggleTerminal,
    onGitCommitPush,
    onShowShortcuts,
    onToggleProjectDashboard,
    onToggleAllDashboard,
    onGitButlerPull,
    onCloseSession,
    onToggleDiff,
    onToggleFullscreen,
    onForkSession,
  } = opts;

  useEffect(() => {
    if (isElectron) return; // Electron handles shortcuts via IPC
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      switch (e.key) {
        case "J":
          e.preventDefault();
          navigate(1);
          break;
        case "K":
          e.preventDefault();
          navigate(-1);
          break;
        case "N":
          e.preventDefault();
          onNewSession();
          break;
        case "X":
          e.preventDefault();
          onKillSession();
          break;
        case "A":
          e.preventDefault();
          onReviveSession();
          break;
        case "R":
          e.preventDefault();
          onRenameSession();
          break;
        case "B":
          e.preventDefault();
          onToggleBrowser();
          break;
        case "T":
          e.preventDefault();
          onToggleTerminal();
          break;
        case "G":
          e.preventDefault();
          onGitCommitPush();
          break;
        case "?":
          e.preventDefault();
          onShowShortcuts();
          break;
        case "D":
          e.preventDefault();
          onToggleProjectDashboard();
          break;
        case "F":
          e.preventDefault();
          onToggleFullscreen?.();
          break;
        case "P":
          e.preventDefault();
          onToggleAllDashboard();
          break;
        case "L":
          e.preventDefault();
          onGitButlerPull();
          break;
        case "W":
          e.preventDefault();
          onCloseSession?.();
          break;
        case "E":
          e.preventDefault();
          onToggleDiff?.();
          break;
        case "O":
          e.preventDefault();
          onForkSession?.();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, activeProject, activeSession, dashboardMode, onNewSession, onKillSession, onReviveSession, onRenameSession, onToggleBrowser, onToggleTerminal, onGitCommitPush, onShowShortcuts, onToggleProjectDashboard, onToggleAllDashboard, onGitButlerPull, onCloseSession, onToggleDiff, onToggleFullscreen, onForkSession]);
}
