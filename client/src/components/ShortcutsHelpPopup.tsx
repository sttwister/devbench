import { useEffect, useRef } from "react";

interface Props {
  onClose: () => void;
}

const shortcuts = [
  { keys: "Ctrl+Shift+J", description: "Next session" },
  { keys: "Ctrl+Shift+K", description: "Previous session" },
  { keys: "Ctrl+Shift+N", description: "New session" },
  { keys: "Ctrl+Shift+R", description: "Rename session" },
  { keys: "Ctrl+Shift+X", description: "Kill session" },
  { keys: "Ctrl+Shift+A", description: "Archived sessions" },
  { keys: "Ctrl+Shift+B", description: "Toggle browser" },
  { keys: "Ctrl+Shift+?", description: "Show shortcuts" },
];

export default function ShortcutsHelpPopup({ onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "Enter" || e.key === "?") {
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
          {shortcuts.map((s) => (
            <div key={s.keys} className="shortcuts-help-row">
              <kbd className="shortcuts-help-key">{s.keys}</kbd>
              <span className="shortcuts-help-desc">{s.description}</span>
            </div>
          ))}
        </div>
        <div className="new-session-popup-hint">
          Press <kbd>Esc</kbd> or <kbd>Enter</kbd> to close
        </div>
      </div>
    </div>
  );
}
