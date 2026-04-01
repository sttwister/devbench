import { useState, useEffect, useRef } from "react";
import { fetchArchivedSessions, getSessionIcon, getSourceLabel, getSourceIcon } from "../api";
import type { Session, MrStatus } from "../api";
import { useMrStatus } from "../contexts/MrStatusContext";
import Icon from "./Icon";
import MrBadge from "./MrBadge";

interface Props {
  projectId: number;
  projectName: string;
  onRevive: (sessionId: number) => void;
  onDelete: (sessionId: number) => void;
  onClose: () => void;
}

export default function ArchivedSessionsPopup({
  projectId,
  projectName,
  onRevive,
  onDelete,
  onClose,
}: Props) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [reviving, setReviving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { mergeStatuses } = useMrStatus();

  useEffect(() => {
    fetchArchivedSessions(projectId)
      .then((archived) => {
        setSessions(archived);
        // Merge archived session statuses into the global store so
        // MrBadge components display correct status.
        const all: Record<string, MrStatus> = {};
        for (const s of archived) {
          if (s.mr_statuses) Object.assign(all, s.mr_statuses);
        }
        if (Object.keys(all).length > 0) mergeStatuses(all);
      })
      .catch((e) => setError(e.message));
  }, [projectId, mergeStatuses]);

  useEffect(() => {
    containerRef.current?.focus();
  }, [sessions]);

  const handleRevive = async (id: number) => {
    setReviving(id);
    try {
      onRevive(id);
    } finally {
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null);
      setReviving(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!sessions || sessions.length === 0) {
      if (e.key === "Escape") onClose();
      return;
    }

    if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, sessions.length - 1));
    } else if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = sessions[selectedIdx];
      if (s && reviving !== s.id) handleRevive(s.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Keep selected index in bounds when list shrinks
  useEffect(() => {
    if (sessions && selectedIdx >= sessions.length) {
      setSelectedIdx(Math.max(0, sessions.length - 1));
    }
  }, [sessions, selectedIdx]);

  // Scroll selected row into view
  useEffect(() => {
    if (!sessions) return;
    const row = containerRef.current?.querySelector(".archived-session-row.selected");
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx, sessions]);

  return (
    <div className="popup-overlay" onClick={onClose}>
      <div
        className="archived-sessions-popup"
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="archived-popup-header">
          <h3>Archived Sessions — {projectName}</h3>
          <button className="icon-btn" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="archived-popup-body">
          {error && <div className="archived-error">{error}</div>}

          {sessions === null && !error && (
            <div className="archived-loading">Loading…</div>
          )}

          {sessions && sessions.length === 0 && (
            <div className="archived-empty">No archived sessions</div>
          )}

          {sessions &&
            sessions.map((s, i) => (
              <div
                key={s.id}
                className={`archived-session-row${i === selectedIdx ? " selected" : ""}`}
                onClick={() => setSelectedIdx(i)}
                onDoubleClick={() => handleRevive(s.id)}
              >
                <span className="archived-session-icon">
                  <Icon name={getSessionIcon(s.type)} size={16} />
                </span>
                <div className="archived-session-info">
                  <span className="archived-session-name">{s.name}</span>
                  <span className="archived-session-meta">
                    {s.type}
                    {s.agent_session_id ? " · resumable" : ""}
                    {s.source_url && (
                      <>
                        {" · "}
                        <a
                          className="archived-source-link"
                          href={s.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={s.source_url}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Icon name={getSourceIcon(s.source_type as any)} size={11} />
                          {getSourceLabel(s.source_url) || s.source_type || "source"}
                        </a>
                      </>
                    )}
                    {s.mr_urls.length > 0 && " · "}
                    {s.mr_urls.map((url) => (
                      <MrBadge key={url} url={url} className="archived-mr-link" />
                    ))}
                  </span>
                </div>
                <button
                  className="archived-revive-btn"
                  disabled={reviving === s.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRevive(s.id);
                  }}
                  title="Revive session"
                >
                  {reviving === s.id ? <Icon name="loader" size={14} /> : <Icon name="archive-restore" size={14} />}
                </button>
                <button
                  className="archived-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Permanently delete "${s.name}"?`)) {
                      onDelete(s.id);
                      setSessions((prev) => prev?.filter((x) => x.id !== s.id) ?? null);
                    }
                  }}
                  title="Delete permanently"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
        </div>

        <div className="archived-popup-footer">
          <kbd>j</kbd>/<kbd>k</kbd> navigate · <kbd>Enter</kbd> revive · <kbd>Esc</kbd> close
        </div>
      </div>
    </div>
  );
}
