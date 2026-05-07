import { execFileSync } from "child_process";

/** Threshold (ms) above which synchronous tmux calls are logged as slow. */
const SLOW_THRESHOLD_MS = 50;

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
    const start = performance.now();
    const result = execFileSync("tmux", args, { encoding: "utf-8", timeout: 5000 });
    const elapsed = performance.now() - start;
    if (elapsed > SLOW_THRESHOLD_MS) {
      console.log(`[tmux-utils] SLOW capturePane(${tmuxName}) took ${elapsed.toFixed(1)}ms`);
    }
    return result;
  } catch {
    return "";
  }
}

/** Check if a tmux session exists. */
export function tmuxSessionExists(name: string): boolean {
  try {
    const start = performance.now();
    execFileSync("tmux", ["has-session", "-t", name], { stdio: "ignore" });
    const elapsed = performance.now() - start;
    if (elapsed > SLOW_THRESHOLD_MS) {
      console.log(`[tmux-utils] SLOW tmuxSessionExists(${name}) took ${elapsed.toFixed(1)}ms`);
    }
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
    const start = performance.now();
    const result = execFileSync(
      "tmux",
      ["display-message", "-p", "-t", tmuxName, "#{pane_width}x#{pane_height}"],
      { encoding: "utf-8", timeout: 5000 }
    ).trim();
    const elapsed = performance.now() - start;
    if (elapsed > SLOW_THRESHOLD_MS) {
      console.log(`[tmux-utils] SLOW paneDimensions(${tmuxName}) took ${elapsed.toFixed(1)}ms`);
    }
    return result;
  } catch {
    return "";
  }
}

/**
 * Send text to a tmux session using bracketed paste mode.
 * This pastes the text into the terminal without executing it,
 * allowing the user to review/edit before pressing Enter.
 *
 * Uses tmux's `load-buffer` + `paste-buffer` for reliable multi-line pasting
 * that avoids shell interpretation issues.
 */
export function pasteToPane(tmuxName: string, text: string): void {
  try {
    // Use tmux load-buffer from stdin, then paste-buffer
    // This handles multi-line text and special characters correctly
    execFileSync("tmux", ["load-buffer", "-b", "devbench-paste", "-"], {
      input: text,
      timeout: 5000,
    });
    execFileSync("tmux", ["paste-buffer", "-b", "devbench-paste", "-d", "-t", tmuxName, "-p"], {
      timeout: 5000,
    });
  } catch (e: any) {
    console.error(`[tmux-utils] pasteToPane failed: ${e.message}`);
  }
}

/**
 * Paste text into a tmux pane and immediately press Enter to submit it.
 * Used for agents (like Claude Code) whose TUI does not auto-submit pasted text.
 */
export function pasteAndSubmit(tmuxName: string, text: string): void {
  pasteToPane(tmuxName, text);
  try {
    execFileSync("tmux", ["send-keys", "-t", tmuxName, "Enter"], { timeout: 5000 });
  } catch (e: any) {
    console.error(`[tmux-utils] pasteAndSubmit send-keys failed: ${e.message}`);
  }
}
