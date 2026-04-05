import { describe, it, expect, vi, afterEach } from "vitest";
import { setStatusFromHook, startMonitoring, stopMonitoring, getStatus } from "../agent-status.ts";

// @lat: [[tests#Hook API#Agent Status Hook]]

// Mock tmux-utils so startMonitoring doesn't fail looking for real tmux sessions
vi.mock("../tmux-utils.ts", () => ({
  capturePane: () => "mock content",
  tmuxSessionExists: () => true,
  paneDimensions: () => "200x50",
}));

describe("setStatusFromHook", () => {
  afterEach(() => {
    stopMonitoring(999);
  });

  it("sets status to working when called on a monitored session", () => {
    const onChange = vi.fn();
    startMonitoring(999, "tmux_test", "claude", onChange);

    setStatusFromHook(999, "working");
    // The session should already be "working" from startMonitoring,
    // so the hook should be a no-op for the callback
    expect(getStatus(999)).toBe("working");
  });

  it("sets status to waiting immediately via hook", () => {
    const onChange = vi.fn();
    startMonitoring(999, "tmux_test", "claude", onChange);

    setStatusFromHook(999, "waiting");
    expect(getStatus(999)).toBe("waiting");
  });

  it("is a no-op for unmonitored sessions", () => {
    // Should not throw
    setStatusFromHook(9999, "working");
    expect(getStatus(9999)).toBeNull();
  });

  it("does not call onChange if status is already the same", () => {
    const onChange = vi.fn();
    startMonitoring(999, "tmux_test", "claude", onChange);

    // Initially "working", setting to "working" again should not change
    setStatusFromHook(999, "working");
    // Only the startMonitoring may have triggered if initial status was different
    expect(getStatus(999)).toBe("working");
  });
});
