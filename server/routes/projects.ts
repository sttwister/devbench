import fs from "fs";
import { Router } from "../router.ts";
import * as db from "../db.ts";
import * as terminal from "../terminal.ts";
import * as monitors from "../monitor-manager.ts";
import { sendJson, readBody } from "../http-utils.ts";

export function registerProjectRoutes(api: Router): void {
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

    if ("active" in body) {
      db.setProjectActive(id, !!body.active);
    } else if ("name" in body && "path" in body) {
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
      monitors.stopSessionMonitors(s.id);
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
}
