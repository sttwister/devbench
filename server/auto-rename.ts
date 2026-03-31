import { execFile } from "child_process";
import { getSourceLabel } from "@devbench/shared";
import * as db from "./db.ts";
import * as agentStatus from "./agent-status.ts";
import { capturePane, tmuxSessionExists } from "./tmux-utils.ts";
import { isDefaultSessionName } from "./session-naming.ts";

const INITIAL_DELAY = 5_000; // Let harness fully boot
const POLL_INTERVAL = 5_000; // Check every 5s
const MAX_POLLS = 60; // Give up after ~5 minutes
const MIN_CONTENT_CHANGE = 200; // Non-whitespace chars of new content
const NAME_SCROLLBACK = 200; // Include recent history so the task survives reflow

const activeMonitors = new Map<number, NodeJS.Timeout>();

/** Strip whitespace for comparison (ignores terminal reflows, empty lines) */
export function stripped(s: string): string {
  return s.replace(/\s+/g, "");
}

/**
 * Count how many characters differ between two strings.
 * Handles both content growth (regular terminals) and in-place content
 * changes (TUI apps like Pi / Claude Code where the screen stays full).
 */
export function contentDifference(a: string, b: string): number {
  let diffs = Math.abs(a.length - b.length);
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) diffs++;
  }
  return diffs;
}

function generateNameAsync(content: string): Promise<string | null> {
  return new Promise((resolve) => {
    const trimmed = normalizeContentForNaming(content).slice(0, 3000);
    if (!trimmed) return resolve(null);

    const prompt = [
      "Look at this terminal session content and determine what the user is working on.",
      "Generate a short descriptive name for this session.",
      "",
      "Rules:",
      "- Use kebab-case (lowercase with hyphens)",
      "- 2-5 words maximum",
      "- Describe the task or topic, not the tool being used",
      "- Ignore agent startup noise such as update notices, skill lists, extension warnings, session chrome, and tmux boilerplate",
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

export function normalizeContentForNaming(content: string): string {
  const lines = content.split("\n");
  const cleaned = lines
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, "").trimEnd())
    .map((line) => line.replace(/^❯\s*/, ""))
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return false;
      if (/^[\u2500-\u257f-]+$/.test(trimmed)) return false;
      if (/^\[Skill conflicts\]$/i.test(trimmed)) return false;
      if (/^Update Available$/i.test(trimmed)) return false;
      if (/^Changelog:$/i.test(trimmed)) return false;
      if (/^https:\/\/github\.com\/badlogic\/pi-mono\/blob\/main\/packages\/coding-agent\/CHANGELOG\.md$/i.test(trimmed)) return false;
      if (/^~\/\.claude\/skills\//.test(trimmed)) return false;
      if (/^name ".*" does not match parent directory$/i.test(trimmed)) return false;
      if (/^claude( --|$)/i.test(trimmed)) return false;
      if (/^pi( --|$)/i.test(trimmed)) return false;
      if (/^▐▛|^▝▜|^▘▘/.test(trimmed)) return false;
      if (/^\$[0-9.]+ .*claude/i.test(trimmed)) return false;
      if (/^Opus .*\/effort$/i.test(trimmed)) return false;
      if (/^plan mode on/i.test(trimmed)) return false;
      return true;
    });

  return cleaned.join("\n").trim();
}

async function applyResolvedName(
  sessionId: number,
  originalName: string,
  candidate: string | null,
  onRenamed?: (sessionId: number, newName: string) => void
): Promise<string | null> {
  if (!candidate) return null;

  const session = db.getSession(sessionId);
  if (!session || session.status !== "active") return null;

  // Respect manual renames: only overwrite the original/default name.
  if (session.name !== originalName) {
    console.log(
      `[auto-rename] Session ${sessionId} was manually renamed, skipping`
    );
    return session.name;
  }

  db.renameSession(sessionId, candidate);
  console.log(`[auto-rename] Session ${sessionId} → "${candidate}"`);
  onRenamed?.(sessionId, candidate);
  return candidate;
}

export async function resolveSessionWorkName(
  sessionId: number,
  tmuxName: string,
  currentName: string,
  sourceUrl?: string | null,
  onRenamed?: (sessionId: number, newName: string) => void
): Promise<string> {
  if (!isDefaultSessionName(currentName)) return currentName;

  const sourceLabel = sourceUrl ? getSourceLabel(sourceUrl) : null;
  if (sourceLabel) {
    const renamed = await applyResolvedName(sessionId, currentName, sourceLabel, onRenamed);
    return renamed ?? sourceLabel;
  }

  if (!tmuxSessionExists(tmuxName)) return currentName;

  const content = capturePane(tmuxName, NAME_SCROLLBACK);
  const generated = await generateNameAsync(content);
  const renamed = await applyResolvedName(sessionId, currentName, generated, onRenamed);
  return renamed ?? currentName;
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
  let baselineArmed = false;
  let pollCount = 0;
  let generating = false;

  // Wait for harness to fully boot, then wait for agent startup to settle
  // before capturing the baseline. This avoids Pi/Claude boot noise naming
  // the session before any actual work is visible.
  const startTimer = setTimeout(() => {
    const pollTimer = setInterval(() => {
      pollCount++;

      if (generating) return;
      if (pollCount >= MAX_POLLS || !tmuxSessionExists(tmuxName)) {
        stopAutoRename(sessionId);
        return;
      }

      if (!baselineArmed) {
        const status = agentStatus.getStatus(sessionId);
        if (status && status !== "waiting") return;
        baselineStripped = stripped(capturePane(tmuxName, NAME_SCROLLBACK));
        baselineArmed = true;
        return;
      }

      const current = capturePane(tmuxName, NAME_SCROLLBACK);
      const currentStripped = stripped(current);
      const delta = contentDifference(currentStripped, baselineStripped);

      if (delta < MIN_CONTENT_CHANGE) return;

      // Significant activity detected — generate a name
      generating = true;
      stopAutoRename(sessionId);

      generateNameAsync(current).then((name) => {
        void applyResolvedName(sessionId, originalName, name, onRenamed);
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
  const status = agentStatus.getStatus(sessionId);
  const content = capturePane(tmuxName, NAME_SCROLLBACK);
  const contentLen = stripped(normalizeContentForNaming(content)).length;

  if ((status == null || status === "waiting") && contentLen >= MIN_CONTENT_CHANGE) {
    // Enough content already — generate a name immediately
    console.log(`[auto-rename] Session ${sessionId} has existing content (${contentLen} chars), generating name`);
    generateNameAsync(content).then((name) => {
      void applyResolvedName(sessionId, originalName, name, onRenamed);
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
