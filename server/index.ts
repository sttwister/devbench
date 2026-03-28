import {
  getProjects,
  createProject,
  deleteProject,
  getSessionsByProject,
  createSession,
  deleteSession,
  getSession,
  getProjectById,
} from "./db";
import { spawnPty, getPty, killPty, attachClient, detachClient } from "./pty";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function notFound(): Response {
  return jsonResponse({ error: "Not found" }, 404);
}

const server = Bun.serve({
  port: 3000,
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // WebSocket upgrade
    if (path.startsWith("/ws/")) {
      const sessionId = parseInt(path.split("/ws/")[1]);
      if (isNaN(sessionId)) return notFound();

      const session = getSession(sessionId);
      if (!session) return jsonResponse({ error: "Session not found" }, 404);

      const upgraded = server.upgrade(req, {
        data: { sessionId },
      });
      if (upgraded) return undefined as any;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // REST API
    if (path === "/api/projects" && method === "GET") {
      return jsonResponse(getProjects());
    }

    if (path === "/api/projects" && method === "POST") {
      const body = (await req.json()) as { name: string; path: string };
      if (!body.name || !body.path) {
        return jsonResponse({ error: "name and path are required" }, 400);
      }
      const project = createProject(body.name, body.path);
      return jsonResponse(project, 201);
    }

    const projectMatch = path.match(/^\/api\/projects\/(\d+)$/);
    if (projectMatch) {
      const projectId = parseInt(projectMatch[1]);

      if (method === "DELETE") {
        const sessions = getSessionsByProject(projectId);
        for (const s of sessions) killPty(s.id);
        deleteProject(projectId);
        return jsonResponse({ ok: true });
      }
    }

    const projectSessionsMatch = path.match(/^\/api\/projects\/(\d+)\/sessions$/);
    if (projectSessionsMatch) {
      const projectId = parseInt(projectSessionsMatch[1]);

      if (method === "GET") {
        return jsonResponse(getSessionsByProject(projectId));
      }

      if (method === "POST") {
        const body = (await req.json()) as { name?: string; type: string };
        if (!body.type || !["terminal", "claude"].includes(body.type)) {
          return jsonResponse({ error: "type must be terminal or claude" }, 400);
        }
        const project = getProjectById(projectId);
        if (!project) return jsonResponse({ error: "Project not found" }, 404);
        const name = body.name || (body.type === "terminal" ? "Terminal" : "Claude Code");
        const session = createSession(projectId, name, body.type);
        return jsonResponse(session, 201);
      }
    }

    const sessionMatch = path.match(/^\/api\/sessions\/(\d+)$/);
    if (sessionMatch) {
      const sessionId = parseInt(sessionMatch[1]);

      if (method === "DELETE") {
        killPty(sessionId);
        deleteSession(sessionId);
        return jsonResponse({ ok: true });
      }
    }

    return notFound();
  },

  websocket: {
    open(ws) {
      const { sessionId } = ws.data as { sessionId: number };
      const session = getSession(sessionId);
      if (!session) {
        ws.close(1008, "Session not found");
        return;
      }

      const project = getProjectById(session.project_id);
      if (!project) {
        ws.close(1008, "Project not found");
        return;
      }

      const existing = getPty(sessionId);
      if (existing) {
        attachClient(sessionId, ws);
      } else {
        spawnPty(sessionId, session.type, project.path);
        attachClient(sessionId, ws);
      }
    },

    message(ws, data) {
      const { sessionId } = ws.data as { sessionId: number };
      const entry = getPty(sessionId);
      if (!entry) return;

      if (typeof data === "string") {
        // Try to parse resize message
        try {
          const msg = JSON.parse(data);
          if (msg.type === "resize" && msg.cols && msg.rows) {
            entry.pty.resize(msg.cols, msg.rows);
            return;
          }
        } catch (e) {}
        entry.pty.write(data);
      } else {
        // Binary data
        const text = Buffer.from(data as ArrayBuffer).toString("utf-8");
        entry.pty.write(text);
      }
    },

    close(ws) {
      const { sessionId } = ws.data as { sessionId: number };
      detachClient(sessionId, ws);
    },
  },
});

console.log(`devbench server running on http://localhost:${server.port}`);
