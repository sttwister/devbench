import { useEffect, useRef } from "react";
import type { SessionType } from "../api";

interface Props {
  onClose: () => void;
  activeSessionType?: SessionType | null;
}

interface Shortcut {
  keys: string;
  description: string;
  agentOnly?: boolean;
}

interface ShortcutGroup {
  label: string;
  shortcuts: Shortcut[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Navigation",
    shortcuts: [
      { keys: "Ctrl+Shift+J", description: "Next session" },
      { keys: "Ctrl+Shift+K", description: "Previous session" },
    ],
  },
  {
    label: "Session Management",
    shortcuts: [
      { keys: "Ctrl+Shift+N", description: "New session" },
      { keys: "Ctrl+Shift+T", description: "Toggle terminal session" },
      { keys: "Ctrl+Shift+R", description: "Rename session" },
      { keys: "Ctrl+Shift+X", description: "Archive session" },
      { keys: "Ctrl+Shift+A", description: "Archived sessions" },
      { keys: "Ctrl+Shift+W", description: "Close session (merge + done + archive)" },
      { keys: "Ctrl+Shift+O", description: "Fork session (new tmux pane)", agentOnly: true },
    ],
  },
  {
    label: "View",
    shortcuts: [
      { keys: "Ctrl+Shift+B", description: "Toggle browser" },
      { keys: "Ctrl+Shift+E", description: "Toggle diff viewer" },
      { keys: "Ctrl+Shift+F", description: "Toggle fullscreen (diff or browser)" },
      { keys: "Ctrl+Shift+?", description: "Show shortcuts" },
      { keys: "q", description: "Close overlay (diff, dashboard, settings)" },
    ],
  },
  {
    label: "Diff Viewer",
    shortcuts: [
      { keys: "j / k", description: "Scroll up / down" },
      { keys: "d / u", description: "Half-page down / up" },
      { keys: "h / l", description: "Previous / next file" },
      { keys: "[ / ]", description: "Previous / next diff target" },
      { keys: "t", description: "Toggle target dropdown" },
      { keys: "q", description: "Close diff viewer" },
    ],
  },
  {
    label: "GitButler",
    shortcuts: [
      { keys: "Ctrl+Shift+G", description: "Git commit & push", agentOnly: true },
      { keys: "Ctrl+Shift+D", description: "Dashboard (current project)" },
      { keys: "Ctrl+Shift+P", description: "Dashboard (all projects)" },
      { keys: "Ctrl+Shift+L", description: "Pull (in dashboard)" },
    ],
  },
];

export default function ShortcutsHelpPopup({ onClose, activeSessionType }: Props) {
  const isTerminal = activeSessionType === "terminal";
  const groups = SHORTCUT_GROUPS.map((g) => ({
    ...g,
    shortcuts: g.shortcuts.filter((s) => !(s.agentOnly && isTerminal)),
  })).filter((g) => g.shortcuts.length > 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "Enter" || e.key === "?" || e.key === "q") {
      onClose();
    }
  };

  return (
    <div className="new-session-popup-backdrop" onClick={onClose}>
      <div
        className="new-session-popup shortcuts-help-popup"
        ref={ref}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={onClose}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-help-title">Keyboard Shortcuts</div>
        <div className="shortcuts-help-list">
          {groups.map((g) => (
            <div key={g.label} className="shortcuts-help-group">
              <div className="shortcuts-help-group-label">{g.label}</div>
              {g.shortcuts.map((s) => (
                <div key={s.keys} className="shortcuts-help-row">
                  <kbd className="shortcuts-help-key">{s.keys}</kbd>
                  <span className="shortcuts-help-desc">{s.description}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="new-session-popup-hint">
          Press <kbd>Esc</kbd>, <kbd>Enter</kbd>, or <kbd>q</kbd> to close
        </div>
      </div>
    </div>
  );
}
