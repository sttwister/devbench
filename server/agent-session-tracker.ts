// @lat: [[sessions#Agent Session Tracking]]
/**
 * Tracks agent session IDs for Claude Code, Pi, and Codex.
 *
 * - Claude: we control the session ID via --session-id <uuid>
 * - Pi: we control the session path via --session <path>
 * - Codex: resumed via `codex resume <id>`; fresh thread IDs are discovered
 *   later via the Codex SessionStart hook because the CLI doesn't let us
 *   choose them upfront.
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

export function claudeLaunchCommand(sessionId: string, planMode?: boolean): string {
  const permFlag = planMode ? "--permission-mode plan" : "--dangerously-skip-permissions";
  return `claude --session-id ${sessionId} ${permFlag}`;
}

export function claudeResumeCommand(sessionId: string, planMode?: boolean): string {
  const permFlag = planMode ? "--permission-mode plan" : "--dangerously-skip-permissions";
  return `claude --resume ${sessionId} ${permFlag}`;
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

// ── Fork commands ───────────────────────────────────────────────────

export function claudeForkCommand(sessionId: string, planMode?: boolean): string {
  const permFlag = planMode ? "--permission-mode plan" : "--dangerously-skip-permissions";
  return `claude --resume ${sessionId} --fork-session ${permFlag}`;
}

export function piForkCommand(sessionPath: string): string {
  return `pi --fork ${sessionPath}`;
}

/** Get the fork command for an agent session, or null if unsupported. */
export function getForkCommand(
  type: SessionType,
  agentSessionId: string
): string | null {
  switch (type) {
    case "claude":
      return claudeForkCommand(agentSessionId);
    case "pi":
      return piForkCommand(agentSessionId);
    default:
      return null;
  }
}

// ── Codex: resume by known thread id; discover fresh ids via hook ───

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
  /** The agent session ID to persist immediately, or null when discovered later. */
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
 *
 * When `planMode` is true and type is "claude", the agent launches in plan
 * mode (`--permission-mode plan`) instead of `--dangerously-skip-permissions`.
 */
export function getLaunchInfo(
  type: SessionType,
  cwd: string,
  existingSessionId: string | null,
  initialPrompt?: string | null,
  planMode?: boolean
): LaunchInfo {
  if (type === "terminal") {
    return { command: null, agentSessionId: null, promptFile: null };
  }

  // Resume with existing session ID (ignore initialPrompt on resume)
  if (existingSessionId) {
    const cmd = type === "claude"
      ? claudeResumeCommand(existingSessionId, planMode)
      : getResumeCommand(type, existingSessionId);
    return {
      command: cmd,
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
        const cmd = `${claudeLaunchCommand(id, planMode)} -- "$(cat ${promptFile})"`;
        console.log(`[agent-tracker] claude launch (prompt): planMode=${planMode} cmd=${cmd}`);
        return { command: cmd, agentSessionId: id, promptFile };
      }
      const cmd = claudeLaunchCommand(id, planMode);
      console.log(`[agent-tracker] claude launch: planMode=${planMode} cmd=${cmd}`);
      return { command: cmd, agentSessionId: id, promptFile: null };
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
    case "codex": {
      if (initialPrompt) {
        promptFile = writePromptFile(initialPrompt);
        // Codex accepts an initial prompt as a positional CLI argument.
        const cmd = `codex "$(cat ${promptFile})"`;
        return { command: cmd, agentSessionId: null, promptFile };
      }
      return { command: getFreshLaunchCommand(type), agentSessionId: null, promptFile: null };
    }
    default:
      return { command: getFreshLaunchCommand(type), agentSessionId: null, promptFile: null };
  }
}
