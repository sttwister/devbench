import { Router } from "../router.ts";
import * as agentStatus from "../agent-status.ts";
import * as monitors from "../monitor-manager.ts";
import { getProcessingSourceSessionIds } from "./sessions.ts";
import { sendJson } from "../http-utils.ts";

export function registerStatusRoutes(api: Router): void {
  api.get("/api/agent-statuses", (_req, res) => {
    sendJson(res, agentStatus.getAllStatuses());
  });

  api.get("/api/orphaned-sessions", (_req, res) => {
    sendJson(res, monitors.getOrphanedIds());
  });

  /** Combined poll endpoint — returns agent statuses + orphaned IDs in one request. */
  api.get("/api/poll", (_req, res) => {
    sendJson(res, {
      agentStatuses: agentStatus.getAllStatuses(),
      orphanedSessionIds: monitors.getOrphanedIds(),
      processingSourceSessionIds: getProcessingSourceSessionIds(),
    });
  });
}
