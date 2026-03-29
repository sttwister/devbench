import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import * as db from "./db.ts";
import * as terminal from "./terminal.ts";
import * as autoRename from "./auto-rename.ts";
import * as mrLinks from "./mr-links.ts";
import * as agentStatus from "./agent-status.ts";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3001");
const DIST_DIR = path.join(__dirname, "..", "client", "dist");
const IS_PROD = process.env.NODE_ENV === "production";

// ── Startup: detect orphaned sessions (tmux died while devbench was down) ──
// Instead of archiving these, keep them visible so users can recover context
// (names, MR links, etc.) after a crash / power failure.
const orphanedSessionIds = new Set<number>();
{
  const sessions = db.getAllSessions();
  for (const s of sessions) {
    if (!terminal.tmuxSessionExists(s.tmux_name)) {
      console.log(`[startup] Session ${s.id} (${s.tmux_name}) has no tmux — keeping as orphaned`);
      orphanedSessionIds.add(s.id);
    }
  }
}


// ── Start MR link monitoring for existing sessions ─────────────────
{
  const liveSessions = db.getAllSessions();
  for (const s of liveSessions) {
    mrLinks.startMonitoring(s.id, s.tmux_name, s.mr_urls, (id, urls) => {
      db.updateSessionMrUrls(id, urls);
      terminal.broadcastControl(s.tmux_name, { type: "mr-links-changed", urls });
    });
  }
}

// ── Start agent-status monitoring for existing agent sessions ────────
{
  const liveSessions = db.getAllSessions();
  for (const s of liveSessions) {
    agentStatus.startMonitoring(s.id, s.tmux_name, s.type);
  }
}

// ── Restart auto-rename for sessions that still have default names ──
{
  const DEFAULT_NAME_RE = /^(Terminal|Claude Code|Pi|Codex) \d+$/;
  const liveSessions = db.getAllSessions();
  for (const s of liveSessions) {
    if (DEFAULT_NAME_RE.test(s.name)) {
      console.log(`[auto-rename] Restarting monitor for session ${s.id} ("${s.name}")`);
      autoRename.tryRenameNow(s.id, s.tmux_name, s.name, (_id, newName) => {
        terminal.broadcastControl(s.tmux_name, { type: "session-renamed", name: newName });
      });
    }
  }
}

// ── MIME types for static serving ───────────────────────────────────
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
  // strip query
  filePath = filePath.split("?")[0];
  let full = path.join(DIST_DIR, filePath);

  if (!fs.existsSync(full)) {
    // SPA fallback
    full = path.join(DIST_DIR, "index.html");
  }

  const ext = path.extname(full);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(full).pipe(res);
  return true;
}

// ── JSON helpers ────────────────────────────────────────────────────
function sendJson(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

// ── HTTP server ─────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const method = req.method!;
  const url = req.url!;

  // ── API routes ──────────────────────────────────────────────────
  if (url.startsWith("/api/")) {
    try {
      // GET /api/agent-statuses
      if (method === "GET" && url === "/api/agent-statuses") {
        return sendJson(res, agentStatus.getAllStatuses());
      }

      // GET /api/orphaned-sessions
      if (method === "GET" && url === "/api/orphaned-sessions") {
        return sendJson(res, Array.from(orphanedSessionIds));
      }

      // POST /api/sessions/:id/revive — works for both orphaned and archived sessions
      const sessRevive = url.match(/^\/api\/sessions\/(\d+)\/revive$/);
      if (method === "POST" && sessRevive) {
        const id = parseInt(sessRevive[1]);
        const session = db.getSession(id);
        if (!session) return sendJson(res, { error: "Session not found" }, 404);

        const isOrphaned = orphanedSessionIds.has(id);
        const isArchived = session.status === "archived";
        if (!isOrphaned && !isArchived) {
          return sendJson(res, { error: "Session is already active" }, 400);
        }

        const project = db.getProject(session.project_id);
        if (!project) return sendJson(res, { error: "Project not found" }, 404);

        const newTmuxName = `devbench_${session.project_id}_${Date.now()}`;
        try {
          const result = await terminal.reviveTmuxSession(
            newTmuxName,
            project.path,
            session.type,
            session.agent_session_id
          );

          // Update DB
          db.updateSessionTmuxName(id, newTmuxName);
          if (isArchived) db.unarchiveSession(id);
          if (result.agentSessionId && result.agentSessionId !== session.agent_session_id) {
            db.updateSessionAgentId(id, result.agentSessionId);
          }

          // Remove from orphaned set if applicable
          orphanedSessionIds.delete(id);

          // Start monitoring
          agentStatus.startMonitoring(id, newTmuxName, session.type);
          autoRename.startAutoRename(id, newTmuxName, session.name, (_id, newName) => {
            terminal.broadcastControl(newTmuxName, { type: "session-renamed", name: newName });
          });
          mrLinks.startMonitoring(id, newTmuxName, session.mr_urls, (sid, urls) => {
            db.updateSessionMrUrls(sid, urls);
            terminal.broadcastControl(newTmuxName, { type: "mr-links-changed", urls });
          });

          console.log(`[revive] Session ${id} revived with tmux ${newTmuxName}`);
          return sendJson(res, db.getSession(id));
        } catch (e: any) {
          return sendJson(res, { error: e.message }, 500);
        }
      }

      // GET /api/projects
      if (method === "GET" && url === "/api/projects") {
        const projects = db.getProjects().map((p) => ({
          ...p,
          sessions: db.getSessionsByProject(p.id),
        }));
        return sendJson(res, projects);
      }

      // GET /api/projects/:id/archived-sessions
      const archivedMatch = url.match(/^\/api\/projects\/(\d+)\/archived-sessions$/);
      if (method === "GET" && archivedMatch) {
        const projectId = parseInt(archivedMatch[1]);
        const project = db.getProject(projectId);
        if (!project) return sendJson(res, { error: "Project not found" }, 404);
        return sendJson(res, db.getArchivedSessionsByProject(projectId));
      }

      // POST /api/projects
      if (method === "POST" && url === "/api/projects") {
        const body = await readBody(req);
        if (!body.name || !body.path) return sendJson(res, { error: "name and path required" }, 400);
        if (!fs.existsSync(body.path)) return sendJson(res, { error: "Path does not exist" }, 400);
        try {
          return sendJson(res, db.addProject(body.name, body.path, body.browser_url, body.default_view_mode), 201);
        } catch (e: any) {
          if (e.message?.includes("UNIQUE"))
            return sendJson(res, { error: "Project path already exists" }, 409);
          throw e;
        }
      }

      // PATCH /api/projects/:id
      const projPatch = url.match(/^\/api\/projects\/(\d+)$/);
      if (method === "PATCH" && projPatch) {
        const id = parseInt(projPatch[1]);
        const project = db.getProject(id);
        if (!project) return sendJson(res, { error: "Project not found" }, 404);
        const body = await readBody(req);

        // Full update (name + path + browser_url)
        if ("name" in body && "path" in body) {
          if (!body.name || !body.path)
            return sendJson(res, { error: "name and path required" }, 400);
          if (!fs.existsSync(body.path))
            return sendJson(res, { error: "Path does not exist" }, 400);
          try {
            db.updateProject(id, body.name, body.path, body.browser_url ?? null, body.default_view_mode);
          } catch (e: any) {
            if (e.message?.includes("UNIQUE"))
              return sendJson(res, { error: "Project path already exists" }, 409);
            throw e;
          }
        } else if ("browser_url" in body) {
          db.updateProjectBrowserUrl(id, body.browser_url || null);
        }

        return sendJson(res, db.getProject(id));
      }

      // DELETE /api/projects/:id
      const projDel = url.match(/^\/api\/projects\/(\d+)$/);
      if (method === "DELETE" && projDel) {
        const id = parseInt(projDel[1]);
        for (const s of db.getSessionsByProject(id)) {
          orphanedSessionIds.delete(s.id);
          agentStatus.stopMonitoring(s.id);
          terminal.destroyTmuxSession(s.tmux_name);
        }
        db.removeProject(id);
        return sendJson(res, { ok: true });
      }

      // POST /api/projects/:id/sessions
      const sessCreate = url.match(/^\/api\/projects\/(\d+)\/sessions$/);
      if (method === "POST" && sessCreate) {
        const projectId = parseInt(sessCreate[1]);
        const project = db.getProject(projectId);
        if (!project) return sendJson(res, { error: "Project not found" }, 404);

        const body = await readBody(req);
        if (!body.name || !["terminal", "claude", "pi", "codex"].includes(body.type))
          return sendJson(res, { error: "name and type (terminal|claude|pi|codex) required" }, 400);

        const tmuxName = `devbench_${projectId}_${Date.now()}`;
        try {
          const result = await terminal.createTmuxSession(
            tmuxName, project.path, body.type
          );
          const session = db.addSession(projectId, body.name, body.type, tmuxName);
          if (result.agentSessionId) {
            db.updateSessionAgentId(session.id, result.agentSessionId);
          }
          agentStatus.startMonitoring(session.id, tmuxName, body.type);
          autoRename.startAutoRename(session.id, tmuxName, session.name, (_id, newName) => {
            terminal.broadcastControl(tmuxName, { type: "session-renamed", name: newName });
          });
          mrLinks.startMonitoring(session.id, tmuxName, [], (id, urls) => {
            db.updateSessionMrUrls(id, urls);
            terminal.broadcastControl(tmuxName, { type: "mr-links-changed", urls });
          });
          return sendJson(res, db.getSession(session.id), 201);
        } catch (e: any) {
          return sendJson(res, { error: e.message }, 500);
        }
      }

      // PATCH /api/sessions/:id
      const sessPatch = url.match(/^\/api\/sessions\/(\d+)$/);
      if (method === "PATCH" && sessPatch) {
        const id = parseInt(sessPatch[1]);
        const session = db.getSession(id);
        if (!session) return sendJson(res, { error: "Session not found" }, 404);
        const body = await readBody(req);
        if ("name" in body) {
          if (!body.name || typeof body.name !== "string")
            return sendJson(res, { error: "name is required" }, 400);
          db.renameSession(id, body.name.trim());
        }
        if ("browser_open" in body || "view_mode" in body) {
          const browserOpen = "browser_open" in body ? !!body.browser_open : session.browser_open;
          const viewMode = "view_mode" in body ? (body.view_mode ?? null) : session.view_mode;
          db.updateSessionBrowserState(id, browserOpen, viewMode);
        }
        return sendJson(res, db.getSession(id));
      }

      // DELETE /api/sessions/:id  (?permanent=1 to hard-delete, otherwise archive)
      const sessDel = url.match(/^\/api\/sessions\/(\d+)(\?.*)?$/);
      if (method === "DELETE" && sessDel) {
        const id = parseInt(sessDel[1]);
        const permanent = url.includes("permanent=1");
        orphanedSessionIds.delete(id);
        agentStatus.stopMonitoring(id);
        autoRename.stopAutoRename(id);
        mrLinks.stopMonitoring(id);
        const session = db.getSession(id);
        if (session) {
          terminal.destroyTmuxSession(session.tmux_name);
          if (permanent || session.status === "archived") {
            db.removeSession(id);
          } else {
            db.archiveSession(id);
          }
        }
        return sendJson(res, { ok: true });
      }

      return sendJson(res, { error: "Not found" }, 404);
    } catch (e: any) {
      console.error("[api]", e);
      return sendJson(res, { error: e.message }, 500);
    }
  }

  // ── Static files (production) ────────────────────────────────────
  if (serveStatic(req, res)) return;

  res.writeHead(404);
  res.end("Not found");
});

// ── WebSocket server ────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = req.url || "";

  const match = url.match(/^\/ws\/terminal\/(\d+)$/);
  if (!match) {
    socket.destroy();
    return;
  }

  const sessionId = parseInt(match[1]);
  const session = db.getSession(sessionId);
  if (!session) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, session);
  });
});

wss.on("connection", (ws: WebSocket, session: db.Session) => {
  console.log(`[ws] Attach session ${session.id} (${session.tmux_name})`);
  terminal.attachToSession(ws, session.tmux_name, 80, 24, () => {
    if (orphanedSessionIds.has(session.id)) return;
    console.log(`[ws] Session ended from inside: ${session.id} (${session.tmux_name})`);
    autoRename.stopAutoRename(session.id);
    db.archiveSession(session.id);
  });

  ws.on("message", (raw: Buffer | string) => {
    const data = typeof raw === "string" ? raw : raw.toString();

    // Control message (resize)
    if (data.charCodeAt(0) === 1) {
      try {
        const msg = JSON.parse(data.slice(1));
        if (msg.type === "resize") terminal.handleResize(ws, msg.cols, msg.rows);
      } catch {}
      return;
    }

    terminal.handleInput(ws, data);
  });

  ws.on("close", () => {
    console.log(`[ws] Detach session ${session.id}`);
    terminal.detach(ws);
  });
});

// ── Periodic health check: archive sessions whose tmux died ─────────
// Skip orphaned sessions (those found dead at startup) — they're kept
// visible intentionally so the user can recover context after a crash.
setInterval(() => {
  const sessions = db.getAllSessions();
  for (const s of sessions) {
    if (orphanedSessionIds.has(s.id)) continue;
    if (!terminal.tmuxSessionExists(s.tmux_name)) {
      console.log(`[health] Archiving dead session ${s.id} (${s.tmux_name})`);
      agentStatus.stopMonitoring(s.id);
      autoRename.stopAutoRename(s.id);
      mrLinks.stopMonitoring(s.id);
      db.archiveSession(s.id);
    }
  }
}, 10_000);

// ── Start ───────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Devbench server on http://0.0.0.0:${PORT}`);
});
