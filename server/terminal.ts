import * as pty from "node-pty";
import { execSync, execFile } from "child_process";
import type { WebSocket } from "ws";

interface PtyHandle {
  term: pty.IPty;
  tmuxName: string;
}

const activePtys = new Map<WebSocket, PtyHandle>();

/** Check if a tmux session exists */
export function tmuxSessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Create a new detached tmux session */
export function createTmuxSession(
  tmuxName: string,
  cwd: string,
  type: "terminal" | "claude" | "pi" | "codex"
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "tmux",
      ["new-session", "-d", "-s", tmuxName, "-c", cwd, "-x", "200", "-y", "50"],
      (err) => {
        if (err) return reject(new Error(`Failed to create tmux session: ${err.message}`));

        if (type === "claude") {
          setTimeout(() => {
            execFile(
              "tmux",
              ["send-keys", "-t", tmuxName, "claude --dangerously-skip-permissions", "Enter"],
              (err2) => {
                if (err2) return reject(err2);
                resolve();
              }
            );
          }, 100);
        } else if (type === "pi") {
          setTimeout(() => {
            execFile(
              "tmux",
              ["send-keys", "-t", tmuxName, "pi", "Enter"],
              (err2) => {
                if (err2) return reject(err2);
                resolve();
              }
            );
          }, 100);
        } else if (type === "codex") {
          setTimeout(() => {
            execFile(
              "tmux",
              ["send-keys", "-t", tmuxName, "codex", "Enter"],
              (err2) => {
                if (err2) return reject(err2);
                resolve();
              }
            );
          }, 100);
        } else {
          resolve();
        }
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

export function destroyTmuxSession(tmuxName: string): void {
  try {
    execSync(`tmux kill-session -t ${tmuxName}`, { stdio: "ignore" });
  } catch {
    // already dead
  }
}
