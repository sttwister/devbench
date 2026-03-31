import { useEffect, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { MrStatus } from "../api";

interface WebSocketCallbacks {
  onSessionEnded?: () => void;
  onSessionRenamed?: (newName: string) => void;
  onMrLinkFound?: () => void;
  onMrStatusChanged?: (statuses: Record<string, MrStatus>) => void;
}

/** Reconnect timing constants */
const RECONNECT_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 5000;
const RECONNECT_BACKOFF = 1.5;

/**
 * Connects a WebSocket to the terminal for a given session.
 * Handles data flow (terminal ↔ server), resize messages,
 * and server control messages (session-ended, session-renamed, mr-links-changed).
 *
 * Automatically reconnects with backoff when the connection drops
 * unexpectedly (e.g. server restart due to file watch). Reconnection
 * stops when the session ends normally or the effect is cleaned up.
 *
 * @param wsRef          Caller-owned ref that will hold the live WebSocket.
 * @param dataTransformRef  Optional transform applied to every outgoing
 *                          keystroke before it's sent to the server.  Used
 *                          by the mobile keyboard bar to inject Ctrl / Alt
 *                          modifiers into regular keyboard input.
 */
export function useTerminalWebSocket(
  sessionId: number,
  termRef: React.RefObject<Terminal | null>,
  fitRef: React.RefObject<FitAddon | null>,
  callbacks: WebSocketCallbacks,
  wsRef: React.MutableRefObject<WebSocket | null>,
  dataTransformRef?: React.RefObject<((data: string) => string) | null>
) {
  // Use refs for callbacks to avoid reconnecting on every callback change
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    const term = termRef.current;
    const fitAddon = fitRef.current;
    if (!term) return;
    // `term` is guaranteed non-null from here, but TS can't narrow inside
    // nested closures. Use a const alias that TS treats as `Terminal`.
    const t: Terminal = term;

    /** Set to true when the server tells us the session ended normally. */
    let sessionEnded = false;
    /** Set to true when the effect cleanup runs (unmount / sessionId change). */
    let disposed = false;
    /** Current reconnect delay (grows with backoff). */
    let reconnectDelay = RECONNECT_DELAY_MS;
    /** Pending reconnect timer so we can cancel it on cleanup. */
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    // Terminal → server and resize disposables for the *current* connection.
    // Replaced on each reconnect.
    let dataDisposable: { dispose(): void } | null = null;
    let resizeDisposable: { dispose(): void } | null = null;

    function connect() {
      if (disposed || sessionEnded) return;

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      // Send initial dimensions as query params so the server can spawn the
      // pty at the correct size, avoiding a visible double-resize.
      const dims = fitAddon?.proposeDimensions();
      const initCols = dims?.cols ?? 80;
      const initRows = dims?.rows ?? 24;
      const ws = new WebSocket(
        `${proto}//${location.host}/ws/terminal/${sessionId}?cols=${initCols}&rows=${initRows}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        // Reset backoff on successful connection
        reconnectDelay = RECONNECT_DELAY_MS;

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
              sessionEnded = true;
              t.write("\r\n\x1b[90m[session ended]\x1b[0m\r\n");
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
            if (msg.type === "mr-statuses-changed" && msg.statuses) {
              cbRef.current.onMrStatusChanged?.(msg.statuses);
              return;
            }
          } catch { /* control message parse failure — ignore */ }
        }
        t.write(data);
      };

      ws.onclose = () => {
        cleanup();
        if (sessionEnded || disposed) {
          t.write("\r\n\x1b[90m[session disconnected]\x1b[0m\r\n");
          return;
        }
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire right after onerror, which handles reconnect.
        // Only log if this is a terminal error (session still alive).
        if (sessionEnded || disposed) {
          t.write("\r\n\x1b[31m[connection error]\x1b[0m\r\n");
        }
      };

      // Terminal → server
      dataDisposable = t.onData((data) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const transform = dataTransformRef?.current;
        ws.send(transform ? transform(data) : data);
      });

      // Resize handling
      resizeDisposable = t.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("\x01" + JSON.stringify({ type: "resize", cols, rows }));
        }
      });
    }

    /** Dispose listeners for the current WebSocket connection. */
    function cleanup() {
      dataDisposable?.dispose();
      dataDisposable = null;
      resizeDisposable?.dispose();
      resizeDisposable = null;
    }

    function scheduleReconnect() {
      t.write(`\r\n\x1b[90m[disconnected — reconnecting…]\x1b[0m\r\n`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (disposed || sessionEnded) return;
        connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * RECONNECT_BACKOFF, RECONNECT_MAX_DELAY_MS);
    }

    // Start the initial connection
    connect();

    return () => {
      disposed = true;
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      cleanup();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [sessionId, termRef, fitRef]);
}
