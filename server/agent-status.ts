import { execSync } from "child_process";
import { tmuxSessionExists } from "./terminal.ts";
import type { SessionType } from "@devbench/shared";

export type AgentStatus = "working" | "waiting";

const POLL_INTERVAL = 3_000; // Check every 3 seconds
const STABLE_THRESHOLD = 2; // Consecutive unchanged polls before "waiting"

interface MonitorState {
  timer: NodeJS.Timeout;
  lastHash: number;
  lastDims: string;
  unchangedCount: number;
  currentStatus: AgentStatus;
}

const monitors = new Map<number, MonitorState>();

function capturePane(tmuxName: string): string {
  try {
    return execSync(`tmux capture-pane -p -t ${tmuxName}`, {
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch {
    return "";
  }
}

/**
 * Hash the upper portion of the terminal, excluding the bottom INPUT_AREA_LINES.
 *
 * Agent TUIs (Claude Code, Pi, Codex) all place the input prompt at the bottom
 * of the screen. By ignoring those lines we avoid misdetecting user keystrokes
 * as agent activity — only changes in the conversation / output area above
 * trigger a "working" transition.
 */
const INPUT_AREA_LINES = 5;

function hashContent(content: string): number {
  const lines = content.split("\n");
  const upper = lines.slice(0, Math.max(1, lines.length - INPUT_AREA_LINES));
  const normalized = upper
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
  let h = 0;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) - h + normalized.charCodeAt(i)) | 0;
  }
  return h;
}

/** Get the current pane dimensions as a "WxH" string. */
function paneDimensions(tmuxName: string): string {
  try {
    return execSync(
      `tmux display-message -p -t ${tmuxName} '#{pane_width}x#{pane_height}'`,
      { encoding: "utf-8", timeout: 5000 }
    ).trim();
  } catch {
    return "";
  }
}

/**
 * Start monitoring an agent session for status changes.
 * Terminal sessions are ignored. Only agent types (claude, pi, codex) are tracked.
 *
 * @param onChange Called whenever the status transitions (working↔waiting).
 */
export function startMonitoring(
  sessionId: number,
  tmuxName: string,
  type: SessionType,
  onChange?: (sessionId: number, status: AgentStatus) => void
): void {
  if (type === "terminal") return;
  if (monitors.has(sessionId)) return;

  // Capture initial baseline immediately so the first poll can detect changes
  const initialContent = capturePane(tmuxName);
  const initialHash = hashContent(initialContent);

  const state: MonitorState = {
    timer: null!,
    lastHash: initialHash,
    lastDims: paneDimensions(tmuxName),
    unchangedCount: 0,
    currentStatus: "working", // Assume working initially (agent is booting)
  };

  state.timer = setInterval(() => {
    if (!tmuxSessionExists(tmuxName)) {
      stopMonitoring(sessionId);
      return;
    }

    // If pane was resized, re-baseline and skip this cycle — the TUI
    // redraws everything on resize which would cause a false "working".
    const dims = paneDimensions(tmuxName);
    if (dims && dims !== state.lastDims) {
      state.lastDims = dims;
      state.lastHash = hashContent(capturePane(tmuxName));
      return;
    }

    const content = capturePane(tmuxName);
    if (!content) return;

    const hash = hashContent(content);

    if (hash !== state.lastHash) {
      // Content changed → working
      state.lastHash = hash;
      state.unchangedCount = 0;
      if (state.currentStatus !== "working") {
        state.currentStatus = "working";
        console.log(`[agent-status] Session ${sessionId}: working`);
        onChange?.(sessionId, "working");
      }
    } else {
      // Content unchanged
      state.unchangedCount++;
      if (
        state.unchangedCount >= STABLE_THRESHOLD &&
        state.currentStatus !== "waiting"
      ) {
        state.currentStatus = "waiting";
        console.log(`[agent-status] Session ${sessionId}: waiting`);
        onChange?.(sessionId, "waiting");
      }
    }
  }, POLL_INTERVAL);

  monitors.set(sessionId, state);
}

export function stopMonitoring(sessionId: number): void {
  const m = monitors.get(sessionId);
  if (m) {
    clearInterval(m.timer);
    monitors.delete(sessionId);
  }
}

export function getStatus(sessionId: number): AgentStatus | null {
  return monitors.get(sessionId)?.currentStatus ?? null;
}

/** Return all tracked statuses as a plain object (for the API). */
export function getAllStatuses(): Record<number, AgentStatus> {
  const result: Record<number, AgentStatus> = {};
  for (const [id, state] of monitors) {
    result[id] = state.currentStatus;
  }
  return result;
}
