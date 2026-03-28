import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import * as db from "./db.ts";
import * as terminal from "./terminal.ts";
import * as autoRename from "./auto-rename.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3001");
const DIST_DIR = path.join(__dirname, "..", "client", "dist");
const IS_PROD = process.env.NODE_ENV === "production";

// ── Startup cleanup ────────────────────────────────────────────────
{
  const sessions = db.getAllSessions();
  for (const s of sessions) {
    if (!terminal.tmuxSessionExists(s.tmux_name)) {
      console.log(`[cleanup] Archiving stale session ${s.id} (${s.tmux_name})`);
      db.archiveSession(s.id);
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
      // GET /api/projects
      if (method === "GET" && url === "/api/projects") {
        const projects = db.getProjects().map((p) => ({
          ...p,
          sessions: db.getSessionsByProject(p.id),
        }));
        return sendJson(res, projects);
      }

      // POST /api/projects
      if (method === "POST" && url === "/api/projects") {
        const body = await readBody(req);
        if (!body.name || !body.path) return sendJson(res, { error: "name and path required" }, 400);
        if (!fs.existsSync(body.path)) return sendJson(res, { error: "Path does not exist" }, 400);
        try {
          return sendJson(res, db.addProject(body.name, body.path, body.browser_url), 201);
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
            db.updateProject(id, body.name, body.path, body.browser_url ?? null);
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
        for (const s of db.getSessionsByProject(id)) terminal.destroyTmuxSession(s.tmux_name);
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
          await terminal.createTmuxSession(tmuxName, project.path, body.type);
          const session = db.addSession(projectId, body.name, body.type, tmuxName);
          autoRename.startAutoRename(session.id, tmuxName, session.name, (_id, newName) => {
            terminal.broadcastControl(tmuxName, { type: "session-renamed", name: newName });
          });
          return sendJson(res, session, 201);
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
        return sendJson(res, db.getSession(id));
      }

      // DELETE /api/sessions/:id
      const sessDel = url.match(/^\/api\/sessions\/(\d+)$/);
      if (method === "DELETE" && sessDel) {
        const id = parseInt(sessDel[1]);
        autoRename.stopAutoRename(id);
        const session = db.getSession(id);
        if (session) {
          terminal.destroyTmuxSession(session.tmux_name);
          db.removeSession(id);
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
setInterval(() => {
  const sessions = db.getAllSessions();
  for (const s of sessions) {
    if (!terminal.tmuxSessionExists(s.tmux_name)) {
      console.log(`[health] Archiving dead session ${s.id} (${s.tmux_name})`);
      autoRename.stopAutoRename(s.id);
      db.archiveSession(s.id);
    }
  }
}, 10_000);

// ── Start ───────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Devbench server on http://0.0.0.0:${PORT}`);
});
