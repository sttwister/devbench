import { useEffect, useRef } from "react";

interface Props {
  message: string;
  onClose: () => void;
}

/**
 * Simple error popup — replaces native `alert()` dialogs.
 * Dismissible with Escape, Enter, or clicking the close button.
 */
export default function ErrorPopup({ message, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "Enter") {
      onClose();
    }
  };

  return (
    <div className="new-session-popup-backdrop" onClick={onClose}>
      <div
        className="new-session-popup"
        ref={ref}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={onClose}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kill-session-popup-title" style={{ color: "var(--danger)" }}>
          Error
        </div>
        <div className="confirm-popup-message">
          {message}
        </div>
        <div className="kill-session-popup-actions">
          <button
            className="kill-session-btn cancel"
            style={{ flex: "none", minWidth: 100 }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClose}
          >
            OK
          </button>
        </div>
        <div className="new-session-popup-hint">
          <kbd>Enter</kbd> or <kbd>Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
