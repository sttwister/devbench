import path from "path";
import { fileURLToPath } from "url";
import * as db from "./db.ts";
import * as terminal from "./terminal.ts";
import * as monitors from "./monitor-manager.ts";
import * as orchestration from "./orchestration.ts";
import * as cacheWatch from "./cache-watch.ts";
import { createServer } from "./server.ts";
import { logger } from "./logger.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3001");
const DIST_DIR = path.join(__dirname, "..", "client", "dist");
const IS_PROD = process.env.NODE_ENV === "production";

// ── Startup: initialize monitoring for all active sessions ─────────
{
  const sessions = db.getAllSessions();
  for (const s of sessions) {
    if (!terminal.tmuxSessionExists(s.tmux_name)) {
      console.log(`[startup] Session ${s.id} (${s.tmux_name}) has no tmux — keeping as orphaned`);
      logger.info("startup", `Session ${s.id} (${s.tmux_name}) has no tmux — keeping as orphaned`);
      monitors.markOrphaned(s.id);
      continue;
    }

    monitors.resumeSessionMonitors(s.id, s.tmux_name, s.name, s.type, s.mr_urls);
  }

  // Start global MR status polling (polls all open MRs for active sessions)
  monitors.startMrStatusPolling();

  // Resume orchestration engine if it was running before restart
  orchestration.resume();

  // Watch Claude prompt caches: warn before expiry, auto-compact when enabled
  cacheWatch.start();
}

// ── Create server ───────────────────────────────────────────────────

const server = createServer({ distDir: DIST_DIR, isProd: IS_PROD });

// ── Health check: archive sessions whose tmux died ──────────────────
setInterval(() => {
  for (const s of db.getAllSessions()) {
    if (monitors.isOrphaned(s.id)) continue;
    if (!terminal.tmuxSessionExists(s.tmux_name)) {
      console.log(`[health] Archiving dead session ${s.id} (${s.tmux_name})`);
      logger.info("health", `Archiving dead session ${s.id} (${s.tmux_name})`);
      monitors.stopSessionMonitors(s.id);
      db.archiveSession(s.id);
    }
  }
}, 10_000);

// ── Event loop lag detector ─────────────────────────────────────────
// Fires a timer every 500ms; if the callback is delayed significantly,
// the event loop was blocked by synchronous work.
{
  const EVENT_LOOP_CHECK_INTERVAL = 500;
  const EVENT_LOOP_LAG_THRESHOLD = 100; // ms
  let lastCheck = performance.now();
  setInterval(() => {
    const now = performance.now();
    const expected = EVENT_LOOP_CHECK_INTERVAL;
    const actual = now - lastCheck;
    const lag = actual - expected;
    if (lag > EVENT_LOOP_LAG_THRESHOLD) {
      console.log(`[event-loop] LAG detected: ${lag.toFixed(0)}ms (expected ${expected}ms, got ${actual.toFixed(0)}ms)`);
      logger.warn("event-loop", `LAG detected: ${lag.toFixed(0)}ms`, { expected, actual: Math.round(actual), lag: Math.round(lag) });
    }
    lastCheck = now;
  }, EVENT_LOOP_CHECK_INTERVAL);
}

// ── Start ───────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Devbench server on http://0.0.0.0:${PORT}`);
  logger.info("server", `Started on http://0.0.0.0:${PORT}`, { port: PORT, isProd: IS_PROD });
});
