// @lat: [[client#Events WebSocket]]
/**
 * Global events WebSocket hook — receives real-time push events from the server.
 *
 * Currently used for notifications and agent status pushes. Designed to be
 * extended as more poll data migrates to WebSocket push.
 *
 * Returns a stable event emitter: callers register handlers for specific
 * event types that fire synchronously when a message arrives.
 */

import { useEffect, useRef, useCallback, useMemo } from "react";

/** An event from the server events WebSocket. */
export interface ServerEvent {
  type: string;
  [key: string]: unknown;
}

export type EventHandler = (event: ServerEvent) => void;

export interface EventSocket {
  /** Subscribe to a specific event type. Returns unsubscribe function. */
  on(type: string, handler: EventHandler): () => void;
}

/** Reconnect timing */
const RECONNECT_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;
const RECONNECT_BACKOFF = 1.5;

export function useEventSocket(): EventSocket {
  const listenersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);

  // Stable `on` function — survives re-renders
  const on = useCallback((type: string, handler: EventHandler): (() => void) => {
    let set = listenersRef.current.get(type);
    if (!set) {
      set = new Set();
      listenersRef.current.set(type, set);
    }
    set.add(handler);
    return () => { set!.delete(handler); };
  }, []);

  // Connect and reconnect
  useEffect(() => {
    let disposed = false;
    let reconnectDelay = RECONNECT_DELAY_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (disposed) return;

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${location.host}/ws/events`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelay = RECONNECT_DELAY_MS;
      };

      ws.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data as string) as ServerEvent;
          const handlers = listenersRef.current.get(event.type);
          if (handlers) {
            for (const h of handlers) {
              try { h(event); } catch (e) { console.error("[events]", e); }
            }
          }
        } catch { /* ignore malformed messages */ }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (disposed) return;
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * RECONNECT_BACKOFF, RECONNECT_MAX_DELAY_MS);
      };

      ws.onerror = () => {
        // onclose fires after onerror and handles reconnection
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  return useMemo(() => ({ on }), [on]);
}
