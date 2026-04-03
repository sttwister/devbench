import { Router } from "../router.ts";
import * as db from "../db.ts";
import { sendJson, readBody } from "../http-utils.ts";
import { restartMrStatusPollingForProvider } from "../monitor-manager.ts";
import * as linear from "../linear.ts";
import * as jira from "../jira.ts";

/** Known setting keys (whitelist to prevent storing arbitrary data). */
const ALLOWED_KEYS = new Set(["gitlab_token", "github_token", "linear_token", "jira_token", "jira_base_url"]);

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

    // When a token is saved, start MR status polling for sessions that have
    // matching MR URLs but weren't being polled (because the token didn't exist).
    const TOKEN_TO_PROVIDER: Record<string, "gitlab" | "github"> = {
      gitlab_token: "gitlab",
      github_token: "github",
    };
    const provider = TOKEN_TO_PROVIDER[key];
    if (provider && value) {
      restartMrStatusPollingForProvider(provider);
    }

    sendJson(res, { ok: true });
  });

  /** POST /api/settings/validate — test a token against its provider API. Body: { key } */
  api.post("/api/settings/validate", async (req, res) => {
    const body = await readBody(req);
    const { key } = body;

    if (!key || !ALLOWED_KEYS.has(key)) {
      return sendJson(res, { error: "Invalid key" }, 400);
    }

    const token = db.getSetting(key);
    if (!token) {
      return sendJson(res, { valid: false, error: "Token not set" });
    }

    try {
      if (key === "github_token") {
        const r = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
        });
        if (r.ok) {
          const data = await r.json() as any;
          return sendJson(res, { valid: true, user: data.login });
        }
        const err = await r.json().catch(() => ({})) as any;
        return sendJson(res, { valid: false, error: err.message || `HTTP ${r.status}` });
      }

      if (key === "gitlab_token") {
        const r = await fetch("https://gitlab.com/api/v4/user", {
          headers: { "PRIVATE-TOKEN": token },
        });
        if (r.ok) {
          const data = await r.json() as any;
          return sendJson(res, { valid: true, user: data.username });
        }
        const err = await r.json().catch(() => ({})) as any;
        return sendJson(res, { valid: false, error: err.message || err.error || `HTTP ${r.status}` });
      }

      if (key === "linear_token") {
        const result = await linear.validateToken(token);
        return sendJson(res, result);
      }

      if (key === "jira_token") {
        const baseUrl = db.getSetting("jira_base_url");
        if (!baseUrl) {
          return sendJson(res, { valid: false, error: "Set JIRA Base URL first" });
        }
        const result = await jira.validateToken(token, baseUrl);
        return sendJson(res, result);
      }

      sendJson(res, { valid: false, error: "Unknown provider" });
    } catch (e: any) {
      sendJson(res, { valid: false, error: e.message });
    }
  });
}
