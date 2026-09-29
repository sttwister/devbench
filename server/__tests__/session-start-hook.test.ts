import { describe, it, expect, beforeEach, vi } from "vitest";


vi.mock("../tmux-utils.ts", () => ({
  capturePane: () => "mock content",
  tmuxSessionExists: () => true,
  paneDimensions: () => "200x50",
}));

import { handleHookSessionStart } from "../monitor-manager.ts";
import * as db from "../db.ts";

describe("handleHookSessionStart", () => {
  let sessionId: number;

  beforeEach(() => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = db.addProject(
      `proj-${suffix}`,
      `/tmp/proj-${suffix}`
    );
    const session = db.addSession(
      project.id,
      "codex-session",
      "codex",
      `devbench_${Date.now()}_${Math.random()}`
    );
    sessionId = session.id;
  });

  it("persists a fresh codex thread id on session start", () => {
    expect(db.getSession(sessionId)!.agent_session_id).toBeNull();

    handleHookSessionStart(sessionId, "thread-123");

    expect(db.getSession(sessionId)!.agent_session_id).toBe("thread-123");
  });

  it("replaces a stale stored thread id when codex reports a new one", () => {
    db.updateSessionAgentId(sessionId, "old-thread");

    handleHookSessionStart(sessionId, "new-thread");

    expect(db.getSession(sessionId)!.agent_session_id).toBe("new-thread");
  });

  it("is a no-op when the thread id is unchanged", () => {
    db.updateSessionAgentId(sessionId, "same-thread");

    handleHookSessionStart(sessionId, "same-thread");

    expect(db.getSession(sessionId)!.agent_session_id).toBe("same-thread");
  });

  it("no-ops for unknown sessions", () => {
    expect(() => handleHookSessionStart(99999, "thread-404")).not.toThrow();
  });

  it("ignores reports for non-codex sessions", () => {
    // The Codex CLI can run inside a Claude session (codex rescue plugin) and
    // inherits DEVBENCH_SESSION_ID, so its thread id must not overwrite the
    // Claude session id we chose at launch.
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = db.addProject(`proj-cl-${suffix}`, `/tmp/proj-cl-${suffix}`);
    const claude = db.addSession(
      project.id,
      "claude-session",
      "claude",
      `devbench_${Date.now()}_${Math.random()}`
    );
    db.updateSessionAgentId(claude.id, "claude-uuid");

    handleHookSessionStart(claude.id, "codex-thread-id");

    expect(db.getSession(claude.id)!.agent_session_id).toBe("claude-uuid");
  });

  it("no-ops for inactive sessions", () => {
    db.archiveSession(sessionId);

    handleHookSessionStart(sessionId, "thread-after-archive");

    expect(db.getSession(sessionId)!.agent_session_id).toBeNull();
  });
});
