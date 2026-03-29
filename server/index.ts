import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { getSessionLabel, SESSION_TYPE_CONFIGS } from "@devbench/shared";
import { Router } from "./router.ts";
import * as db from "./db.ts";
import * as terminal from "./terminal.ts";
import * as autoRename from "./auto-rename.ts";
import * as mrLinks from "./mr-links.ts";
import * as agentStatus from "./agent-status.ts";


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3001");
const DIST_DIR = path.join(__dirname, "..", "client", "dist");
const IS_PROD = process.env.NODE_ENV === "production";

// ── Startup: initialize monitoring for all active sessions ─────────
const orphanedSessionIds = new Set<number>();
const DEFAULT_NAME_RE = /^(Terminal|Claude Code|Pi|Codex) \d+$/;

{
  const sessions = db.getAllSessions();
  for (const s of sessions) {
    if (!terminal.tmuxSessionExists(s.tmux_name)) {
      console.log(`[startup] Session ${s.id} (${s.tmux_name}) has no tmux — keeping as orphaned`);
      orphanedSessionIds.add(s.id);
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

// ── Helpers ──────────────────────────────────────────────────────────

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

function sendJson(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON")); }
    });
  });
}

/** Start all monitors for a newly created / revived session. */
function startSessionMonitors(
  sessionId: number,
  tmuxName: string,
  sessionName: string,
  type: db.SessionType,
  mrUrls: string[]
) {
  agentStatus.startMonitoring(sessionId, tmuxName, type);
  autoRename.startAutoRename(sessionId, tmuxName, sessionName, (_id, newName) => {
    terminal.broadcastControl(tmuxName, { type: "session-renamed", name: newName });
  });
  mrLinks.startMonitoring(sessionId, tmuxName, mrUrls, (id, urls) => {
    db.updateSessionMrUrls(id, urls);
    terminal.broadcastControl(tmuxName, { type: "mr-links-changed", urls });
  });
}

/** Stop all monitors and clean up a session. */
function stopSessionMonitors(sessionId: number) {
  agentStatus.stopMonitoring(sessionId);
  autoRename.stopAutoRename(sessionId);
  mrLinks.stopMonitoring(sessionId);
  orphanedSessionIds.delete(sessionId);
}

// ── API routes ──────────────────────────────────────────────────────

const api = new Router();

// ── Agent / orphan status ───────────────────────────────────────────

api.get("/api/agent-statuses", (_req, res) => {
  sendJson(res, agentStatus.getAllStatuses());
});

api.get("/api/orphaned-sessions", (_req, res) => {
  sendJson(res, Array.from(orphanedSessionIds));
});

// ── Projects ────────────────────────────────────────────────────────

api.get("/api/projects", (_req, res) => {
  const projects = db.getProjects().map((p) => ({
    ...p,
    sessions: db.getSessionsByProject(p.id),
  }));
  sendJson(res, projects);
});

api.post("/api/projects", async (req, res) => {
  const body = await readBody(req);
  if (!body.name || !body.path)
    return sendJson(res, { error: "name and path required" }, 400);
  if (!fs.existsSync(body.path))
    return sendJson(res, { error: "Path does not exist" }, 400);
  try {
    sendJson(res, db.addProject(body.name, body.path, body.browser_url, body.default_view_mode), 201);
  } catch (e: any) {
    if (e.message?.includes("UNIQUE"))
      return sendJson(res, { error: "Project path already exists" }, 409);
    throw e;
  }
});

api.patch("/api/projects/:id", async (req, res, { id: idStr }) => {
  const id = parseInt(idStr);
  const project = db.getProject(id);
  if (!project) return sendJson(res, { error: "Project not found" }, 404);
  const body = await readBody(req);

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

  sendJson(res, db.getProject(id));
});

api.delete("/api/projects/:id", (_req, res, { id: idStr }) => {
  const id = parseInt(idStr);
  for (const s of db.getSessionsByProject(id)) {
    stopSessionMonitors(s.id);
    terminal.destroyTmuxSession(s.tmux_name);
  }
  db.removeProject(id);
  sendJson(res, { ok: true });
});

api.put("/api/projects/reorder", async (req, res) => {
  const body = await readBody(req);
  if (!Array.isArray(body.order))
    return sendJson(res, { error: "order array required" }, 400);
  db.reorderProjects(body.order);
  sendJson(res, { ok: true });
});

// ── Project sub-resources ───────────────────────────────────────────

api.get("/api/projects/:id/archived-sessions", (_req, res, { id: idStr }) => {
  const projectId = parseInt(idStr);
  const project = db.getProject(projectId);
  if (!project) return sendJson(res, { error: "Project not found" }, 404);
  sendJson(res, db.getArchivedSessionsByProject(projectId));
});

api.put("/api/projects/:id/sessions/reorder", async (req, res, { id: idStr }) => {
  const projectId = parseInt(idStr);
  const body = await readBody(req);
  if (!Array.isArray(body.order))
    return sendJson(res, { error: "order array required" }, 400);
  db.reorderSessions(projectId, body.order);
  sendJson(res, { ok: true });
});

api.post("/api/projects/:id/sessions", async (req, res, { id: idStr }) => {
  const projectId = parseInt(idStr);
  const project = db.getProject(projectId);
  if (!project) return sendJson(res, { error: "Project not found" }, 404);

  const body = await readBody(req);
  const validTypes = Object.keys(SESSION_TYPE_CONFIGS);
  if (!body.name || !validTypes.includes(body.type))
    return sendJson(res, { error: `name and type (${validTypes.join("|")}) required` }, 400);

  const tmuxName = `devbench_${projectId}_${Date.now()}`;
  try {
    const result = await terminal.createTmuxSession(tmuxName, project.path, body.type);
    const session = db.addSession(projectId, body.name, body.type, tmuxName);
    if (result.agentSessionId) {
      db.updateSessionAgentId(session.id, result.agentSessionId);
    }
    startSessionMonitors(session.id, tmuxName, session.name, body.type, []);
    sendJson(res, db.getSession(session.id), 201);
  } catch (e: any) {
    sendJson(res, { error: e.message }, 500);
  }
});

// ── Sessions ────────────────────────────────────────────────────────

api.patch("/api/sessions/:id", async (req, res, { id: idStr }) => {
  const id = parseInt(idStr);
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

  sendJson(res, db.getSession(id));
});

api.delete("/api/sessions/:id", (req, res, { id: idStr }) => {
  const id = parseInt(idStr);
  const permanent = (req.url ?? "").includes("permanent=1");
  stopSessionMonitors(id);
  const session = db.getSession(id);
  if (session) {
    terminal.destroyTmuxSession(session.tmux_name);
    if (permanent || session.status === "archived") {
      db.removeSession(id);
    } else {
      db.archiveSession(id);
    }
  }
  sendJson(res, { ok: true });
});

api.post("/api/sessions/:id/revive", async (req, res, { id: idStr }) => {
  const id = parseInt(idStr);
  const session = db.getSession(id);
  if (!session) return sendJson(res, { error: "Session not found" }, 404);

  const isOrphaned = orphanedSessionIds.has(id);
  const isArchived = session.status === "archived";
  if (!isOrphaned && !isArchived)
    return sendJson(res, { error: "Session is already active" }, 400);

  const project = db.getProject(session.project_id);
  if (!project) return sendJson(res, { error: "Project not found" }, 404);

  const newTmuxName = `devbench_${session.project_id}_${Date.now()}`;
  try {
    const result = await terminal.reviveTmuxSession(
      newTmuxName, project.path, session.type, session.agent_session_id
    );

    db.updateSessionTmuxName(id, newTmuxName);
    if (isArchived) db.unarchiveSession(id);
    if (result.agentSessionId && result.agentSessionId !== session.agent_session_id) {
      db.updateSessionAgentId(id, result.agentSessionId);
    }
    orphanedSessionIds.delete(id);
    startSessionMonitors(id, newTmuxName, session.name, session.type, session.mr_urls);

    console.log(`[revive] Session ${id} revived with tmux ${newTmuxName}`);
    sendJson(res, db.getSession(id));
  } catch (e: any) {
    sendJson(res, { error: e.message }, 500);
  }
});

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
    if (orphanedSessionIds.has(session.id)) return;
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

// ── Health check: archive sessions whose tmux died ──────────────────
setInterval(() => {
  for (const s of db.getAllSessions()) {
    if (orphanedSessionIds.has(s.id)) continue;
    if (!terminal.tmuxSessionExists(s.tmux_name)) {
      console.log(`[health] Archiving dead session ${s.id} (${s.tmux_name})`);
      stopSessionMonitors(s.id);
      db.archiveSession(s.id);
    }
  }
}, 10_000);

// ── Start ───────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Devbench server on http://0.0.0.0:${PORT}`);
});
