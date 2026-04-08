import { describe, it, expect, beforeEach, vi } from "vitest";

// @lat: [[tests#Hook API#Changes Path Scoping]]

// Mock tmux-utils so any monitor-manager imports that touch it are safe
vi.mock("../tmux-utils.ts", () => ({
  capturePane: () => "mock content",
  tmuxSessionExists: () => true,
  paneDimensions: () => "200x50",
}));

import { isPathInsideCwd, handleHookChanges } from "../monitor-manager.ts";
import * as db from "../db.ts";

describe("isPathInsideCwd", () => {
  it("returns true for a file directly inside cwd", () => {
    expect(isPathInsideCwd("/home/user/proj/src/file.ts", "/home/user/proj")).toBe(true);
  });

  it("returns true for a nested file inside cwd", () => {
    expect(isPathInsideCwd("/home/user/proj/a/b/c/file.ts", "/home/user/proj")).toBe(true);
  });

  it("returns false for a file outside cwd (sibling project)", () => {
    expect(isPathInsideCwd("/home/user/other/file.ts", "/home/user/proj")).toBe(false);
  });

  it("returns false for a file outside cwd (parent directory)", () => {
    expect(isPathInsideCwd("/home/user/file.ts", "/home/user/proj")).toBe(false);
  });

  it("returns false for Claude Code plan files in ~/.claude/plans/", () => {
    expect(
      isPathInsideCwd("/home/user/.claude/plans/my-plan.md", "/home/user/proj")
    ).toBe(false);
  });

  it("returns false for an entirely unrelated absolute path", () => {
    expect(isPathInsideCwd("/tmp/scratch.txt", "/home/user/proj")).toBe(false);
  });

  it("rejects path-traversal attempts with ..", () => {
    expect(
      isPathInsideCwd("/home/user/proj/../secret", "/home/user/proj")
    ).toBe(false);
  });

  it("normalises redundant segments inside cwd", () => {
    expect(
      isPathInsideCwd("/home/user/proj/./src/./file.ts", "/home/user/proj")
    ).toBe(true);
  });

  it("returns true when filePath is missing (backward-compat)", () => {
    expect(isPathInsideCwd(undefined, "/home/user/proj")).toBe(true);
  });

  it("returns true when cwd is missing (backward-compat)", () => {
    expect(isPathInsideCwd("/home/user/proj/file.ts", undefined)).toBe(true);
  });

  it("returns true when both are missing (backward-compat)", () => {
    expect(isPathInsideCwd(undefined, undefined)).toBe(true);
  });

  it("returns true when filePath and cwd are the same directory", () => {
    expect(isPathInsideCwd("/home/user/proj", "/home/user/proj")).toBe(true);
  });

  it("does not false-match a sibling with a shared prefix", () => {
    // "/home/user/proj2" starts with "/home/user/proj" as a string,
    // but must not be considered inside "/home/user/proj".
    expect(
      isPathInsideCwd("/home/user/proj2/file.ts", "/home/user/proj")
    ).toBe(false);
  });
});

describe("handleHookChanges", () => {
  let sessionId: number;
  let projectCwd: string;

  beforeEach(() => {
    projectCwd = `/tmp/proj-${Date.now()}-${Math.random()}`;
    const project = db.addProject(`proj-${Date.now()}-${Math.random()}`, projectCwd);
    const session = db.addSession(
      project.id,
      "test-session",
      "claude",
      `devbench_${Date.now()}_${Math.random()}`
    );
    sessionId = session.id;
  });

  it("sets has_changes for writes inside cwd", () => {
    handleHookChanges(sessionId, `${projectCwd}/src/foo.ts`, projectCwd);
    expect(db.getSession(sessionId)!.has_changes).toBe(true);
  });

  it("does NOT set has_changes for plan-mode writes in ~/.claude/plans/", () => {
    handleHookChanges(
      sessionId,
      "/home/user/.claude/plans/my-plan.md",
      projectCwd
    );
    expect(db.getSession(sessionId)!.has_changes).toBe(false);
  });

  it("does NOT set has_changes for writes in an unrelated directory", () => {
    handleHookChanges(sessionId, "/tmp/unrelated.txt", projectCwd);
    expect(db.getSession(sessionId)!.has_changes).toBe(false);
  });

  it("falls back to marking changes when filePath is omitted (legacy hook payload)", () => {
    handleHookChanges(sessionId);
    expect(db.getSession(sessionId)!.has_changes).toBe(true);
  });

  it("falls back to marking changes when cwd is omitted (legacy hook payload)", () => {
    handleHookChanges(sessionId, "/anywhere/file.ts");
    expect(db.getSession(sessionId)!.has_changes).toBe(true);
  });

  it("no-op for unknown session id", () => {
    expect(() => handleHookChanges(99999, "/tmp/x", "/tmp")).not.toThrow();
  });
});
