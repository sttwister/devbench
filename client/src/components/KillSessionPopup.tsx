import { useEffect, useRef } from "react";

interface Props {
  sessionName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function KillSessionPopup({ sessionName, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Enter" || e.key.toLowerCase() === "y") {
      onConfirm();
    } else if (e.key === "Escape" || e.key.toLowerCase() === "n") {
      onCancel();
    }
  };

  return (
    <div className="new-session-popup-backdrop" onClick={onCancel}>
      <div
        className="new-session-popup kill-session-popup"
        ref={ref}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={onCancel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kill-session-popup-title">
          Kill session <strong>{sessionName}</strong>?
        </div>
        <div className="kill-session-popup-actions">
          <button
            className="kill-session-btn confirm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onConfirm}
          >
            <kbd>Y</kbd> Yes, kill it
          </button>
          <button
            className="kill-session-btn cancel"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onCancel}
          >
            <kbd>N</kbd> Cancel
          </button>
        </div>
        <div className="new-session-popup-hint">
          <kbd>Enter</kbd> / <kbd>Y</kbd> to confirm · <kbd>Esc</kbd> / <kbd>N</kbd> to cancel
        </div>
      </div>
    </div>
  );
}
