import { useState, useCallback, useRef, useEffect } from "react";
import type { Session, CloseSessionResult, MergeResult } from "../api";
import { closeSession, getSourceLabel, getSourceIcon } from "../api";
import type { SourceType } from "../api";
import Icon from "./Icon";
import MrBadge from "./MrBadge";

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
    if (e.key === "Escape" || e.key.toLowerCase() === "n") {
      e.preventDefault();
      onClose();
    } else if ((e.key === "Enter" || e.key.toLowerCase() === "y") && !closing && !result) {
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
                className="btn btn-success"
                onClick={handleConfirm}
                disabled={closing}
              >
                {closing ? (
                  <><Icon name="loader" size={13} /> Closing…</>
                ) : (
                  <><kbd>Y</kbd> <Icon name="archive" size={13} /> Close Session</>
                )}
              </button>
              <button
                className="btn btn-secondary"
                onClick={onClose}
                disabled={closing}
              >
                <kbd>N</kbd> Cancel
              </button>
            </div>
            <div className="new-session-popup-hint">
              <kbd>Enter</kbd> / <kbd>Y</kbd> to confirm · <kbd>Esc</kbd> / <kbd>N</kbd> to cancel
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
