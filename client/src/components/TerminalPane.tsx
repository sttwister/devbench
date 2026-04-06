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
import { useMrStatus } from "../contexts/MrStatusContext";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: number;
  sessionName: string;
  sessionType: SessionType;
  gitBranch?: string | null;
  mrUrls?: string[];
  sourceUrl?: string | null;
  sourceType?: string | null;
  headerLeft?: ReactNode;
  headerActions?: ReactNode;
  onSessionEnded?: () => void;
  onSessionRenamed?: (newName: string) => void;
  onMrLinkFound?: () => void;
  /** Ref populated with the git-commit-push action for use by parent shortcuts. */
  gitCommitPushRef?: React.MutableRefObject<((branchName?: string | null, staleBranch?: string | null) => void) | null>;
  /** True while prepare-commit-push is in flight — shows a loading indicator. */
  gitCommitPushPending?: boolean;
  onOpenGitButlerDashboard?: () => void;
  /** Close session action (merge PRs + mark issue done + archive). */
  onCloseSession?: () => void;
}

export default function TerminalPane({
  sessionId,
  sessionName,
  sessionType,
  gitBranch,
  mrUrls = [],
  sourceUrl,
  sourceType,
  headerLeft,
  headerActions,
  onSessionEnded,
  onSessionRenamed,
  onMrLinkFound,
  gitCommitPushRef,
  gitCommitPushPending,
  onOpenGitButlerDashboard,
  onCloseSession,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Stable callbacks object — the hooks use refs internally
  const { mergeStatuses } = useMrStatus();

  const callbacks = useMemo(() => ({
    onSessionEnded,
    onSessionRenamed,
    onMrLinkFound,
    onMrStatusChanged: mergeStatuses, // updates the global MR status store directly
  }), [onSessionEnded, onSessionRenamed, onMrLinkFound, mergeStatuses]);

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
    return (branchName?: string | null, staleBranch?: string | null) => {
      const command = sessionType === "pi"
        ? "/skill:git-commit-and-push"
        : "/git-commit-and-push";
      const targetBranch = branchName?.trim() || gitBranch?.trim() || "";
      let args = targetBranch ? ` use branch name ${targetBranch}` : "";
      if (targetBranch && staleBranch?.trim()) {
        args += ` stacked on ${staleBranch.trim()}`;
      }
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(`${command}${args}\r`);
    };
  }, [gitBranch, isAgentSession, sessionType]);

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
        {gitCommitPushPending && (
          <span className="git-commit-push-preparing" title="Preparing branch name…">
            <Icon name="loader" size={12} /> Preparing…
          </span>
        )}
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
                className="terminal-header-link"
              />
            ))}
          </div>
        )}
        <div className="terminal-header-spacer" />
        <div className="terminal-header-actions">
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
        onCloseSession={onCloseSession}
        onUploadFiles={uploadFiles}
        selectionMode={selectionMode}
        onCopySelection={copySelection}
        onSelectAll={selectAllText}
        onCancelSelection={cancelSelection}
      />
    </div>
  );
}
