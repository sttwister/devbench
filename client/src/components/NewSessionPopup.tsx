import { useEffect, useRef } from "react";
import type { SessionType } from "../api";
import { SESSION_TYPES_LIST } from "../api";
import Icon from "./Icon";

interface Props {
  projectName: string;
  onSelect: (type: SessionType) => void;
  onClose: () => void;
}

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

    const match = SESSION_TYPES_LIST.find((o) => o.shortcutKey === e.key.toLowerCase());
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
          {SESSION_TYPES_LIST.map((o) => (
            <button
              key={o.type}
              className="new-session-popup-option"
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur before click fires
              }}
              onClick={() => onSelect(o.type)}
            >
              <span className="new-session-popup-key">{o.shortcutKey}</span>
              <span className="new-session-popup-icon"><Icon name={o.icon} size={18} /></span>
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
