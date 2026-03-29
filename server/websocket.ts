import type http from "http";
import { WebSocketServer, WebSocket } from "ws";
import * as db from "./db.ts";
import * as terminal from "./terminal.ts";
import * as autoRename from "./auto-rename.ts";
import * as monitors from "./monitor-manager.ts";

/**
 * Attach the WebSocket server to an existing HTTP server.
 * Handles terminal session connections (ws/terminal/:id).
 */
export function attachWebSocketServer(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const match = (req.url || "").match(/^\/ws\/terminal\/(\d+)$/);
    if (!match) { socket.destroy(); return; }

    const session = db.getSession(parseInt(match[1]));
    if (!session) { socket.destroy(); return; }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, session));
  });

  wss.on("connection", (ws: WebSocket, session: db.Session) => {
    console.log(`[ws] Attach session ${session.id} (${session.tmux_name})`);
    terminal.attachToSession(ws, session.tmux_name, 80, 24, () => {
      if (monitors.isOrphaned(session.id)) return;
      console.log(`[ws] Session ended from inside: ${session.id} (${session.tmux_name})`);
      autoRename.stopAutoRename(session.id);
      db.archiveSession(session.id);
    });

    ws.on("message", (raw: Buffer | string) => {
      const data = typeof raw === "string" ? raw : raw.toString();
      if (data.charCodeAt(0) === 1) {
        try {
          const msg = JSON.parse(data.slice(1));
          if (msg.type === "resize") terminal.handleResize(ws, msg.cols, msg.rows);
        } catch { /* control message parse failure — ignore */ }
        return;
      }
      terminal.handleInput(ws, data);
    });

    ws.on("close", () => {
      console.log(`[ws] Detach session ${session.id}`);
      terminal.detach(ws);
    });
  });
}
