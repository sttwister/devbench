import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// @lat: [[tests#Hook API#Working Recovery Hook]]

// Mock tmux-utils so startMonitoring doesn't fail looking for real tmux sessions
vi.mock("../tmux-utils.ts", () => ({
  capturePane: () => "mock content",
  tmuxSessionExists: () => true,
  paneDimensions: () => "200x50",
}));

import { handleHookWorking } from "../monitor-manager.ts";
import {
  startMonitoring,
  stopMonitoring,
  getStatus,
  setStatusFromHook,
} from "../agent-status.ts";
import * as db from "../db.ts";

describe("handleHookWorking", () => {
  let sessionId: number;

  beforeEach(() => {
    const project = db.addProject(
      `proj-${Date.now()}-${Math.random()}`,
      `/tmp/proj-${Date.now()}`
    );
    const session = db.addSession(
      project.id,
      "plan-session",
      "claude",
      `devbench_${Date.now()}_${Math.random()}`
    );
    sessionId = session.id;
  });

  afterEach(() => {
    stopMonitoring(sessionId);
  });

  it("transitions a waiting session back to working", () => {
    const onChange = vi.fn();
    startMonitoring(sessionId, "tmux_test", "claude", onChange);

    // Simulate the prior Notification hook having set status to waiting
    // (e.g. plan presented via ExitPlanMode)
    setStatusFromHook(sessionId, "waiting");
    expect(getStatus(sessionId)).toBe("waiting");
    onChange.mockClear();

    // User types a plan refinement → Claude's first PreToolUse fires
    handleHookWorking(sessionId);

    expect(getStatus(sessionId)).toBe("working");
    expect(onChange).toHaveBeenCalledWith(sessionId, "working");
  });

  it("is idempotent when already working (no duplicate onChange)", () => {
    const onChange = vi.fn();
    startMonitoring(sessionId, "tmux_test", "claude", onChange);
    // startMonitoring initializes in "working" state for fresh sessions
    expect(getStatus(sessionId)).toBe("working");
    onChange.mockClear();

    handleHookWorking(sessionId);
    handleHookWorking(sessionId);
    handleHookWorking(sessionId);

    expect(getStatus(sessionId)).toBe("working");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("no-op for unknown session id", () => {
    // Does not throw, does not touch any monitor state
    expect(() => handleHookWorking(99999)).not.toThrow();
    expect(getStatus(99999)).toBeNull();
  });

  it("no-op for inactive (archived) session", () => {
    const onChange = vi.fn();
    startMonitoring(sessionId, "tmux_test", "claude", onChange);
    setStatusFromHook(sessionId, "waiting");
    onChange.mockClear();

    db.archiveSession(sessionId);

    handleHookWorking(sessionId);

    // Status should NOT have flipped — handler early-returns on non-active sessions
    expect(getStatus(sessionId)).toBe("waiting");
    expect(onChange).not.toHaveBeenCalled();
  });
});
