import { Router } from "../router.ts";
import * as db from "../db.ts";
import { sendJson, readBody } from "../http-utils.ts";

/** Known setting keys (whitelist to prevent storing arbitrary data). */
const ALLOWED_KEYS = new Set(["gitlab_token", "github_token"]);

/** Mask a token for display: show first 4 and last 4 chars. */
function maskToken(value: string): string {
  if (value.length <= 10) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

export function registerSettingsRoutes(api: Router): void {
  /** GET /api/settings — returns all settings with tokens masked. */
  api.get("/api/settings", (_req, res) => {
    const raw = db.getAllSettings();
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      masked[key] = key.endsWith("_token") ? maskToken(value) : value;
    }
    sendJson(res, masked);
  });

  /** PUT /api/settings — upsert a single setting. Body: { key, value } */
  api.put("/api/settings", async (req, res) => {
    const body = await readBody(req);
    const { key, value } = body;

    if (!key || typeof key !== "string" || !ALLOWED_KEYS.has(key)) {
      return sendJson(res, { error: `Invalid setting key. Allowed: ${[...ALLOWED_KEYS].join(", ")}` }, 400);
    }

    if (value === null || value === undefined || value === "") {
      db.deleteSetting(key);
    } else {
      if (typeof value !== "string") {
        return sendJson(res, { error: "value must be a string" }, 400);
      }
      db.setSetting(key, value);
    }

    sendJson(res, { ok: true });
  });
}
