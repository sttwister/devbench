// @lat: [[architecture#Startup Flow]]
import path from "path";
import { fileURLToPath } from "url";
import * as db from "./db.ts";
import * as terminal from "./terminal.ts";
import * as monitors from "./monitor-manager.ts";
import { createServer } from "./server.ts";

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
      monitors.markOrphaned(s.id);
      continue;
    }

    monitors.resumeSessionMonitors(s.id, s.tmux_name, s.name, s.type, s.mr_urls);
  }
}

// ── Create server ───────────────────────────────────────────────────

const server = createServer({ distDir: DIST_DIR, isProd: IS_PROD });

// ── Health check: archive sessions whose tmux died ──────────────────
setInterval(() => {
  for (const s of db.getAllSessions()) {
    if (monitors.isOrphaned(s.id)) continue;
    if (!terminal.tmuxSessionExists(s.tmux_name)) {
      console.log(`[health] Archiving dead session ${s.id} (${s.tmux_name})`);
      monitors.stopSessionMonitors(s.id);
      db.archiveSession(s.id);
    }
  }
}, 10_000);

// ── Start ───────────────────────────────────────────────────────────
server.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Devbench server on http://0.0.0.0:${PORT}`);
});
