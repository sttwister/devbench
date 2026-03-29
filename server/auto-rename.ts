import { execFile } from "child_process";
import * as db from "./db.ts";
import { capturePane, tmuxSessionExists } from "./tmux-utils.ts";

const INITIAL_DELAY = 5_000; // Let harness fully boot
const POLL_INTERVAL = 5_000; // Check every 5s
const MAX_POLLS = 60; // Give up after ~5 minutes
const MIN_CONTENT_CHANGE = 200; // Non-whitespace chars of new content

const activeMonitors = new Map<number, NodeJS.Timeout>();

/** Strip whitespace for comparison (ignores terminal reflows, empty lines) */
function stripped(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * Count how many characters differ between two strings.
 * Handles both content growth (regular terminals) and in-place content
 * changes (TUI apps like Pi / Claude Code where the screen stays full).
 */
function contentDifference(a: string, b: string): number {
  let diffs = Math.abs(a.length - b.length);
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) diffs++;
  }
  return diffs;
}

function generateNameAsync(content: string): Promise<string | null> {
  return new Promise((resolve) => {
    const trimmed = content.trim().slice(0, 3000);
    const prompt = [
      "Look at this terminal session content and determine what the user is working on.",
      "Generate a short descriptive name for this session.",
      "",
      "Rules:",
      "- Use kebab-case (lowercase with hyphens)",
      "- 2-5 words maximum",
      "- Describe the task or topic, not the tool being used",
      '- No prefixes like "session-" or "task-"',
      "- Output ONLY the name, nothing else",
      "",
      "Terminal content:",
      trimmed,
    ].join("\n");

    execFile(
      "claude",
      ["-p", "--model", "haiku", prompt],
      { timeout: 30_000 },
      (err, stdout) => {
        if (err) {
          console.error("[auto-rename] LLM call failed:", err.message);
          return resolve(null);
        }
        const raw = stdout.trim().toLowerCase();
        // Sanitise to valid kebab-case
        const name = raw
          .replace(/[^a-z0-9-\s]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "");
        resolve(name || null);
      }
    );
  });
}

/**
 * Start monitoring a session for first meaningful activity, then auto-rename.
 * @param originalName - the name at creation time; skips rename if user already changed it.
 * @param onRenamed - callback fired after a successful rename.
 */
export function startAutoRename(
  sessionId: number,
  tmuxName: string,
  originalName: string,
  onRenamed?: (sessionId: number, newName: string) => void
): void {
  if (activeMonitors.has(sessionId)) return;

  let baselineStripped = "";
  let pollCount = 0;
  let generating = false;

  // Wait for harness to fully boot, then capture baseline
  const startTimer = setTimeout(() => {
    baselineStripped = stripped(capturePane(tmuxName));

    const pollTimer = setInterval(() => {
      pollCount++;

      if (generating) return;
      if (pollCount >= MAX_POLLS || !tmuxSessionExists(tmuxName)) {
        stopAutoRename(sessionId);
        return;
      }

      const current = capturePane(tmuxName);
      const currentStripped = stripped(current);
      const delta = contentDifference(currentStripped, baselineStripped);

      if (delta < MIN_CONTENT_CHANGE) return;

      // Significant activity detected — generate a name
      generating = true;
      stopAutoRename(sessionId);

      generateNameAsync(current).then((name) => {
        if (!name) return;

        const session = db.getSession(sessionId);
        if (!session || session.status !== "active") return;

        // Respect manual renames: only overwrite the default name
        if (session.name !== originalName) {
          console.log(
            `[auto-rename] Session ${sessionId} was manually renamed, skipping`
          );
          return;
        }

        db.renameSession(sessionId, name);
        console.log(`[auto-rename] Session ${sessionId} → "${name}"`);
        onRenamed?.(sessionId, name);
      });
    }, POLL_INTERVAL);

    activeMonitors.set(sessionId, pollTimer);
  }, INITIAL_DELAY);

  activeMonitors.set(sessionId, startTimer as unknown as NodeJS.Timeout);
}

/**
 * Immediately try to rename a session based on its current terminal content.
 * Used at server startup for sessions that already have activity but still
 * carry a default name (e.g. after a server restart).
 * Also starts monitoring for future changes as a fallback.
 */
export function tryRenameNow(
  sessionId: number,
  tmuxName: string,
  originalName: string,
  onRenamed?: (sessionId: number, newName: string) => void
): void {
  const content = capturePane(tmuxName);
  const contentLen = stripped(content).length;

  if (contentLen >= MIN_CONTENT_CHANGE) {
    // Enough content already — generate a name immediately
    console.log(`[auto-rename] Session ${sessionId} has existing content (${contentLen} chars), generating name`);
    generateNameAsync(content).then((name) => {
      if (!name) return;

      const session = db.getSession(sessionId);
      if (!session || session.status !== "active") return;
      if (session.name !== originalName) return;

      db.renameSession(sessionId, name);
      console.log(`[auto-rename] Session ${sessionId} → "${name}"`);
      onRenamed?.(sessionId, name);
    });
  }

  // Also start monitoring for future changes (in case content is still sparse
  // or the immediate rename fails)
  startAutoRename(sessionId, tmuxName, originalName, onRenamed);
}

export function stopAutoRename(sessionId: number): void {
  const timer = activeMonitors.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    activeMonitors.delete(sessionId);
  }
}
