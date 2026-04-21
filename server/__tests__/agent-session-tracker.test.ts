// @lat: [[tests#Sessions#Agent Session Tracking]]
import { describe, it, expect } from "vitest";
import {
  generateClaudeSessionId,
  claudeLaunchCommand,
  claudeResumeCommand,
  generatePiSessionPath,
  piLaunchCommand,
  piResumeCommand,
  codexResumeCommand,
  getResumeCommand,
  getFreshLaunchCommand,
  getLaunchInfo,
} from "../agent-session-tracker.ts";

describe("Claude session commands", () => {
  it("generateClaudeSessionId returns a UUID", () => {
    const id = generateClaudeSessionId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it("generateClaudeSessionId returns unique IDs", () => {
    const a = generateClaudeSessionId();
    const b = generateClaudeSessionId();
    expect(a).not.toBe(b);
  });

  it("claudeLaunchCommand includes --session-id and --dangerously-skip-permissions", () => {
    const cmd = claudeLaunchCommand("abc-123");
    expect(cmd).toBe("claude --session-id abc-123 --dangerously-skip-permissions");
  });

  it("claudeResumeCommand includes --resume and --dangerously-skip-permissions", () => {
    const cmd = claudeResumeCommand("abc-123");
    expect(cmd).toBe("claude --resume abc-123 --dangerously-skip-permissions");
  });
});

describe("Pi session commands", () => {
  it("generatePiSessionPath returns a path under ~/.pi/agent/sessions/", () => {
    const p = generatePiSessionPath("/home/user/project");
    expect(p).toContain(".pi/agent/sessions/");
    expect(p).toContain("--home-user-project--");
    expect(p).toMatch(/\.jsonl$/);
  });

  it("generatePiSessionPath encodes path correctly", () => {
    const p = generatePiSessionPath("/tmp/my-project");
    expect(p).toContain("--tmp-my-project--");
  });

  it("piLaunchCommand includes --session", () => {
    const cmd = piLaunchCommand("/path/to/session.jsonl");
    expect(cmd).toBe("pi --session /path/to/session.jsonl");
  });

  it("piResumeCommand includes --session", () => {
    const cmd = piResumeCommand("/path/to/session.jsonl");
    expect(cmd).toBe("pi --session /path/to/session.jsonl");
  });
});

describe("Codex session commands", () => {
  it("codexResumeCommand includes resume subcommand", () => {
    const cmd = codexResumeCommand("session-xyz");
    expect(cmd).toBe("codex resume session-xyz");
  });
});

describe("getResumeCommand", () => {
  it("returns claude resume command for claude type", () => {
    const cmd = getResumeCommand("claude", "id-1");
    expect(cmd).toContain("claude --resume id-1");
  });

  it("returns pi resume command for pi type", () => {
    const cmd = getResumeCommand("pi", "/path/to/session");
    expect(cmd).toContain("pi --session /path/to/session");
  });

  it("returns codex resume command for codex type", () => {
    const cmd = getResumeCommand("codex", "id-2");
    expect(cmd).toContain("codex resume id-2");
  });

  it("returns null for terminal type", () => {
    expect(getResumeCommand("terminal", "anything")).toBeNull();
  });
});

describe("getFreshLaunchCommand", () => {
  it("returns claude command for claude type", () => {
    expect(getFreshLaunchCommand("claude")).toBe("claude --dangerously-skip-permissions");
  });

  it("returns pi command for pi type", () => {
    expect(getFreshLaunchCommand("pi")).toBe("pi");
  });

  it("returns codex command for codex type", () => {
    expect(getFreshLaunchCommand("codex")).toBe("codex");
  });

  it("returns null for terminal type", () => {
    expect(getFreshLaunchCommand("terminal")).toBeNull();
  });
});

describe("getLaunchInfo", () => {
  it("returns null command and null agentSessionId for terminal", () => {
    const info = getLaunchInfo("terminal", "/tmp", null);
    expect(info.command).toBeNull();
    expect(info.agentSessionId).toBeNull();
  });

  it("generates a new session ID for fresh claude launch", () => {
    const info = getLaunchInfo("claude", "/tmp", null);
    expect(info.command).toContain("claude --session-id");
    expect(info.agentSessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(info.command).toContain(info.agentSessionId!);
  });

  it("generates a new session path for fresh pi launch", () => {
    const info = getLaunchInfo("pi", "/home/user/project", null);
    expect(info.command).toContain("pi --session");
    expect(info.agentSessionId).toContain(".jsonl");
    expect(info.command).toContain(info.agentSessionId!);
  });

  it("returns fresh launch for codex (no session ID)", () => {
    const info = getLaunchInfo("codex", "/tmp", null);
    expect(info.command).toBe("codex");
    expect(info.agentSessionId).toBeNull();
  });

  it("passes the initial prompt to fresh codex launches", () => {
    const info = getLaunchInfo("codex", "/tmp", null, "Investigate failing tests");
    expect(info.command).toContain('codex "$(cat ');
    expect(info.promptFile).toContain("/tmp/devbench-prompt-");
    expect(info.agentSessionId).toBeNull();
  });

  it("uses resume command when existingSessionId is provided for claude", () => {
    const info = getLaunchInfo("claude", "/tmp", "existing-id");
    expect(info.command).toContain("claude --resume existing-id");
    expect(info.agentSessionId).toBe("existing-id");
  });

  it("uses resume command when existingSessionId is provided for pi", () => {
    const info = getLaunchInfo("pi", "/tmp", "/path/to/session.jsonl");
    expect(info.command).toContain("pi --session /path/to/session.jsonl");
    expect(info.agentSessionId).toBe("/path/to/session.jsonl");
  });

  it("uses resume command when existingSessionId is provided for codex", () => {
    const info = getLaunchInfo("codex", "/tmp", "codex-session-id");
    expect(info.command).toContain("codex resume codex-session-id");
    expect(info.agentSessionId).toBe("codex-session-id");
  });
});
