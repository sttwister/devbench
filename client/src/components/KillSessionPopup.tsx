import { useState, useEffect, useRef } from "react";
import Icon from "./Icon";

interface Props {
  sessionName: string;
  hasChanges?: boolean;
  onConfirm: (permanent: boolean) => void;
  onCancel: () => void;
}

export default function KillSessionPopup({ sessionName, hasChanges, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [permanent, setPermanent] = useState(false);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Enter" || e.key.toLowerCase() === "y") {
      onConfirm(permanent);
    } else if (e.key === "Escape" || e.key.toLowerCase() === "n") {
      onCancel();
    } else if (e.key.toLowerCase() === "d") {
      setPermanent((p) => !p);
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
          Archive session <strong>{sessionName}</strong>?
        </div>
        {hasChanges && (
          <div className="close-session-warning">
            <Icon name="alert-triangle" size={14} />
            <span>This session has unsaved changes that haven't been committed.</span>
          </div>
        )}
        <div
          className="kill-session-option-toggle"
          onClick={(e) => { e.stopPropagation(); setPermanent((p) => !p); }}
        >
          <span className={`kill-session-toggle-check ${permanent ? "checked" : ""}`}>
            {permanent && <Icon name="check" size={10} />}
          </span>
          <span>Delete permanently <span className="hint-muted">(won't appear in archived list)</span></span>
          <kbd>D</kbd>
        </div>
        <div className="kill-session-popup-actions">
          <button
            className="kill-session-btn confirm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onConfirm(permanent)}
          >
            <kbd>Y</kbd> {permanent ? "Yes, delete permanently" : "Yes, archive it"}
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
          <kbd>Enter</kbd> / <kbd>Y</kbd> to confirm · <kbd>D</kbd> toggle delete · <kbd>Esc</kbd> / <kbd>N</kbd> to cancel
        </div>
      </div>
    </div>
  );
}
