import { useState, useEffect, useRef } from "react";
import Icon from "./Icon";

interface Props {
  title: string;
  message?: string;
  /** If true, message is rendered as an amber warning box instead of plain text. */
  warning?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** When true, show a "Delete permanently" checkbox toggled by D key. */
  showPermanentDelete?: boolean;
  permanentDeleteLabel?: string;
  onConfirm: (permanent?: boolean) => void;
  onCancel: () => void;
}

/**
 * Reusable confirmation popup — replaces native `confirm()` dialogs.
 * Styled consistently with KillSessionPopup / NewSessionPopup.
 *
 * Keyboard: Y / Enter to confirm, N / Escape to cancel.
 */
export default function ConfirmPopup({
  title,
  message,
  warning = false,
  confirmLabel = "Yes",
  cancelLabel = "Cancel",
  danger = false,
  showPermanentDelete = false,
  permanentDeleteLabel = "Delete permanently",
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [permanent, setPermanent] = useState(false);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Enter" || e.key.toLowerCase() === "y") {
      onConfirm(showPermanentDelete ? permanent : undefined);
    } else if (e.key === "Escape" || e.key.toLowerCase() === "n") {
      onCancel();
    } else if (showPermanentDelete && e.key.toLowerCase() === "d") {
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
          {title}
        </div>
        {message && (
          warning ? (
            <div className="close-session-warning">
              <Icon name="alert-triangle" size={14} />
              <span>{message}</span>
            </div>
          ) : (
            <div className="confirm-popup-message">
              {message}
            </div>
          )
        )}
        {showPermanentDelete && (
          <div
            className="kill-session-option-toggle"
            onClick={(e) => { e.stopPropagation(); setPermanent((p) => !p); }}
          >
            <span className={`kill-session-toggle-check ${permanent ? "checked" : ""}`}>
              {permanent && <Icon name="check" size={10} />}
            </span>
            <span>{permanentDeleteLabel} <span className="hint-muted">(won't appear in archived list)</span></span>
            <kbd>D</kbd>
          </div>
        )}
        <div className="kill-session-popup-actions">
          <button
            className={`kill-session-btn confirm${danger ? "" : " non-danger"}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onConfirm(showPermanentDelete ? permanent : undefined)}
          >
            <kbd>Y</kbd> {showPermanentDelete && permanent ? "Yes, delete permanently" : confirmLabel}
          </button>
          <button
            className="kill-session-btn cancel"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onCancel}
          >
            <kbd>N</kbd> {cancelLabel}
          </button>
        </div>
        <div className="new-session-popup-hint">
          <kbd>Enter</kbd> / <kbd>Y</kbd> to confirm{showPermanentDelete && <> · <kbd>D</kbd> toggle delete</>} · <kbd>Esc</kbd> / <kbd>N</kbd> to cancel
        </div>
      </div>
    </div>
  );
}
