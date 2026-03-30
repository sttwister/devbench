import { useRef, useMemo } from "react";
import type { ReactNode } from "react";
import type { SessionType } from "../api";
import { getSessionIcon } from "../api";
import { useTerminal } from "../hooks/useTerminal";
import { useTerminalWebSocket } from "../hooks/useTerminalWebSocket";
import { useTerminalTouchScroll } from "../hooks/useTerminalTouchScroll";
import { useTerminalAutoFocus } from "../hooks/useTerminalAutoFocus";
import { useMobileKeyboard } from "../hooks/useMobileKeyboard";
import MobileKeyboardBar from "./MobileKeyboardBar";
import Icon from "./Icon";
import "@xterm/xterm/css/xterm.css";

interface Props {
  sessionId: number;
  sessionName: string;
  sessionType: SessionType;
  headerLeft?: ReactNode;
  headerActions?: ReactNode;
  onSessionEnded?: () => void;
  onSessionRenamed?: (newName: string) => void;
  onMrLinkFound?: () => void;
}

export default function TerminalPane({
  sessionId,
  sessionName,
  sessionType,
  headerLeft,
  headerActions,
  onSessionEnded,
  onSessionRenamed,
  onMrLinkFound,
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
  useTerminalWebSocket(sessionId, termRef, fitRef, callbacks, wsRef, mobileKeyboard.dataTransformRef);
  useTerminalTouchScroll(containerRef, termRef, wsRef);
  useTerminalAutoFocus(containerRef, termRef);

  return (
    <div className="terminal-pane">
      <div className="terminal-header">
        {headerLeft}
        <span className="terminal-icon">
          <Icon name={getSessionIcon(sessionType)} size={16} />
        </span>
        <span className="terminal-title">{sessionName}</span>
        <div className="terminal-header-spacer" />
        {headerActions}
      </div>
      <div className="terminal-container" ref={containerRef} />
      <MobileKeyboardBar
        ctrlState={mobileKeyboard.ctrlState}
        altState={mobileKeyboard.altState}
        onToggleCtrl={mobileKeyboard.toggleCtrl}
        onToggleAlt={mobileKeyboard.toggleAlt}
        onSendKey={mobileKeyboard.sendKey}
      />
    </div>
  );
}
