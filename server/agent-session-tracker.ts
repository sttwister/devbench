// @lat: [[sessions#Agent Session Tracking]]
/**
 * Tracks agent session IDs for Claude Code, Pi, and Codex.
 *
 * - Claude: we control the session ID via --session-id <uuid>
 * - Pi: we control the session path via --session <path>
 * - Codex: not tracked (CLI doesn't support setting a session ID)
 */

import { randomUUID } from "crypto";
import { join } from "path";
import { homedir, tmpdir } from "os";
import { writeFileSync } from "fs";
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
  /** Optional temp file to clean up after launch. */
  promptFile: string | null;
}

/** Write a prompt string to a temp file and return the path. */
function writePromptFile(prompt: string): string {
  const filename = `devbench-prompt-${randomUUID()}.md`;
  const filepath = join(tmpdir(), filename);
  writeFileSync(filepath, prompt, "utf-8");
  return filepath;
}

/**
 * Determine the launch command and agent session ID for a session.
 *
 * When `existingSessionId` is provided, the agent is resumed with it.
 * Otherwise a fresh launch is prepared (with a new session ID generated
 * for Claude and Pi).
 *
 * When `initialPrompt` is provided, the agent is launched with that prompt.
 */
export function getLaunchInfo(
  type: SessionType,
  cwd: string,
  existingSessionId: string | null,
  initialPrompt?: string | null
): LaunchInfo {
  if (type === "terminal") {
    return { command: null, agentSessionId: null, promptFile: null };
  }

  // Resume with existing session ID (ignore initialPrompt on resume)
  if (existingSessionId) {
    return {
      command: getResumeCommand(type, existingSessionId),
      agentSessionId: existingSessionId,
      promptFile: null,
    };
  }

  // Fresh launch — generate a new session ID where possible
  let promptFile: string | null = null;

  switch (type) {
    case "claude": {
      const id = generateClaudeSessionId();
      if (initialPrompt) {
        promptFile = writePromptFile(initialPrompt);
        // Shell substitution reads the file as the prompt argument
        const cmd = `${claudeLaunchCommand(id)} -- "$(cat ${promptFile})"`;
        return { command: cmd, agentSessionId: id, promptFile };
      }
      return { command: claudeLaunchCommand(id), agentSessionId: id, promptFile: null };
    }
    case "pi": {
      const sessionPath = generatePiSessionPath(cwd);
      if (initialPrompt) {
        promptFile = writePromptFile(initialPrompt);
        // Pi's @file syntax includes file content in the message
        const cmd = `${piLaunchCommand(sessionPath)} @${promptFile}`;
        return { command: cmd, agentSessionId: sessionPath, promptFile };
      }
      return { command: piLaunchCommand(sessionPath), agentSessionId: sessionPath, promptFile: null };
    }
    default:
      return { command: getFreshLaunchCommand(type), agentSessionId: null, promptFile: null };
  }
}
