import { useRef, useMemo, useEffect } from "react";
import type { ReactNode } from "react";
import type { SessionType, MrStatus } from "../api";
import { getSessionIcon, getMrLabel, getMrStatusClass, getMrStatusTooltip, getSourceLabel, getSourceIcon } from "../api";
import { useTerminal } from "../hooks/useTerminal";
import { useTerminalWebSocket } from "../hooks/useTerminalWebSocket";
import { useTerminalTouchScroll } from "../hooks/useTerminalTouchScroll";
import { useTerminalAutoFocus } from "../hooks/useTerminalAutoFocus";
import { useMobileKeyboard } from "../hooks/useMobileKeyboard";
import { useMobileNativeInput } from "../hooks/useMobileNativeInput";
import MobileKeyboardBar from "./MobileKeyboardBar";
import Icon from "./Icon";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: number;
  sessionName: string;
  sessionType: SessionType;
  mrUrls?: string[];
  mrStatuses?: Record<string, MrStatus>;
  sourceUrl?: string | null;
  sourceType?: string | null;
  headerLeft?: ReactNode;
  headerActions?: ReactNode;
  onSessionEnded?: () => void;
  onSessionRenamed?: (newName: string) => void;
  onMrLinkFound?: () => void;
  /** Ref populated with a function that sends a command string to the terminal. */
  sendCommandRef?: React.MutableRefObject<((cmd: string) => void) | null>;
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
  sendCommandRef,
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
  useTerminalTouchScroll(
    containerRef, termRef, wsRef,
    mobileInput.enabled ? mobileInput.focus : undefined,
  );
  useTerminalAutoFocus(containerRef, termRef);

  // Expose a "send command" function so parent components (shortcuts, etc.)
  // can inject text into the terminal via the WebSocket.
  const sendCommand = useMemo(() => (cmd: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(cmd);
    }
  }, []);

  useEffect(() => {
    if (sendCommandRef) sendCommandRef.current = sendCommand;
    return () => { if (sendCommandRef) sendCommandRef.current = null; };
  }, [sendCommand, sendCommandRef]);

  const isAgentSession = sessionType !== "terminal";

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
            {mrUrls.map((url) => {
              const status = mrStatuses[url];
              const statusClass = getMrStatusClass(status);
              const tooltip = status
                ? `${url}\n${getMrStatusTooltip(status)}`
                : url;
              return (
                <button
                  key={url}
                  className={`terminal-header-link mr-link mr-status-${statusClass}`}
                  title={tooltip}
                  onClick={() => window.open(url, "_blank")}
                >
                  {getMrLabel(url)}
                </button>
              );
            })}
          </div>
        )}
        <div className="terminal-header-spacer" />
        {isAgentSession && (
          <button
            className="icon-btn git-push-btn"
            title="Git commit & push (Ctrl+Shift+G)"
            onClick={() => sendCommand("/git-commit-and-push\r")}
          >
            <Icon name="git-merge" size={16} />
          </button>
        )}
        {headerActions}
      </div>
      <div className="terminal-container" ref={containerRef} />
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
        onGitCommitPush={isAgentSession ? () => sendCommand("/git-commit-and-push\r") : undefined}
      />
    </div>
  );
}
