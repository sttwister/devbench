/**
 * Tracks agent session IDs for Claude Code, Pi, and Codex.
 *
 * - Claude: we control the session ID via --session-id <uuid>
 * - Pi: we control the session path via --session <path>
 * - Codex: not tracked (CLI doesn't support setting a session ID)
 */

import { randomUUID } from "crypto";
import { join } from "path";
import { homedir } from "os";
import type { SessionType } from "@devbench/shared";

// ── Path helpers ────────────────────────────────────────────────────

/** Pi stores sessions at ~/.pi/agent/sessions/--<encoded-cwd>--/<ts>_<uuid>.jsonl */
function piSessionDir(projectPath: string): string {
  // /home/user/code → --home-user-code--
  const encoded = projectPath.slice(1).replace(/\//g, "-");
  return join(homedir(), ".pi", "agent", "sessions", `--${encoded}--`);
}

// ── Claude: deterministic session ID ────────────────────────────────

export function generateClaudeSessionId(): string {
  return randomUUID();
}

export function claudeLaunchCommand(sessionId: string): string {
  return `claude --session-id ${sessionId} --dangerously-skip-permissions`;
}

export function claudeResumeCommand(sessionId: string): string {
  return `claude --resume ${sessionId} --dangerously-skip-permissions`;
}

// ── Pi: deterministic session path ──────────────────────────────────

/** Generate a Pi session file path in Pi's standard naming format */
export function generatePiSessionPath(projectPath: string): string {
  const dir = piSessionDir(projectPath);
  const now = new Date();
  const ts = now.toISOString()
    .replace(/:/g, "-")
    .replace(/\./g, "-");        // 2026-03-29T13-02-40-661Z
  const uuid = randomUUID();
  return join(dir, `${ts}_${uuid}.jsonl`);
}

export function piLaunchCommand(sessionPath: string): string {
  return `pi --session ${sessionPath}`;
}

export function piResumeCommand(agentSessionId: string): string {
  // agentSessionId is the full path to the session file
  return `pi --session ${agentSessionId}`;
}

// ── Codex: no session tracking (not supported by CLI) ───────────────

export function codexResumeCommand(sessionId: string): string {
  return `codex resume ${sessionId}`;
}

// ── Resume command for any agent type ───────────────────────────────

export function getResumeCommand(
  type: SessionType,
  agentSessionId: string
): string | null {
  switch (type) {
    case "claude":
      return claudeResumeCommand(agentSessionId);
    case "pi":
      return piResumeCommand(agentSessionId);
    case "codex":
      return codexResumeCommand(agentSessionId);
    default:
      return null;
  }
}

/** Fresh launch command (when no session ID is available) */
export function getFreshLaunchCommand(type: SessionType): string | null {
  switch (type) {
    case "claude":
      return "claude --dangerously-skip-permissions";
    case "pi":
      return "pi";
    case "codex":
      return "codex";
    default:
      return null;
  }
}

// ── Unified launch info ─────────────────────────────────────────────

export interface LaunchInfo {
  /** Shell command to send into tmux, or null if none needed (plain terminal). */
  command: string | null;
  /** The agent session ID to persist, or null for terminal/codex. */
  agentSessionId: string | null;
}

/**
 * Determine the launch command and agent session ID for a session.
 *
 * When `existingSessionId` is provided, the agent is resumed with it.
 * Otherwise a fresh launch is prepared (with a new session ID generated
 * for Claude and Pi).
 */
export function getLaunchInfo(
  type: SessionType,
  cwd: string,
  existingSessionId: string | null
): LaunchInfo {
  if (type === "terminal") return { command: null, agentSessionId: null };

  // Resume with existing session ID
  if (existingSessionId) {
    return {
      command: getResumeCommand(type, existingSessionId),
      agentSessionId: existingSessionId,
    };
  }

  // Fresh launch — generate a new session ID where possible
  switch (type) {
    case "claude": {
      const id = generateClaudeSessionId();
      return { command: claudeLaunchCommand(id), agentSessionId: id };
    }
    case "pi": {
      const sessionPath = generatePiSessionPath(cwd);
      return { command: piLaunchCommand(sessionPath), agentSessionId: sessionPath };
    }
    default:
      return { command: getFreshLaunchCommand(type), agentSessionId: null };
  }
}
