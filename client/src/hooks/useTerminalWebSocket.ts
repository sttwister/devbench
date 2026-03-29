import { useEffect, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

interface WebSocketCallbacks {
  onSessionEnded?: () => void;
  onSessionRenamed?: (newName: string) => void;
  onMrLinkFound?: () => void;
}

/**
 * Connects a WebSocket to the terminal for a given session.
 * Handles data flow (terminal ↔ server), resize messages,
 * and server control messages (session-ended, session-renamed, mr-links-changed).
 */
export function useTerminalWebSocket(
  sessionId: number,
  termRef: React.RefObject<Terminal | null>,
  fitRef: React.RefObject<FitAddon | null>,
  callbacks: WebSocketCallbacks
) {
  // Use refs for callbacks to avoid reconnecting on every callback change
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitRef.current;
    if (!term) return;

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/terminal/${sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      const dims = fitAddon?.proposeDimensions();
      if (dims) {
        ws.send(
          "\x01" + JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows })
        );
      }
    };

    ws.onmessage = (ev) => {
      const data = ev.data as string;
      // Intercept server control messages (prefixed with \x01)
      if (typeof data === "string" && data.charCodeAt(0) === 1) {
        try {
          const msg = JSON.parse(data.slice(1));
          if (msg.type === "session-ended") {
            term.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
            cbRef.current.onSessionEnded?.();
            return;
          }
          if (msg.type === "session-renamed" && msg.name) {
            cbRef.current.onSessionRenamed?.(msg.name);
            return;
          }
          if (msg.type === "mr-links-changed") {
            cbRef.current.onMrLinkFound?.();
            return;
          }
        } catch { /* control message parse failure — ignore */ }
      }
      term.write(data);
    };

    ws.onclose = () =>
      term.write("\r\n\x1b[90m[session disconnected]\x1b[0m\r\n");

    ws.onerror = () =>
      term.write("\r\n\x1b[31m[connection error]\x1b[0m\r\n");

    // Terminal → server
    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    // Resize handling
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send("\x01" + JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    return () => {
      dataDisposable.dispose();
      resizeDisposable.dispose();
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId, termRef, fitRef]);

  return wsRef;
}
