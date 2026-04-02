/**
 * API routes for merge request entities.
 */

import { Router } from "../router.ts";
import * as db from "../db.ts";
import * as mrStatus from "../mr-status.ts";
import { sendJson } from "../http-utils.ts";
import type { MergeRequest } from "@devbench/shared";

export function registerMergeRequestRoutes(api: Router): void {
  /** Get all merge requests. */
  api.get("/api/merge-requests", (_req, res) => {
    sendJson(res, db.getAllMergeRequests());
  });

  /** Get merge requests for a session. */
  api.get("/api/sessions/:id/merge-requests", (_req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const session = db.getSession(id);
    if (!session) return sendJson(res, { error: "Session not found" }, 404);
    sendJson(res, db.getMergeRequestsBySession(id));
  });

  /**
   * Refresh statuses for a list of MR URLs (on-demand).
   * Used by the archived sessions popup to get fresh statuses.
   */
  api.post("/api/merge-requests/refresh", async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString());

    const urls = body.urls as string[] | undefined;
    if (!urls || !Array.isArray(urls)) {
      return sendJson(res, { error: "Missing 'urls' array" }, 400);
    }

    const updated = await mrStatus.fetchAndUpdateStatuses(urls);

    // Convert to a map for easy client consumption
    const statusMap: Record<string, import("@devbench/shared").MrStatus> = {};
    for (const mr of updated) {
      statusMap[mr.url] = {
        state: mr.state,
        draft: mr.draft,
        approved: mr.approved,
        changes_requested: mr.changes_requested,
        pipeline_status: mr.pipeline_status,
        auto_merge: mr.auto_merge,
        last_checked: mr.last_checked ?? new Date().toISOString(),
      };
    }

    sendJson(res, { statuses: statusMap, mergeRequests: updated });
  });
}
