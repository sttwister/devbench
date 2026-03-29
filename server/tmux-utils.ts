import { execFileSync } from "child_process";

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
      ? ["capture-pane", "-p", "-S", `-${scrollBack}`, "-t", tmuxName]
      : ["capture-pane", "-p", "-t", tmuxName];
    return execFileSync("tmux", args, { encoding: "utf-8", timeout: 5000 });
  } catch {
    return "";
  }
}

/** Check if a tmux session exists. */
export function tmuxSessionExists(name: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Kill a tmux session (no-op if already dead). */
export function destroyTmuxSession(tmuxName: string): void {
  try {
    execFileSync("tmux", ["kill-session", "-t", tmuxName], { stdio: "ignore" });
  } catch {
    // already dead
  }
}

/** Get the current pane dimensions as a "WxH" string. */
export function paneDimensions(tmuxName: string): string {
  try {
    return execFileSync(
      "tmux",
      ["display-message", "-p", "-t", tmuxName, "#{pane_width}x#{pane_height}"],
      { encoding: "utf-8", timeout: 5000 }
    ).trim();
  } catch {
    return "";
  }
}
