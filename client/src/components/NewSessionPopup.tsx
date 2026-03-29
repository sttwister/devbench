import { useEffect, useRef } from "react";
import type { SessionType } from "../api";

interface Props {
  projectName: string;
  onSelect: (type: SessionType) => void;
  onClose: () => void;
}

const options: { key: string; type: SessionType; icon: string; label: string }[] = [
  { key: "t", type: "terminal", icon: "🖥", label: "Terminal" },
  { key: "c", type: "claude",   icon: "🤖", label: "Claude Code" },
  { key: "o", type: "codex",    icon: "🧬", label: "Codex" },
  { key: "p", type: "pi",       icon: "🥧", label: "Pi" },
];

export default function NewSessionPopup({ projectName, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape") {
      onClose();
      return;
    }

    const match = options.find((o) => o.key === e.key.toLowerCase());
    if (match) {
      onSelect(match.type);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="new-session-popup-backdrop" onClick={handleBackdropClick}>
      <div
        className="new-session-popup"
        ref={ref}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={onClose}
      >
        <div className="new-session-popup-title">
          New session in <strong>{projectName}</strong>
        </div>
        <div className="new-session-popup-options">
          {options.map((o) => (
            <button
              key={o.key}
              className="new-session-popup-option"
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur before click fires
              }}
              onClick={() => onSelect(o.type)}
            >
              <span className="new-session-popup-key">{o.key}</span>
              <span className="new-session-popup-icon">{o.icon}</span>
              <span className="new-session-popup-label">{o.label}</span>
            </button>
          ))}
        </div>
        <div className="new-session-popup-hint">
          Press a key or click · <kbd>Esc</kbd> to cancel
        </div>
      </div>
    </div>
  );
}
