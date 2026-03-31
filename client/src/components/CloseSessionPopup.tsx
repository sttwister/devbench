import { useState, useCallback, useRef, useEffect } from "react";
import type { Session, CloseSessionResult, MergeResult } from "../api";
import { closeSession } from "../api";
import Icon from "./Icon";

interface Props {
  session: Session;
  onClose: () => void;
  /** Called after the session has been successfully closed. */
  onSessionClosed: (sessionId: number) => void;
}

export default function CloseSessionPopup({ session, onClose, onSessionClosed }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [result, setResult] = useState<CloseSessionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const hasMrs = session.mr_urls.length > 0;
  const hasLinear = session.source_type === "linear" && !!session.source_url;

  const handleConfirm = useCallback(async () => {
    setClosing(true);
    setError(null);
    try {
      const res = await closeSession(session.id);
      setResult(res);
      // Notify parent after short delay so user can see results
      setTimeout(() => {
        onSessionClosed(session.id);
      }, 1500);
    } catch (e: any) {
      setError(e.message);
      setClosing(false);
    }
  }, [session.id, onSessionClosed]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && !closing && !result) {
      e.preventDefault();
      handleConfirm();
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

        {!result ? (
          <>
            <div className="close-session-body">
              <p className="close-session-desc">
                Closing <strong>{session.name}</strong> will:
              </p>
              <ul className="close-session-actions-list">
                {hasMrs && (
                  <li>
                    <Icon name="git-merge" size={13} />
                    <span>Merge {session.mr_urls.length} MR/PR{session.mr_urls.length !== 1 ? "s" : ""}</span>
                  </li>
                )}
                {hasLinear && (
                  <li>
                    <Icon name="check-circle" size={13} />
                    <span>Set Linear issue to Done</span>
                  </li>
                )}
                <li>
                  <Icon name="archive" size={13} />
                  <span>Archive the session</span>
                </li>
              </ul>
            </div>

            {error && (
              <div className="close-session-error">
                <Icon name="alert-circle" size={13} />
                <span>{error}</span>
              </div>
            )}

            <div className="close-session-footer">
              <button
                className="btn btn-secondary"
                onClick={onClose}
                disabled={closing}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={handleConfirm}
                disabled={closing}
              >
                {closing ? (
                  <><Icon name="loader" size={13} /> Closing…</>
                ) : (
                  <><Icon name="archive" size={13} /> Close Session</>
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="close-session-results">
            {result.mergeResults.length > 0 && (
              <div className="close-session-result-group">
                <span className="close-session-result-label">MR/PR Merges</span>
                {result.mergeResults.map((mr: MergeResult) => (
                  <div key={mr.url} className={`close-session-result-item ${mr.outcome}`}>
                    <Icon
                      name={mr.outcome === "merged" ? "check" : mr.outcome === "auto-merge" ? "loader" : "x-circle"}
                      size={12}
                    />
                    <span>{shortMrLabel(mr.url)}: {mr.message}</span>
                  </div>
                ))}
              </div>
            )}
            {result.linearResult && (
              <div className="close-session-result-group">
                <span className="close-session-result-label">Linear Issue</span>
                <div className={`close-session-result-item ${result.linearResult.newState ? "merged" : "error"}`}>
                  <Icon name={result.linearResult.newState ? "check" : "x-circle"} size={12} />
                  <span>
                    {result.linearResult.identifier}:{" "}
                    {result.linearResult.newState
                      ? `→ ${result.linearResult.newState}`
                      : "Failed to update"}
                  </span>
                </div>
              </div>
            )}
            {result.archived && (
              <div className="close-session-result-group">
                <div className="close-session-result-item merged">
                  <Icon name="check" size={12} />
                  <span>Session archived</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function shortMrLabel(url: string): string {
  const gh = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (gh) return `${gh[1]}#${gh[2]}`;
  const gl = url.match(/([^/]+)\/-\/merge_requests\/(\d+)/);
  if (gl) return `${gl[1]}!${gl[2]}`;
  return url;
}
