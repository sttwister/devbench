import { useEffect } from "react";
import type { Project, Session } from "../api";

const devbench = window.devbench;

interface KeyboardShortcutOpts {
  activeSession: Session | null;
  activeProject: Project | null;
  navigate: (delta: number) => void;
  onNewSession: () => void;
  onKillSession: () => void;
  onReviveSession: () => void;
  onRenameSession: () => void;
  onToggleBrowser: () => void;
  onShowShortcuts: () => void;
}

/**
 * Registers browser-side keyboard shortcuts (Ctrl+Shift+…).
 * Skipped when running inside Electron (shortcuts come via IPC instead).
 */
export function useKeyboardShortcuts(opts: KeyboardShortcutOpts) {
  const {
    activeSession,
    activeProject,
    navigate,
    onNewSession,
    onKillSession,
    onReviveSession,
    onRenameSession,
    onToggleBrowser,
    onShowShortcuts,
  } = opts;

  useEffect(() => {
    if (devbench) return; // Electron handles shortcuts via IPC
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
        case "?":
          e.preventDefault();
          onShowShortcuts();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, activeProject, activeSession, onNewSession, onKillSession, onReviveSession, onRenameSession, onToggleBrowser, onShowShortcuts]);
}
