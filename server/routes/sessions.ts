import { SESSION_TYPE_CONFIGS, detectSourceType, getSourceLabel } from "@devbench/shared";
import { Router } from "../router.ts";
import * as db from "../db.ts";
import * as terminal from "../terminal.ts";
import * as monitors from "../monitor-manager.ts";
import { sendJson, readBody } from "../http-utils.ts";
import { extractMrUrls } from "../mr-links.ts";

export function registerSessionRoutes(api: Router): void {
  api.post("/api/projects/:id/sessions", async (req, res, { id: idStr }) => {
    const projectId = parseInt(idStr);
    const project = db.getProject(projectId);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    const body = await readBody(req);
    const validTypes = Object.keys(SESSION_TYPE_CONFIGS);
    if (!body.name || !validTypes.includes(body.type))
      return sendJson(res, { error: `name and type (${validTypes.join("|")}) required` }, 400);

    // Source URL handling
    const sourceUrl: string | null = body.source_url?.trim() || null;
    const sourceType = sourceUrl ? detectSourceType(sourceUrl) : null;

    // Generate initial prompt from source URL (for agent sessions)
    let initialPrompt: string | null = null;
    if (sourceUrl && body.type !== "terminal") {
      initialPrompt = `Implement this: ${sourceUrl}`;
    }

    // Use source label as name prefix if available and name is a default pattern
    const defaultNameRe = /^(Terminal|Claude Code|Pi|Codex) \d+$/;
    let sessionName = body.name;
    if (sourceUrl && defaultNameRe.test(body.name)) {
      const label = getSourceLabel(sourceUrl);
      if (label) sessionName = label;
    }

    const tmuxName = `devbench_${projectId}_${Date.now()}`;
    try {
      const result = await terminal.createTmuxSession(tmuxName, project.path, body.type, initialPrompt);
      const session = db.addSession(projectId, sessionName, body.type, tmuxName, sourceUrl, sourceType);
      if (result.agentSessionId) {
        db.updateSessionAgentId(session.id, result.agentSessionId);
      }
      monitors.startSessionMonitors(session.id, tmuxName, session.name, body.type, []);
      sendJson(res, db.getSession(session.id), 201);
    } catch (e: any) {
      sendJson(res, { error: e.message }, 500);
    }
  });

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

    if ("git_branch" in body) {
      const gitBranch: string | null = body.git_branch?.trim() || null;
      db.updateSessionGitBranch(id, gitBranch);
    }

    if ("source_url" in body) {
      const sourceUrl: string | null = body.source_url?.trim() || null;
      const sourceType = sourceUrl ? detectSourceType(sourceUrl) : null;
      db.updateSessionSource(id, sourceUrl, sourceType);
    }

    if ("remove_mr_url" in body && typeof body.remove_mr_url === "string") {
      monitors.dismissMrUrl(id, body.remove_mr_url);
    }

    if ("add_mr_url" in body && typeof body.add_mr_url === "string") {
      const url = body.add_mr_url.trim();
      if (url && extractMrUrls(url).length > 0) {
        monitors.addMrUrl(id, url);
      } else if (url) {
        // Accept any URL even if it doesn't match known MR patterns
        monitors.addMrUrl(id, url);
      }
    }

    sendJson(res, db.getSession(id));
  });

  api.delete("/api/sessions/:id", (req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const permanent = (req.url ?? "").includes("permanent=1");
    monitors.stopSessionMonitors(id);
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

    const isOrphaned = monitors.isOrphaned(id);
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
      monitors.clearOrphaned(id);
      monitors.startSessionMonitors(id, newTmuxName, session.name, session.type, session.mr_urls);

      console.log(`[revive] Session ${id} revived with tmux ${newTmuxName}`);
      sendJson(res, db.getSession(id));
    } catch (e: any) {
      sendJson(res, { error: e.message }, 500);
    }
  });
}
