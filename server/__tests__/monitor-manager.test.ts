import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock all side-effect-heavy dependencies
vi.mock("../agent-status.ts", () => ({
  startMonitoring: vi.fn(),
  stopMonitoring: vi.fn(),
}));
vi.mock("../auto-rename.ts", () => ({
  startAutoRename: vi.fn(),
  tryRenameNow: vi.fn(),
  stopAutoRename: vi.fn(),
}));
vi.mock("../mr-links.ts", () => ({
  startMonitoring: vi.fn(),
  stopMonitoring: vi.fn(),
}));
vi.mock("../terminal.ts", () => ({
  broadcastControl: vi.fn(),
  tmuxSessionExists: vi.fn(),
  destroyTmuxSession: vi.fn(),
}));
vi.mock("../db.ts", () => ({
  updateSessionMrUrls: vi.fn(),
}));

import {
  isOrphaned,
  markOrphaned,
  clearOrphaned,
  getOrphanedIds,
  DEFAULT_NAME_RE,
} from "../monitor-manager.ts";

describe("orphaned session tracking", () => {
  beforeEach(() => {
    // Clear all orphaned state between tests
    for (const id of getOrphanedIds()) {
      clearOrphaned(id);
    }
  });

  it("isOrphaned returns false for unknown session", () => {
    expect(isOrphaned(999)).toBe(false);
  });

  it("markOrphaned + isOrphaned", () => {
    markOrphaned(42);
    expect(isOrphaned(42)).toBe(true);
  });

  it("clearOrphaned removes session from set", () => {
    markOrphaned(42);
    clearOrphaned(42);
    expect(isOrphaned(42)).toBe(false);
  });

  it("getOrphanedIds returns all orphaned IDs", () => {
    markOrphaned(1);
    markOrphaned(2);
    markOrphaned(3);
    const ids = getOrphanedIds();
    expect(ids).toHaveLength(3);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
  });

  it("marking same ID twice is idempotent", () => {
    markOrphaned(5);
    markOrphaned(5);
    expect(getOrphanedIds().filter((id) => id === 5)).toHaveLength(1);
  });

  it("clearOrphaned on non-existent ID is a no-op", () => {
    clearOrphaned(999);
    expect(isOrphaned(999)).toBe(false);
  });
});

describe("DEFAULT_NAME_RE", () => {
  it("matches default Terminal names", () => {
    expect(DEFAULT_NAME_RE.test("Terminal 1")).toBe(true);
    expect(DEFAULT_NAME_RE.test("Terminal 42")).toBe(true);
  });

  it("matches default Claude Code names", () => {
    expect(DEFAULT_NAME_RE.test("Claude Code 1")).toBe(true);
    expect(DEFAULT_NAME_RE.test("Claude Code 99")).toBe(true);
  });

  it("matches default Pi names", () => {
    expect(DEFAULT_NAME_RE.test("Pi 1")).toBe(true);
    expect(DEFAULT_NAME_RE.test("Pi 5")).toBe(true);
  });

  it("matches default Codex names", () => {
    expect(DEFAULT_NAME_RE.test("Codex 1")).toBe(true);
    expect(DEFAULT_NAME_RE.test("Codex 10")).toBe(true);
  });

  it("does NOT match custom/renamed session names", () => {
    expect(DEFAULT_NAME_RE.test("my-feature-branch")).toBe(false);
    expect(DEFAULT_NAME_RE.test("fix-login-bug")).toBe(false);
    expect(DEFAULT_NAME_RE.test("refactor-api")).toBe(false);
  });

  it("does NOT match names without a number", () => {
    expect(DEFAULT_NAME_RE.test("Terminal")).toBe(false);
    expect(DEFAULT_NAME_RE.test("Claude Code")).toBe(false);
  });

  it("does NOT match names with extra text", () => {
    expect(DEFAULT_NAME_RE.test("Terminal 1 extra")).toBe(false);
    expect(DEFAULT_NAME_RE.test("prefix Terminal 1")).toBe(false);
  });
});
