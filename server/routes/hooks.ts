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
   * Body: { sessionId: number }
   */
  api.post("/api/hooks/changes", async (req, res) => {
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

      console.log(`[hooks] changes session=${sessionId}`);
      monitors.handleHookChanges(sessionId);
      sendJson(res, { ok: true });
    } catch (e: any) {
      console.error(`[hooks] changes error:`, e.message);
      sendJson(res, { error: e.message }, 500);
    }
  });
}
