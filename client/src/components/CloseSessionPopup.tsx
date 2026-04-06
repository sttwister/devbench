import { useState, useRef, useEffect } from "react";
import type { Session } from "../api";
import { getSourceLabel, getSourceIcon } from "../api";
import type { SourceType } from "../api";
import Icon from "./Icon";
import MrBadge from "./MrBadge";

interface Props {
  session: Session;
  onClose: () => void;
  /** Called when the user confirms close — parent handles navigation + background work. */
  onConfirmClose: (sessionId: number, pull: boolean) => void;
}

export default function CloseSessionPopup({ session, onClose, onConfirmClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pullEnabled, setPullEnabled] = useState(true);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  // Mirror the server-side filter: only open MRs will actually be merged.
  const openMrUrls = session.mr_urls.filter((url) => {
    const s = session.mr_statuses[url];
    return !s || (s.state !== "merged" && s.state !== "closed");
  });
  const doneMrUrls = session.mr_urls.filter((url) => {
    const s = session.mr_statuses[url];
    return s && (s.state === "merged" || s.state === "closed");
  });
  const hasMrs = openMrUrls.length > 0;
  const hasDoneMrs = doneMrUrls.length > 0;
  const hasLinear = session.source_type === "linear" && !!session.source_url;
  const hasJira = session.source_type === "jira" && !!session.source_url;

  const handleConfirm = () => {
    onConfirmClose(session.id, pullEnabled);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key.toLowerCase() === "n") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" || e.key.toLowerCase() === "y") {
      e.preventDefault();
      handleConfirm();
    } else if (e.key.toLowerCase() === "p" && hasMrs) {
      e.preventDefault();
      setPullEnabled((v) => !v);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="new-session-popup-backdrop" onClick={handleBackdropClick}>
      <div
        className="close-session-popup"
        ref={ref}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="close-session-header">
          <Icon name="archive" size={16} />
          <span className="close-session-title">Close Session</span>
          <button className="close-session-close-btn" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

            <div className="close-session-body">
              {session.has_changes && (
                <div className="close-session-warning">
                  <Icon name="alert-triangle" size={14} />
                  <span>This session has unsaved changes that haven't been committed.</span>
                </div>
              )}
              <p className="close-session-desc">
                Closing <strong>{session.name}</strong> will:
              </p>
              <ul className="close-session-actions-list">
                {hasMrs && (
                  <li>
                    <Icon name="git-merge" size={13} />
                    <span>
                      Merge {openMrUrls.length} MR/PR{openMrUrls.length !== 1 ? "s" : ""}:
                    </span>
                    <div className="close-session-links">
                      {openMrUrls.map((url) => (
                        <MrBadge key={url} url={url} className="close-session-mr-badge" />
                      ))}
                    </div>
                  </li>
                )}
                {hasDoneMrs && (
                  <li className="close-session-done-mrs">
                    <Icon name="check-circle" size={13} />
                    <span>Already merged/closed (skip):</span>
                    <div className="close-session-links">
                      {doneMrUrls.map((url) => (
                        <MrBadge key={url} url={url} className="close-session-mr-badge" />
                      ))}
                    </div>
                  </li>
                )}
                {hasLinear && (
                  <li>
                    <Icon name="check-circle" size={13} />
                    <span>Set Linear issue to Done:</span>
                    <a
                      className="close-session-source-link"
                      href={session.source_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Icon name={getSourceIcon(session.source_type as SourceType)} size={11} />
                      {getSourceLabel(session.source_url!) || session.source_type || "issue"}
                    </a>
                  </li>
                )}
                {hasJira && (
                  <li>
                    <Icon name="check-circle" size={13} />
                    <span>Set JIRA issue to Done:</span>
                    <a
                      className="close-session-source-link"
                      href={session.source_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Icon name={getSourceIcon(session.source_type as SourceType)} size={11} />
                      {getSourceLabel(session.source_url!) || session.source_type || "issue"}
                    </a>
                  </li>
                )}
                {hasMrs && (
                  <li
                    className="close-session-option-toggle"
                    onClick={() => setPullEnabled((v) => !v)}
                  >
                    <span className={`close-session-checkbox ${pullEnabled ? "checked" : ""}`}>
                      {pullEnabled && <Icon name="check" size={10} />}
                    </span>
                    <span>Pull on GitButler after merge</span>
                    <kbd>P</kbd>
                  </li>
                )}
                <li>
                  <Icon name="archive" size={13} />
                  <span>Archive the session</span>
                </li>
              </ul>
            </div>

            <div className="close-session-footer">
              <button
                className="btn btn-success"
                onClick={handleConfirm}
              >
                <kbd>Y</kbd> <Icon name="archive" size={13} /> Close Session
              </button>
              <button
                className="btn btn-secondary"
                onClick={onClose}
              >
                <kbd>N</kbd> Cancel
              </button>
            </div>
            <div className="new-session-popup-hint">
              <kbd>Enter</kbd> / <kbd>Y</kbd> to confirm · <kbd>Esc</kbd> / <kbd>N</kbd> to cancel{hasMrs && <> · <kbd>P</kbd> toggle pull</>}
            </div>
      </div>
    </div>
  );
}
