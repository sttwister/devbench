import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getSessionLabel } from "@devbench/shared";
import { Router } from "./router.ts";
import * as db from "./db.ts";
import * as terminal from "./terminal.ts";
import * as autoRename from "./auto-rename.ts";
import * as mrLinks from "./mr-links.ts";
import * as agentStatus from "./agent-status.ts";
import * as monitors from "./monitor-manager.ts";
import { sendJson } from "./http-utils.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerSessionRoutes } from "./routes/sessions.ts";
import { registerStatusRoutes } from "./routes/status.ts";
import { attachWebSocketServer } from "./websocket.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3001");
const DIST_DIR = path.join(__dirname, "..", "client", "dist");
const IS_PROD = process.env.NODE_ENV === "production";

// ── Startup: initialize monitoring for all active sessions ─────────
const DEFAULT_NAME_RE = /^(Terminal|Claude Code|Pi|Codex) \d+$/;

{
  const sessions = db.getAllSessions();
  for (const s of sessions) {
    if (!terminal.tmuxSessionExists(s.tmux_name)) {
      console.log(`[startup] Session ${s.id} (${s.tmux_name}) has no tmux — keeping as orphaned`);
      monitors.markOrphaned(s.id);
      continue;
    }

    mrLinks.startMonitoring(s.id, s.tmux_name, s.mr_urls, (id, urls) => {
      db.updateSessionMrUrls(id, urls);
      terminal.broadcastControl(s.tmux_name, { type: "mr-links-changed", urls });
    });

    agentStatus.startMonitoring(s.id, s.tmux_name, s.type);

    if (DEFAULT_NAME_RE.test(s.name)) {
      console.log(`[auto-rename] Restarting monitor for session ${s.id} ("${s.name}")`);
      autoRename.tryRenameNow(s.id, s.tmux_name, s.name, (_id, newName) => {
        terminal.broadcastControl(s.tmux_name, { type: "session-renamed", name: newName });
      });
    }
  }
}

// ── Static file serving ─────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!IS_PROD) return false;
  let filePath = req.url === "/" ? "/index.html" : req.url!;
  filePath = filePath.split("?")[0];
  let full = path.join(DIST_DIR, filePath);
  if (!fs.existsSync(full)) full = path.join(DIST_DIR, "index.html");
  const ext = path.extname(full);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(full).pipe(res);
  return true;
}

// ── API routes ──────────────────────────────────────────────────────

const api = new Router();
registerStatusRoutes(api);
registerProjectRoutes(api);
registerSessionRoutes(api);

// ── HTTP server ─────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith("/api/")) {
    try {
      if (!api.handle(req, res)) {
        sendJson(res, { error: "Not found" }, 404);
      }
    } catch (e: any) {
      console.error("[api]", e);
      sendJson(res, { error: e.message }, 500);
    }
    return;
  }

  if (serveStatic(req, res)) return;

  res.writeHead(404);
  res.end("Not found");
});

// ── WebSocket server ────────────────────────────────────────────────
attachWebSocketServer(server);

// ── Health check: archive sessions whose tmux died ──────────────────
setInterval(() => {
  for (const s of db.getAllSessions()) {
    if (monitors.isOrphaned(s.id)) continue;
    if (!terminal.tmuxSessionExists(s.tmux_name)) {
      console.log(`[health] Archiving dead session ${s.id} (${s.tmux_name})`);
      monitors.stopSessionMonitors(s.id);
      db.archiveSession(s.id);
    }
  }
}, 10_000);

// ── Start ───────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Devbench server on http://0.0.0.0:${PORT}`);
});
