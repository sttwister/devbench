import { useEffect, useState } from "react";
import type { CloseSessionResult, CloseSessionPullResult, MergeResult } from "../api";
import Icon from "./Icon";

export interface CloseToastState {
  sessionName: string;
  result: CloseSessionResult | null;
  error: string | null;
}

interface Props {
  toast: CloseToastState;
  onDismiss: () => void;
}

export default function CloseSessionToast({ toast, onDismiss }: Props) {
  const [visible, setVisible] = useState(true);

  // Auto-dismiss after 6 seconds once results arrive (or on error)
  useEffect(() => {
    if (!toast.result && !toast.error) return;
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300); // wait for fade-out
    }, 6000);
    return () => clearTimeout(timer);
  }, [toast.result, toast.error, onDismiss]);

  const { result, error, sessionName } = toast;

  return (
    <div className={`close-session-toast ${visible ? "visible" : "hiding"}`} onClick={onDismiss}>
      <div className="close-session-toast-header">
        <Icon name="archive" size={13} />
        <span className="close-session-toast-title">
          {result || error ? sessionName : `Closing ${sessionName}…`}
        </span>
        <button className="close-session-toast-dismiss" onClick={onDismiss}>
          <Icon name="x" size={12} />
        </button>
      </div>
      {!result && !error && (
        <div className="close-session-toast-body">
          <Icon name="loader" size={12} />
          <span>Merging MRs, updating issues…</span>
        </div>
      )}
      {error && (
        <div className="close-session-toast-body error">
          <Icon name="x-circle" size={12} />
          <span>{error}</span>
        </div>
      )}
      {result && (
        <div className="close-session-toast-results">
          {result.mergeResults.length > 0 &&
            result.mergeResults.map((mr: MergeResult) => (
              <div key={mr.url} className={`close-session-result-item ${mr.outcome}`}>
                <Icon
                  name={mr.outcome === "merged" ? "check" : mr.outcome === "auto-merge" ? "loader" : "x-circle"}
                  size={11}
                />
                <span>{shortMrLabel(mr.url)}: {mr.message}</span>
              </div>
            ))}
          {result.linearResult && (
            <div className={`close-session-result-item ${result.linearResult.newState ? "merged" : "error"}`}>
              <Icon name={result.linearResult.newState ? "check" : "x-circle"} size={11} />
              <span>
                {result.linearResult.identifier}:{" "}
                {result.linearResult.newState
                  ? `→ ${result.linearResult.newState}`
                  : "Failed to update"}
              </span>
            </div>
          )}
          {result.jiraResult && (
            <div className={`close-session-result-item ${result.jiraResult.newState ? "merged" : "error"}`}>
              <Icon name={result.jiraResult.newState ? "check" : "x-circle"} size={11} />
              <span>
                {result.jiraResult.key}:{" "}
                {result.jiraResult.newState
                  ? `→ ${result.jiraResult.newState}`
                  : "Failed to update"}
              </span>
            </div>
          )}
          {result.archived && (
            <div className="close-session-result-item merged">
              <Icon name="check" size={11} />
              <span>Session archived</span>
            </div>
          )}
          {result.pullResults.length > 0 &&
            result.pullResults.map((pr: CloseSessionPullResult) => (
              <div key={pr.projectId} className={`close-session-result-item ${pr.success ? (pr.hasConflicts ? "auto-merge" : "merged") : "error"}`}>
                <Icon
                  name={pr.success ? (pr.hasConflicts ? "alert-circle" : "check") : "x-circle"}
                  size={11}
                />
                <span>
                  {pr.projectName}:{" "}
                  {pr.success
                    ? pr.hasConflicts ? "pulled with conflicts" : "pulled successfully"
                    : `pull failed: ${pr.error}`}
                </span>
              </div>
            ))}
        </div>
      )}
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
