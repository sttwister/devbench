import { execSync } from "child_process";

/**
 * Capture the visible content of a tmux pane.
 *
 * @param tmuxName  The tmux session name.
 * @param scrollBack  Number of lines of scroll-back history to include
 *                    (pass 0 or omit for visible pane only).
 */
export function capturePane(tmuxName: string, scrollBack = 0): string {
  try {
    const args = scrollBack > 0
      ? `tmux capture-pane -p -S -${scrollBack} -t ${tmuxName}`
      : `tmux capture-pane -p -t ${tmuxName}`;
    return execSync(args, { encoding: "utf-8", timeout: 5000 });
  } catch {
    return "";
  }
}

/** Check if a tmux session exists. */
export function tmuxSessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Kill a tmux session (no-op if already dead). */
export function destroyTmuxSession(tmuxName: string): void {
  try {
    execSync(`tmux kill-session -t ${tmuxName}`, { stdio: "ignore" });
  } catch {
    // already dead
  }
}
