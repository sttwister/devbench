import { describe, it, expect, vi, afterEach } from "vitest";
import { nameFromPrompt, stopAutoRename } from "../auto-rename.ts";

// @lat: [[tests#Hook API#Auto-Rename Hook]]

// Mock child_process to intercept the LLM call
vi.mock("child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    execFile: vi.fn((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      // Simulate Claude Haiku returning a name
      cb(null, "login-feature-impl");
    }),
  };
});

// Mock db so applyResolvedName can check the session
vi.mock("../db.ts", () => ({
  getSession: (id: number) =>
    id === 1
      ? { id: 1, name: "Claude Code 1", status: "active" }
      : null,
  renameSession: vi.fn(),
}));

// Mock agent-status (used by startAutoRename polling)
vi.mock("../agent-status.ts", () => ({
  getStatus: () => null,
}));

// Mock tmux-utils
vi.mock("../tmux-utils.ts", () => ({
  capturePane: () => "",
  tmuxSessionExists: () => true,
}));

describe("nameFromPrompt", () => {
  afterEach(() => {
    stopAutoRename(1);
  });

  it("skips prompts shorter than 10 characters", async () => {
    const onRenamed = vi.fn();
    nameFromPrompt(1, "hi", "Claude Code 1", onRenamed);

    // Wait a tick for async
    await new Promise((r) => setTimeout(r, 50));
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it("calls generateNameAsync for valid prompts", async () => {
    const onRenamed = vi.fn();
    nameFromPrompt(1, "Implement the login feature with OAuth integration", "Claude Code 1", onRenamed);

    // Wait for the async LLM call to complete
    await new Promise((r) => setTimeout(r, 100));

    // The mock returns "login-feature-impl" and db.renameSession is mocked
    const db = await import("../db.ts");
    expect(db.renameSession).toHaveBeenCalled();
  });
});
