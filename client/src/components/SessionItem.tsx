import { useRef, useEffect } from "react";
import type { Session, AgentStatus } from "../api";
import { getMrLabel, getSessionIcon } from "../api";

interface Props {
  session: Session;
  projectId: number;
  isActive: boolean;
  isOrphaned: boolean;
  agentStatus: AgentStatus | undefined;
  dropClass: string;
  isDragSource: boolean;
  renamingSessionId: number | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onCommitRename: (sessionId: number) => void;
  onCancelRename: () => void;
  onStartRename: (sessionId: number, currentName: string) => void;
  onSelectSession: (session: Session) => void;
  onDeleteSession: (id: number) => void;
  onReviveSession: (id: number) => void;
  onOpenMrLink: (session: Session, url: string) => void;
  onGripMouseDown: (e: React.MouseEvent) => void;
  onTouchGripStart: (e: React.TouchEvent, kind: "session", id: number, projectId: number) => void;
  onDragStart: (e: React.DragEvent, sessionId: number, projectId: number) => void;
  onDragEnd: () => void;
}

export default function SessionItem({
  session,
  projectId,
  isActive,
  isOrphaned,
  agentStatus,
  dropClass,
  isDragSource,
  renamingSessionId,
  renameValue,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onStartRename,
  onSelectSession,
  onDeleteSession,
  onReviveSession,
  onOpenMrLink,
  onGripMouseDown,
  onTouchGripStart,
  onDragStart,
  onDragEnd,
}: Props) {
  const renameInputRef = useRef<HTMLInputElement>(null);
  const isRenaming = renamingSessionId === session.id;

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  return (
    <div
      className={`session-item ${isActive ? "active" : ""}${isOrphaned ? " orphaned" : ""} ${dropClass} ${isDragSource ? "drag-source" : ""}`}
      data-session-drag-id={session.id}
      data-session-project-id={projectId}
      draggable
      onDragStart={(e) => onDragStart(e, session.id, projectId)}
      onDragEnd={onDragEnd}
      onClick={() => onSelectSession(session)}
    >
      <div className="session-row">
        <span
          className="drag-handle session-drag-handle"
          onMouseDown={onGripMouseDown}
          onTouchStart={(e) => onTouchGripStart(e, "session", session.id, projectId)}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
        >⠿</span>
        <span className={`session-icon${isOrphaned ? " dimmed" : ""}`}>
          {getSessionIcon(session.type)}
        </span>
        {!isOrphaned && agentStatus && (
          <span
            className={`agent-status-dot ${agentStatus}`}
            title={agentStatus === "working" ? "Working" : "Waiting for input"}
          />
        )}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="session-rename-input"
            value={renameValue}
            onChange={(e) => onRenameValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename(session.id);
              else if (e.key === "Escape") onCancelRename();
              e.stopPropagation();
            }}
            onBlur={() => onCommitRename(session.id)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className={`session-name${isOrphaned ? " dimmed" : ""}`}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onStartRename(session.id, session.name);
            }}
          >
            {session.name}
          </span>
        )}
        {isOrphaned && (
          <button
            className="icon-btn revive small"
            title="Revive session"
            onClick={(e) => {
              e.stopPropagation();
              onReviveSession(session.id);
            }}
          >
            🔄
          </button>
        )}
        <button
          className="icon-btn danger small"
          title={isOrphaned ? "Remove session" : "Kill session"}
          onClick={(e) => {
            e.stopPropagation();
            onDeleteSession(session.id);
          }}
        >
          ×
        </button>
      </div>
      {session.mr_urls.length > 0 && (
        <div className="session-meta">
          {session.mr_urls.map((url) => (
            <button
              key={url}
              className="session-mr-link"
              title={url}
              onClick={(e) => {
                e.stopPropagation();
                onOpenMrLink(session, url);
              }}
            >
              {getMrLabel(url)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
