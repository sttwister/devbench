import { useState, useRef, useEffect, useCallback } from "react";
import type { Session } from "../api";
import { getSessionIcon, getSourceLabel, getSourceIcon } from "../api";
import { useSidebarContext } from "./SidebarContext";
import Icon from "./Icon";
import MrBadge from "./MrBadge";

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
    processingSourceSessionIds,
    notifiedSessionIds,
    rename,
    dnd,
    onSelectSession,
    onDeleteSession,
    onReviveSession,
    onOpenMrLink,
    onEditSession,
    onMarkSessionUnread,
    onClearAllMrUrls,
  } = useSidebarContext();

  const renameInputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => clearLongPress, [clearLongPress]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const isActive = activeSessionId === session.id;
  const isOrphaned = orphanedSessionIds.has(session.id);
  const isProcessingSource = processingSourceSessionIds.has(session.id);
  const isNotified = notifiedSessionIds.has(session.id);
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

  const closeMenuAndRun = (fn: () => void) => {
    setMenuOpen(false);
    fn();
  };

  const touchDragProps = dnd.getTouchDragProps("session", session.id, projectId);

  return (
    <div
      className={`session-item ${isActive ? "active" : ""}${isOrphaned ? " orphaned" : ""}${isNotified ? " needs-attention" : ""} ${dropClass} ${isDragSource ? "drag-source" : ""}`}
      data-session-drag-id={session.id}
      data-session-project-id={projectId}
      draggable
      onDragStart={(e) => dnd.handleSessionDragStart(e, session.id, projectId)}
      onDragEnd={dnd.handleDragEnd}
      onClick={() => {
        if (longPressFired.current) {
          longPressFired.current = false;
          return;
        }
        onSelectSession(session);
      }}
      {...touchDragProps}
    >
      <div className="session-row">
        <span className={`session-icon${isOrphaned ? " dimmed" : ""}`}>
          <Icon name={getSessionIcon(session.type)} size={14} />
        </span>
        {!isOrphaned && agentStatus && (
          <span
            className={`agent-status-dot ${agentStatus}`}
            title={agentStatus === "working" ? "Working" : "Waiting for input"}
          />
        )}
        {session.has_changes && (
          <span
            className="session-has-changes-dot"
            title="Unsaved changes"
          />
        )}
        {/* Persistent wrapper – rename deferred to touchend so the input
             appears only after the finger lifts (avoids touch-vs-focus conflicts) */}
        <div
          className="session-name-touch-wrapper"
          onTouchStart={() => {
            if (isRenaming) return;
            longPressFired.current = false;
            longPressTimer.current = setTimeout(() => {
              longPressFired.current = true;
            }, 500);
          }}
          onTouchMove={() => { if (!isRenaming) clearLongPress(); }}
          onTouchEnd={(e) => {
            clearLongPress();
            if (longPressFired.current) {
              longPressFired.current = false;
              e.preventDefault();
              e.stopPropagation();
              rename.startRename(session.id, session.name);
            }
          }}
        >
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
        </div>
        {isProcessingSource && (
          <span className="session-processing-spinner" title="Fetching issue details…">
            <Icon name="loader" size={12} />
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
        <div className="session-menu-wrapper" ref={menuRef}>
          <button
            className={`icon-btn session-menu-trigger small${menuOpen ? " active" : ""}`}
            title="More actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((prev) => !prev);
            }}
          >
            <Icon name="ellipsis-vertical" size={12} />
          </button>
          {menuOpen && (
            <div className="session-menu">
              <button
                className="session-menu-item"
                onClick={(e) => { e.stopPropagation(); closeMenuAndRun(() => onEditSession(session.id)); }}
              >
                <Icon name="pencil" size={13} />
                <span>Edit session links</span>
              </button>
              <button
                className="session-menu-item"
                onClick={(e) => { e.stopPropagation(); closeMenuAndRun(() => onMarkSessionUnread(session.id)); }}
              >
                <Icon name="bell-ring" size={13} />
                <span>Mark unread</span>
              </button>
              {session.mr_urls.length > 0 && (
                <button
                  className="session-menu-item"
                  onClick={(e) => { e.stopPropagation(); closeMenuAndRun(() => onClearAllMrUrls(session.id)); }}
                >
                  <Icon name="trash-2" size={13} />
                  <span>Clear all MRs</span>
                </button>
              )}
              <div className="session-menu-divider" />
              <button
                className="session-menu-item danger"
                onClick={(e) => { e.stopPropagation(); closeMenuAndRun(() => onDeleteSession(session.id)); }}
              >
                <Icon name="x" size={13} />
                <span>{isOrphaned ? "Remove session" : "Archive session"}</span>
              </button>
            </div>
          )}
        </div>
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
          {session.mr_urls.map((url) => (
            <MrBadge
              key={url}
              url={url}
              className="session-mr-link"
            />
          ))}
        </div>
      )}
    </div>
  );
}
