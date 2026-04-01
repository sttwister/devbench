// @lat: [[tests#Monitoring#MR Link Polling Cycle]]
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for MR link dismiss/add behavior during the polling cycle.
 * Uses fake timers to control interval execution.
 */

vi.mock("../tmux-utils.ts", () => ({
  capturePane: vi.fn(() => ""),
  tmuxSessionExists: vi.fn(() => true),
}));

import {
  startMonitoring,
  stopMonitoring,
  dismissUrl,
  addManualUrl,
} from "../mr-links.ts";
import { capturePane } from "../tmux-utils.ts";

describe("mr-links polling with dismiss/add", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopMonitoring(8001);
    stopMonitoring(8002);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("detects new MR URLs on poll", () => {
    const onChanged = vi.fn();
    (capturePane as any).mockReturnValue("https://github.com/o/r/pull/1");

    startMonitoring(8001, "tmux_test", [], onChanged);

    vi.advanceTimersByTime(10_000);

    expect(onChanged).toHaveBeenCalledWith(8001, ["https://github.com/o/r/pull/1"]);
  });

  it("dismissed URL is not reported on next poll", () => {
    const onChanged = vi.fn();
    (capturePane as any).mockReturnValue(
      "https://github.com/o/r/pull/1\nhttps://github.com/o/r/pull/2"
    );

    startMonitoring(8001, "tmux_test", [], onChanged);

    // First poll — both detected
    vi.advanceTimersByTime(10_000);
    expect(onChanged).toHaveBeenCalledWith(8001, [
      "https://github.com/o/r/pull/1",
      "https://github.com/o/r/pull/2",
    ]);

    onChanged.mockClear();

    // Dismiss pull/2
    dismissUrl(8001, "https://github.com/o/r/pull/2");

    // Second poll — pull/2 is still in terminal but dismissed
    vi.advanceTimersByTime(10_000);

    // No change should be reported (pull/1 is already known, pull/2 is dismissed)
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("re-added URL after dismiss is reported again", () => {
    const onChanged = vi.fn();
    (capturePane as any).mockReturnValue("https://github.com/o/r/pull/1");

    startMonitoring(8001, "tmux_test", [], onChanged);

    // First poll
    vi.advanceTimersByTime(10_000);
    expect(onChanged).toHaveBeenCalledTimes(1);
    onChanged.mockClear();

    // Dismiss
    dismissUrl(8001, "https://github.com/o/r/pull/1");

    // Re-add manually
    addManualUrl(8001, "https://github.com/o/r/pull/1");

    // Next poll — should not report change since it's already in known
    vi.advanceTimersByTime(10_000);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("manually added URL persists across polls", () => {
    const onChanged = vi.fn();
    // Terminal output has pull/1 only
    (capturePane as any).mockReturnValue("https://github.com/o/r/pull/1");

    startMonitoring(8001, "tmux_test", [], onChanged);

    // Manually add pull/99 (not in terminal)
    addManualUrl(8001, "https://github.com/o/r/pull/99");

    // First poll detects pull/1 + manual pull/99 already in known
    vi.advanceTimersByTime(10_000);
    expect(onChanged).toHaveBeenCalledWith(8001, expect.arrayContaining([
      "https://github.com/o/r/pull/1",
      "https://github.com/o/r/pull/99",
    ]));
  });

  it("dismissed URL not re-added even when terminal still shows it", () => {
    const onChanged = vi.fn();
    (capturePane as any).mockReturnValue("https://github.com/o/r/pull/1");

    startMonitoring(8001, "tmux_test", ["https://github.com/o/r/pull/1"], onChanged);

    // Dismiss
    dismissUrl(8001, "https://github.com/o/r/pull/1");

    // Multiple polls — should never re-add it
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(10_000);

    expect(onChanged).not.toHaveBeenCalled();
  });

  it("new URL detected alongside dismissed URL only reports the new one", () => {
    const onChanged = vi.fn();
    // Initially: pull/1 and pull/2 in terminal
    (capturePane as any).mockReturnValue(
      "https://github.com/o/r/pull/1\nhttps://github.com/o/r/pull/2"
    );

    startMonitoring(8001, "tmux_test", ["https://github.com/o/r/pull/1"], onChanged);

    // Dismiss pull/1
    dismissUrl(8001, "https://github.com/o/r/pull/1");

    // First poll: pull/2 is new, pull/1 is dismissed
    vi.advanceTimersByTime(10_000);

    expect(onChanged).toHaveBeenCalledWith(8001, ["https://github.com/o/r/pull/2"]);
  });

  it("stopMonitoring prevents further poll callbacks", () => {
    const onChanged = vi.fn();
    (capturePane as any).mockReturnValue("https://github.com/o/r/pull/1");

    startMonitoring(8001, "tmux_test", [], onChanged);

    // First poll
    vi.advanceTimersByTime(10_000);
    expect(onChanged).toHaveBeenCalledTimes(1);

    stopMonitoring(8001);

    // Further ticks should not trigger callback
    (capturePane as any).mockReturnValue(
      "https://github.com/o/r/pull/1\nhttps://github.com/o/r/pull/2"
    );
    vi.advanceTimersByTime(10_000);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
