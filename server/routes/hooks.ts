// @lat: [[hooks#Hook API]]
/**
 * Hook API routes — called by agent hooks/extensions to push events
 * back to devbench without terminal scraping.
 */

import { Router } from "../router.ts";
import * as monitors from "../monitor-manager.ts";
import * as db from "../db.ts";
import { sendJson, readBody } from "../http-utils.ts";

export function registerHookRoutes(api: Router): void {
  /**
   * POST /api/hooks/session-start — agent session/thread started or resumed.
   * Body: { sessionId: number, agentSessionId: string }
   */
  api.post("/api/hooks/session-start", async (req, res) => {
    try {
      const body = await readBody(req);
      const sessionId = body.sessionId as number;
      const agentSessionId = body.agentSessionId as string;

      if (!sessionId || typeof sessionId !== "number") {
        return sendJson(res, { error: "sessionId (number) required" }, 400);
      }
      if (!agentSessionId || typeof agentSessionId !== "string") {
        return sendJson(res, { error: "agentSessionId (string) required" }, 400);
      }

      const session = db.getSession(sessionId);
      if (!session || session.status !== "active") {
        return sendJson(res, { error: "Session not found or inactive" }, 404);
      }

      console.log(`[hooks] session-start session=${sessionId} agent=${agentSessionId}`);
      monitors.handleHookSessionStart(sessionId, agentSessionId);
      sendJson(res, { ok: true });
    } catch (e: any) {
      console.error(`[hooks] session-start error:`, e.message);
      sendJson(res, { error: e.message }, 500);
    }
  });

  /**
   * POST /api/hooks/prompt — agent received a user prompt.
   * Body: { sessionId: number, prompt: string }
   */
  api.post("/api/hooks/prompt", async (req, res) => {
    try {
      const body = await readBody(req);
      const sessionId = body.sessionId as number;
      const prompt = body.prompt as string;

      if (!sessionId || typeof sessionId !== "number") {
        return sendJson(res, { error: "sessionId (number) required" }, 400);
      }
      if (!prompt || typeof prompt !== "string") {
        return sendJson(res, { error: "prompt (string) required" }, 400);
      }

      const session = db.getSession(sessionId);
      if (!session || session.status !== "active") {
        return sendJson(res, { error: "Session not found or inactive" }, 404);
      }

      console.log(`[hooks] prompt session=${sessionId} prompt=${prompt.slice(0, 80)}`);
      monitors.handleHookPrompt(sessionId, prompt);
      sendJson(res, { ok: true });
    } catch (e: any) {
      console.error(`[hooks] prompt error:`, e.message);
      sendJson(res, { error: e.message }, 500);
    }
  });

  /**
   * POST /api/hooks/working — agent is actively working (e.g. about to
   * invoke a tool). Sets status to "working" without triggering rename or
   * other side effects. Used as a recovery signal after a prior `waiting`
   * state when no `UserPromptSubmit` fires — notably plan-mode refinement
   * where the user's response is routed to the ExitPlanMode tool rather
   * than submitted as a fresh prompt.
   * Body: { sessionId: number }
   */
  api.post("/api/hooks/working", async (req, res) => {
    try {
      const body = await readBody(req);
      const sessionId = body.sessionId as number;

      if (!sessionId || typeof sessionId !== "number") {
        return sendJson(res, { error: "sessionId (number) required" }, 400);
      }

      const session = db.getSession(sessionId);
      if (!session || session.status !== "active") {
        return sendJson(res, { error: "Session not found or inactive" }, 404);
      }

      monitors.handleHookWorking(sessionId);
      sendJson(res, { ok: true });
    } catch (e: any) {
      console.error(`[hooks] working error:`, e.message);
      sendJson(res, { error: e.message }, 500);
    }
  });

  /**
   * POST /api/hooks/idle — agent finished working, waiting for input.
   * Body: { sessionId: number }
   */
  api.post("/api/hooks/idle", async (req, res) => {
    try {
      const body = await readBody(req);
      const sessionId = body.sessionId as number;

      if (!sessionId || typeof sessionId !== "number") {
        return sendJson(res, { error: "sessionId (number) required" }, 400);
      }

      const session = db.getSession(sessionId);
      if (!session || session.status !== "active") {
        return sendJson(res, { error: "Session not found or inactive" }, 404);
      }

      console.log(`[hooks] idle session=${sessionId}`);
      monitors.handleHookIdle(sessionId);
      sendJson(res, { ok: true });
    } catch (e: any) {
      console.error(`[hooks] idle error:`, e.message);
      sendJson(res, { error: e.message }, 500);
    }
  });

  /**
   * POST /api/hooks/mr — MR/PR URL detected by agent.
   * Body: { sessionId: number, url: string }
   */
  api.post("/api/hooks/mr", async (req, res) => {
    try {
      const body = await readBody(req);
      const sessionId = body.sessionId as number;
      const url = body.url as string;

      if (!sessionId || typeof sessionId !== "number") {
        return sendJson(res, { error: "sessionId (number) required" }, 400);
      }
      if (!url || typeof url !== "string") {
        return sendJson(res, { error: "url (string) required" }, 400);
      }

      const session = db.getSession(sessionId);
      if (!session || session.status !== "active") {
        return sendJson(res, { error: "Session not found or inactive" }, 404);
      }

      console.log(`[hooks] mr session=${sessionId} url=${url}`);
      monitors.handleHookMrUrl(sessionId, url);
      sendJson(res, { ok: true });
    } catch (e: any) {
      console.error(`[hooks] mr error:`, e.message);
      sendJson(res, { error: e.message }, 500);
    }
  });

  /**
   * POST /api/hooks/changes — agent wrote/edited a file.
   * Body: { sessionId: number, filePath?: string, cwd?: string }
   *
   * `filePath` and `cwd` are optional but recommended: when both are present
   * the server scopes the `has_changes` flag to files inside the session's
   * working directory, ignoring out-of-project writes like the plan-mode
   * plan file in `~/.claude/plans/`.
   */
  api.post("/api/hooks/changes", async (req, res) => {
    try {
      const body = await readBody(req);
      const sessionId = body.sessionId as number;
      const filePath = typeof body.filePath === "string" ? body.filePath : undefined;
      const cwd = typeof body.cwd === "string" ? body.cwd : undefined;

      if (!sessionId || typeof sessionId !== "number") {
        return sendJson(res, { error: "sessionId (number) required" }, 400);
      }

      const session = db.getSession(sessionId);
      if (!session || session.status !== "active") {
        return sendJson(res, { error: "Session not found or inactive" }, 404);
      }

      console.log(`[hooks] changes session=${sessionId} file=${filePath ?? "?"}`);
      monitors.handleHookChanges(sessionId, filePath, cwd);
      sendJson(res, { ok: true });
    } catch (e: any) {
      console.error(`[hooks] changes error:`, e.message);
      sendJson(res, { error: e.message }, 500);
    }
  });

  /**
   * POST /api/hooks/committed — agent committed/pushed via git.
   * Clears the has_changes flag since changes are no longer uncommitted.
   * Body: { sessionId: number }
   */
  api.post("/api/hooks/committed", async (req, res) => {
    try {
      const body = await readBody(req);
      const sessionId = body.sessionId as number;

      if (!sessionId || typeof sessionId !== "number") {
        return sendJson(res, { error: "sessionId (number) required" }, 400);
      }

      const session = db.getSession(sessionId);
      if (!session || session.status !== "active") {
        return sendJson(res, { error: "Session not found or inactive" }, 404);
      }

      console.log(`[hooks] committed session=${sessionId}`);
      monitors.handleHookCommitted(sessionId);
      sendJson(res, { ok: true });
    } catch (e: any) {
      console.error(`[hooks] committed error:`, e.message);
      sendJson(res, { error: e.message }, 500);
    }
  });
}
