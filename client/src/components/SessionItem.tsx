import { useRef, useEffect } from "react";
import type { Session } from "../api";
import { getMrLabel, getMrStatusClass, getMrStatusTooltip, getSessionIcon, getSourceLabel, getSourceIcon } from "../api";
import { useSidebarContext } from "./SidebarContext";
import Icon from "./Icon";

interface Props {
  session: Session;
  projectId: number;
  sessionIndex: number;
  totalSessions: number;
}

export default function SessionItem({
  session,
  projectId,
  sessionIndex,
  totalSessions,
}: Props) {
  const {
    activeSessionId,
    agentStatuses,
    orphanedSessionIds,
    rename,
    dnd,
    onSelectSession,
    onDeleteSession,
    onReviveSession,
    onOpenMrLink,
  } = useSidebarContext();

  const renameInputRef = useRef<HTMLInputElement>(null);

  const isActive = activeSessionId === session.id;
  const isOrphaned = orphanedSessionIds.has(session.id);
  const agentStatus = agentStatuses[session.id];
  const isRenaming = rename.renamingSessionId === session.id;
  const dropClass = dnd.getSessionDropClass(projectId, sessionIndex, totalSessions);
  const isDragSource = dnd.activeDrag?.kind === "session" && dnd.activeDrag.id === session.id;

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
      onDragStart={(e) => dnd.handleSessionDragStart(e, session.id, projectId)}
      onDragEnd={dnd.handleDragEnd}
      onClick={() => onSelectSession(session)}
    >
      <div className="session-row">
        <span
          className="drag-handle session-drag-handle"
          onMouseDown={dnd.handleGripMouseDown}
          onTouchStart={(e) => dnd.handleTouchGripStart(e, "session", session.id, projectId)}
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
        ><Icon name="grip-vertical" size={12} /></span>
        <span className={`session-icon${isOrphaned ? " dimmed" : ""}`}>
          <Icon name={getSessionIcon(session.type)} size={14} />
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
            value={rename.renameValue}
            onChange={(e) => rename.setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") rename.commitRename(session.id);
              else if (e.key === "Escape") rename.cancelRename();
              e.stopPropagation();
            }}
            onBlur={() => rename.commitRename(session.id)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className={`session-name${isOrphaned ? " dimmed" : ""}`}
            onDoubleClick={(e) => {
              e.stopPropagation();
              rename.startRename(session.id, session.name);
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
            <Icon name="refresh-cw" size={12} />
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
          <Icon name="x" size={12} />
        </button>
      </div>
      {(session.source_url || session.mr_urls.length > 0) && (
        <div className="session-meta">
          {session.source_url && (
            <button
              className="session-source-link"
              title={session.source_url}
              onClick={(e) => {
                e.stopPropagation();
                window.open(session.source_url!, "_blank");
              }}
            >
              <Icon name={getSourceIcon(session.source_type as any)} size={11} />
              <span>{getSourceLabel(session.source_url) || session.source_type || "source"}</span>
            </button>
          )}
          {session.mr_urls.map((url) => {
            const status = session.mr_statuses?.[url];
            const statusClass = getMrStatusClass(status);
            const tooltip = status
              ? `${url}\n${getMrStatusTooltip(status)}`
              : url;
            return (
              <button
                key={url}
                className={`session-mr-link mr-status-${statusClass}`}
                title={tooltip}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenMrLink(session, url);
                }}
              >
                {getMrLabel(url)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
