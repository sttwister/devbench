/**
 * Server factory — creates and configures the HTTP + WebSocket server.
 *
 * Separated from index.ts so the server can be imported and tested
 * without triggering startup side effects (listening, monitoring).
 */

import http from "http";
import fs from "fs";
import path from "path";
import { Router } from "./router.ts";
import { sendJson } from "./http-utils.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import { registerSessionRoutes } from "./routes/sessions.ts";
import { registerStatusRoutes } from "./routes/status.ts";
import { attachWebSocketServer } from "./websocket.ts";

// ── MIME map for static file serving ────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

// ── Static file serving ─────────────────────────────────────────────

function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  distDir: string,
  isProd: boolean
): boolean {
  if (!isProd) return false;
  let filePath = req.url === "/" ? "/index.html" : req.url!;
  filePath = filePath.split("?")[0];
  let full = path.join(distDir, filePath);
  if (!fs.existsSync(full)) full = path.join(distDir, "index.html");
  const ext = path.extname(full);
  const headers: Record<string, string> = {
    "Content-Type": MIME[ext] || "application/octet-stream",
  };

  // Service worker must not be aggressively cached and needs root scope
  if (filePath === "/sw.js") {
    headers["Cache-Control"] = "no-cache";
    headers["Service-Worker-Allowed"] = "/";
  }

  res.writeHead(200, headers);
  fs.createReadStream(full).pipe(res);
  return true;
}

// ── Server factory ──────────────────────────────────────────────────

export interface ServerOptions {
  distDir: string;
  isProd: boolean;
}

export function createServer(opts: ServerOptions): http.Server {
  const { distDir, isProd } = opts;

  // ── API routes ────────────────────────────────────────────────
  const api = new Router();
  registerStatusRoutes(api);
  registerProjectRoutes(api);
  registerSessionRoutes(api);

  // ── HTTP server ───────────────────────────────────────────────
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/api/")) {
      try {
        if (!api.handle(req, res)) {
          sendJson(res, { error: "Not found" }, 404);
        }
      } catch (e: any) {
        console.error("[api]", e);
        sendJson(res, { error: e.message }, 500);
      }
      return;
    }

    if (serveStatic(req, res, distDir, isProd)) return;

    res.writeHead(404);
    res.end("Not found");
  });

  // ── WebSocket server ──────────────────────────────────────────
  attachWebSocketServer(server);

  return server;
}
