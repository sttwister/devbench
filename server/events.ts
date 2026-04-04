// @lat: [[architecture#Server Architecture#Events WebSocket]]
/**
 * Global events WebSocket — pushes real-time events to all connected clients.
 *
 * Unlike the terminal WebSocket (per-session, carries terminal I/O), this is
 * a lightweight app-wide channel for notifications, status changes, and other
 * events that all clients need to hear about immediately.
 *
 * Designed to be extensible: as more poll data migrates to push, new event
 * types can be added here without changing the transport layer.
 */

import { WebSocketServer, WebSocket } from "ws";
import type http from "http";
import type net from "net";

const clients = new Set<WebSocket>();

/** Broadcast a JSON event to all connected event-socket clients. */
export function broadcast(event: object): void {
  const msg = JSON.stringify(event);
  for (const ws of clients) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    } catch { /* ignore send errors */ }
  }
}

// ── WebSocket server singleton ──────────────────────────────────────

let wss: WebSocketServer | null = null;

/** Create the events WebSocketServer (called once at startup). */
export function createEventsWss(): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });
  return wss;
}

/** Handle an HTTP upgrade for the events WebSocket. */
export function handleUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
  if (!wss) return;
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss!.emit("connection", ws, req);
  });
}

/** Number of connected clients (for diagnostics). */
export function clientCount(): number {
  return clients.size;
}
