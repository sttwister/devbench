// @lat: [[hooks#Extension Routes]]
/**
 * Extension management API routes — install, uninstall, and check
 * status of devbench agent extensions (Claude Code hooks, Pi extensions).
 */

import { Router } from "../router.ts";
import * as extManager from "../extension-manager.ts";
import { sendJson, readBody } from "../http-utils.ts";

export function registerExtensionRoutes(api: Router): void {
  /** GET /api/extensions/status — returns install status for each agent. */
  api.get("/api/extensions/status", (_req, res) => {
    sendJson(res, extManager.getAllStatuses());
  });

  /** POST /api/extensions/install — install/update extensions. Body: { agents: string[] } */
  api.post("/api/extensions/install", async (req, res) => {
    try {
      const body = await readBody(req);
      const agents = body.agents;

      if (!Array.isArray(agents) || agents.length === 0) {
        return sendJson(res, { error: "agents (array of strings) required" }, 400);
      }

      const results = extManager.install(agents as string[]);
      sendJson(res, results);
    } catch (e: any) {
      sendJson(res, { error: e.message }, 500);
    }
  });

  /** POST /api/extensions/uninstall — remove extensions. Body: { agents: string[] } */
  api.post("/api/extensions/uninstall", async (req, res) => {
    try {
      const body = await readBody(req);
      const agents = body.agents;

      if (!Array.isArray(agents) || agents.length === 0) {
        return sendJson(res, { error: "agents (array of strings) required" }, 400);
      }

      const results = extManager.uninstall(agents as string[]);
      sendJson(res, results);
    } catch (e: any) {
      sendJson(res, { error: e.message }, 500);
    }
  });
}
