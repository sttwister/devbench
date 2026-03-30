import { useRef, useMemo } from "react";
import type { ReactNode } from "react";
import type { SessionType } from "../api";
import { getSessionIcon } from "../api";
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
        inputRef={mobileInput.enabled ? mobileInput.inputRef : undefined}
        onInputCompositionStart={mobileInput.onCompositionStart}
        onInputCompositionEnd={mobileInput.onCompositionEnd}
        onInputInput={mobileInput.onInput}
        onInputKeyDown={mobileInput.onKeyDown}
      />
    </div>
  );
}
