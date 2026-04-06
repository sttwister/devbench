// @lat: [[sessions#Tmux Management]]
import * as pty from "node-pty";
import { execFile, execFileSync } from "child_process";
import { unlinkSync } from "fs";
import type { WebSocket } from "ws";
import type { SessionType } from "@devbench/shared";
import { tmuxSessionExists, destroyTmuxSession } from "./tmux-utils.ts";
import { getLaunchInfo, getForkCommand } from "./agent-session-tracker.ts";

export { tmuxSessionExists, destroyTmuxSession };

interface PtyHandle {
  term: pty.IPty;
  tmuxName: string;
}

const activePtys = new Map<WebSocket, PtyHandle>();

export interface CreateSessionResult {
  /** For Claude/Pi: the agent session ID. null for terminal/codex. */
  agentSessionId: string | null;
}

/**
 * Create a new detached tmux session and optionally launch an agent inside it.
 *
 * Used for both new sessions (`existingSessionId = null`) and reviving
 * orphaned/archived sessions (`existingSessionId` set to resume the agent).
 *
 * If `devbenchSessionId` is provided, DEVBENCH_PORT and DEVBENCH_SESSION_ID
 * are exported into the shell before the agent command runs, so agent
 * extensions/hooks can communicate back to devbench.
 */
function launchTmuxSession(
  tmuxName: string,
  cwd: string,
  type: SessionType,
  existingSessionId: string | null,
  initialPrompt?: string | null,
  devbenchSessionId?: number | null
): Promise<CreateSessionResult> {
  const { command, agentSessionId, promptFile } = getLaunchInfo(type, cwd, existingSessionId, initialPrompt);

  // Schedule prompt file cleanup after 60 seconds
  if (promptFile) {
    setTimeout(() => {
      try { unlinkSync(promptFile); } catch { /* already deleted or inaccessible */ }
    }, 60_000);
  }

  return new Promise((resolve, reject) => {
    execFile(
      "tmux",
      ["new-session", "-d", "-s", tmuxName, "-c", cwd, "-x", "200", "-y", "50"],
      (err) => {
        if (err) return reject(new Error(`Failed to create tmux session: ${err.message}`));

        // Also set tmux-level env vars (for processes spawned by tmux later)
        if (devbenchSessionId != null) {
          const port = process.env.PORT || "3001";
          try {
            execFileSync("tmux", ["set-environment", "-t", tmuxName, "DEVBENCH_PORT", port]);
            execFileSync("tmux", ["set-environment", "-t", tmuxName, "DEVBENCH_SESSION_ID", String(devbenchSessionId)]);
          } catch { /* best-effort */ }
        }

        if (!command && !devbenchSessionId) return resolve({ agentSessionId });

        // Build the shell commands to send: export env vars, then run agent
        const parts: string[] = [];
        if (devbenchSessionId != null) {
          const port = process.env.PORT || "3001";
          parts.push(`export DEVBENCH_PORT=${port} DEVBENCH_SESSION_ID=${devbenchSessionId}`);
        }
        if (command) {
          parts.push(command);
        }

        if (parts.length === 0) return resolve({ agentSessionId });

        // Join with " && " so env vars are set before agent starts
        const fullCommand = parts.join(" && ");

        setTimeout(() => {
          execFile(
            "tmux",
            ["send-keys", "-t", tmuxName, fullCommand, "Enter"],
            (err2) => {
              if (err2) return reject(err2);
              resolve({ agentSessionId });
            }
          );
        }, 100);
      }
    );
  });
}

/** Create a new detached tmux session with a fresh agent launch. */
export function createTmuxSession(
  tmuxName: string,
  cwd: string,
  type: SessionType,
  initialPrompt?: string | null,
  devbenchSessionId?: number | null
): Promise<CreateSessionResult> {
  return launchTmuxSession(tmuxName, cwd, type, null, initialPrompt, devbenchSessionId);
}

/** Revive an orphaned/archived session: create new tmux and resume the agent. */
export function reviveTmuxSession(
  tmuxName: string,
  cwd: string,
  type: SessionType,
  agentSessionId: string | null,
  devbenchSessionId?: number | null
): Promise<CreateSessionResult> {
  return launchTmuxSession(tmuxName, cwd, type, agentSessionId, undefined, devbenchSessionId);
}

/**
 * Fork an agent session into a new tmux pane (split window).
 * The forked pane is ephemeral — not tracked in devbench's DB.
 */
export function forkTmuxSession(
  tmuxName: string,
  cwd: string,
  type: SessionType,
  agentSessionId: string
): Promise<void> {
  const forkCmd = getForkCommand(type, agentSessionId);
  if (!forkCmd) {
    return Promise.reject(new Error(`Fork not supported for session type: ${type}`));
  }

  const shellCmd = `cd '${cwd.replace(/'/g, "'\\''")}' && ${forkCmd}`;

  return new Promise((resolve, reject) => {
    execFile(
      "tmux",
      ["split-window", "-h", "-t", tmuxName, shellCmd],
      (err) => {
        if (err) return reject(new Error(`tmux split-window failed: ${err.message}`));
        resolve();
      }
    );
  });
}

/** Attach a WebSocket to a tmux session via node-pty */
export function attachToSession(
  ws: WebSocket,
  tmuxName: string,
  cols = 80,
  rows = 24,
  onSessionEnded?: () => void
): void {
  // Clean env — remove TMUX vars to avoid nesting errors
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "TMUX" && k !== "TMUX_PANE" && v != null) env[k] = v;
  }
  env.TERM = "xterm-256color";

  const term = pty.spawn("tmux", ["attach-session", "-t", tmuxName], {
    name: "xterm-256color",
    cols,
    rows,
    env,
  });

  term.onData((data: string) => {
    try {
      if (ws.readyState === ws.OPEN) ws.send(data);
    } catch {
      // ws may be closed
    }
  });

  term.onExit(({ exitCode, signal }) => {
    console.log(`[pty] exit code=${exitCode} signal=${signal} (${tmuxName})`);
    activePtys.delete(ws);

    // If the tmux session no longer exists, it was closed from inside
    if (!tmuxSessionExists(tmuxName) && onSessionEnded) {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.send("\x01" + JSON.stringify({ type: "session-ended" }));
        }
      } catch {}
      onSessionEnded();
    }

    try {
      if (ws.readyState === ws.OPEN) ws.close();
    } catch {}
  });

  activePtys.set(ws, { term, tmuxName });
}

export function handleInput(ws: WebSocket, data: string): void {
  const h = activePtys.get(ws);
  if (h) h.term.write(data);
}

export function handleResize(ws: WebSocket, cols: number, rows: number): void {
  const h = activePtys.get(ws);
  if (h) h.term.resize(cols, rows);
}

export function detach(ws: WebSocket): void {
  const h = activePtys.get(ws);
  if (h) {
    h.term.kill();
    activePtys.delete(ws);
  }
}

/** Send a control message to all WebSocket clients attached to a tmux session */
export function broadcastControl(tmuxName: string, msg: object): void {
  for (const [ws, handle] of activePtys) {
    if (handle.tmuxName === tmuxName) {
      try {
        if (ws.readyState === 1 /* OPEN */) {
          ws.send("\x01" + JSON.stringify(msg));
        }
      } catch {}
    }
  }
}


