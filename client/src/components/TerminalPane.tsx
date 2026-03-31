import { useRef, useMemo, useEffect } from "react";
import type { ReactNode } from "react";
import type { SessionType } from "../api";
import { getSessionIcon, getSourceLabel, getSourceIcon } from "../api";
import { useTerminal } from "../hooks/useTerminal";
import { useTerminalWebSocket } from "../hooks/useTerminalWebSocket";
import { useTerminalTouchScroll } from "../hooks/useTerminalTouchScroll";
import { useTerminalAutoFocus } from "../hooks/useTerminalAutoFocus";
import { useMobileKeyboard } from "../hooks/useMobileKeyboard";
import { useMobileNativeInput } from "../hooks/useMobileNativeInput";
import { useTerminalFileUpload } from "../hooks/useTerminalFileUpload";
import MobileKeyboardBar from "./MobileKeyboardBar";
import Icon from "./Icon";
import MrBadge from "./MrBadge";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: number;
  sessionName: string;
  sessionType: SessionType;
  mrUrls?: string[];
  mrStatuses?: Record<string, import("../api").MrStatus>;
  sourceUrl?: string | null;
  sourceType?: string | null;
  headerLeft?: ReactNode;
  headerActions?: ReactNode;
  onSessionEnded?: () => void;
  onSessionRenamed?: (newName: string) => void;
  onMrLinkFound?: () => void;
  /** Ref populated with the git-commit-push action for use by parent shortcuts. */
  gitCommitPushRef?: React.MutableRefObject<(() => void) | null>;
  onOpenGitButlerDashboard?: () => void;
}

export default function TerminalPane({
  sessionId,
  sessionName,
  sessionType,
  mrUrls = [],
  mrStatuses = {},
  sourceUrl,
  sourceType,
  headerLeft,
  headerActions,
  onSessionEnded,
  onSessionRenamed,
  onMrLinkFound,
  gitCommitPushRef,
  onOpenGitButlerDashboard,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Stable callbacks object — the hooks use refs internally
  const callbacks = useMemo(() => ({
    onSessionEnded,
    onSessionRenamed,
    onMrLinkFound,
    onMrStatusChanged: onMrLinkFound, // both trigger a project reload
  }), [onSessionEnded, onSessionRenamed, onMrLinkFound]);

  const { termRef, fitRef } = useTerminal(containerRef);
  const mobileKeyboard = useMobileKeyboard(termRef, wsRef);
  const mobileInput = useMobileNativeInput(wsRef, mobileKeyboard.dataTransformRef);

  // On mobile the native input sends data directly via WebSocket — xterm's
  // onData is disabled (disableStdin), so don't pass the dataTransform.
  // On desktop the existing dataTransformRef path is used.
  useTerminalWebSocket(
    sessionId, termRef, fitRef, callbacks, wsRef,
    mobileInput.enabled ? undefined : mobileKeyboard.dataTransformRef,
  );
  const {
    selectionMode, copySelection, cancelSelection, selectAllText,
    copiedFeedback, startHandleRef, endHandleRef,
  } =
    useTerminalTouchScroll(
      containerRef, termRef, wsRef,
      mobileInput.enabled ? mobileInput.focus : undefined,
    );
  useTerminalAutoFocus(containerRef, termRef);
  const { handleFiles: uploadFiles } = useTerminalFileUpload(containerRef, wsRef);

  const isAgentSession = sessionType !== "terminal";

  const gitCommitPush = useMemo(() => {
    if (!isAgentSession) return undefined;
    const cmd = sessionType === "pi"
      ? "/skill:git-commit-and-push\r"
      : "/git-commit-and-push\r";
    return () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(cmd);
    };
  }, [isAgentSession, sessionType]);

  useEffect(() => {
    if (gitCommitPushRef) gitCommitPushRef.current = gitCommitPush ?? null;
    return () => { if (gitCommitPushRef) gitCommitPushRef.current = null; };
  }, [gitCommitPush, gitCommitPushRef]);

  return (
    <div className="terminal-pane">
      <div className="terminal-header">
        {headerLeft}
        <span className="terminal-icon">
          <Icon name={getSessionIcon(sessionType)} size={16} />
        </span>
        <span className="terminal-title">{sessionName}</span>
        {(sourceUrl || mrUrls.length > 0) && (
          <div className="terminal-header-links">
            {sourceUrl && (
              <button
                className="terminal-header-link source-link"
                title={sourceUrl}
                onClick={() => window.open(sourceUrl!, "_blank")}
              >
                <Icon name={getSourceIcon(sourceType as any)} size={11} />
                <span>{getSourceLabel(sourceUrl) || sourceType || "source"}</span>
              </button>
            )}
            {mrUrls.map((url) => (
              <MrBadge
                key={url}
                url={url}
                status={mrStatuses[url]}
                className="terminal-header-link"
              />
            ))}
          </div>
        )}
        <div className="terminal-header-spacer" />
        {onOpenGitButlerDashboard && (
          <button
            className="icon-btn git-push-btn"
            title="GitButler Dashboard (Ctrl+Shift+D)"
            onClick={onOpenGitButlerDashboard}
          >
            <Icon name="git-graph" size={16} />
          </button>
        )}
        {headerActions}
      </div>
      <div className="terminal-container" ref={containerRef}>
        {copiedFeedback && (
          <div className="terminal-copied-toast">Copied to clipboard</div>
        )}
        <div
          ref={startHandleRef}
          className="selection-handle selection-handle-start"
          style={{ display: "none" }}
        />
        <div
          ref={endHandleRef}
          className="selection-handle selection-handle-end"
          style={{ display: "none" }}
        />
      </div>
      <MobileKeyboardBar
        ctrlState={mobileKeyboard.ctrlState}
        altState={mobileKeyboard.altState}
        onToggleCtrl={mobileKeyboard.toggleCtrl}
        onToggleAlt={mobileKeyboard.toggleAlt}
        onSendKey={mobileKeyboard.sendKey}
        inputRef={mobileInput.enabled ? mobileInput.inputRef : undefined}
        onInputCompositionStart={mobileInput.onCompositionStart}
        onInputCompositionEnd={mobileInput.onCompositionEnd}
        onInputInput={mobileInput.onInput}
        onInputKeyDown={mobileInput.onKeyDown}
        onGitCommitPush={gitCommitPush}
        onUploadFiles={uploadFiles}
        selectionMode={selectionMode}
        onCopySelection={copySelection}
        onSelectAll={selectAllText}
        onCancelSelection={cancelSelection}
      />
    </div>
  );
}
