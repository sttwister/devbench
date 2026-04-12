// @lat: [[tests#Monitoring#Auto-Rename Content Analysis]]
import { describe, it, expect, vi } from "vitest";

// Mock side-effect-heavy dependencies before importing
vi.mock("../db.ts", () => ({}));
vi.mock("../tmux-utils.ts", () => ({
  capturePane: () => "",
  tmuxSessionExists: () => false,
}));

import { stripped, contentDifference, normalizeContentForNaming } from "../auto-rename.ts";

describe("stripped", () => {
  it("removes all whitespace", () => {
    expect(stripped("hello world")).toBe("helloworld");
  });

  it("removes newlines and tabs", () => {
    expect(stripped("line1\n\tline2\n  line3")).toBe("line1line2line3");
  });

  it("handles empty string", () => {
    expect(stripped("")).toBe("");
  });

  it("handles string that is only whitespace", () => {
    expect(stripped("   \n\t\n  ")).toBe("");
  });

  it("returns same string when no whitespace", () => {
    expect(stripped("abc123")).toBe("abc123");
  });
});

describe("contentDifference", () => {
  it("returns 0 for identical strings", () => {
    expect(contentDifference("hello", "hello")).toBe(0);
  });

  it("returns 0 for two empty strings", () => {
    expect(contentDifference("", "")).toBe(0);
  });

  it("returns length difference when one is empty", () => {
    expect(contentDifference("hello", "")).toBe(5);
    expect(contentDifference("", "hello")).toBe(5);
  });

  it("counts character-level differences for same-length strings", () => {
    // "abc" vs "axc" → 1 diff at position 1
    expect(contentDifference("abc", "axc")).toBe(1);
  });

  it("counts all diffs for completely different same-length strings", () => {
    expect(contentDifference("abc", "xyz")).toBe(3);
  });

  it("handles different length strings", () => {
    // "abcde" vs "abc" → 2 chars difference in length + 0 char differences in overlap
    expect(contentDifference("abcde", "abc")).toBe(2);
  });

  it("combines length difference and character differences", () => {
    // "abcde" vs "axc" → length diff 2 + 1 char diff at position 1 = 3
    expect(contentDifference("abcde", "axc")).toBe(3);
  });

  it("is symmetric", () => {
    expect(contentDifference("abc", "abcdef")).toBe(
      contentDifference("abcdef", "abc")
    );
  });
});

describe("normalizeContentForNaming", () => {
  it("removes startup boilerplate and keeps the actual task line", () => {
    const raw = [
      "~/.claude/skills/init-tasks/SKILL.md",
      "[Skill conflicts]",
      "Update Available",
      "❯ ui issue on mobile sidebar. buttons to the right",
      "plan mode on (shift+tab to cycle)",
    ].join("\n");

    expect(normalizeContentForNaming(raw)).toBe(
      "ui issue on mobile sidebar. buttons to the right"
    );
  });

  it("drops Pi / Anthropic boot noise", () => {
    const raw = [
      "cc-patch: prompt sanitization active",
      "Warning: Anthropic subscription auth is active. Third-party",
      "usage now draws from extra usage and is billed per token,",
      "not your Claude plan limits. Manage extra usage at",
      "https://claude.ai/settings/usage.",
      "Fix the login page",
    ].join("\n");

    expect(normalizeContentForNaming(raw)).toBe("Fix the login page");
  });

  it("drops Claude chrome lines", () => {
    const raw = [
      "claude --session-id abc --dangerously-skip-permissions",
      "▐▛███▜▌   Claude Code v2.1.87",
      "▝▜█████▛▘  Opus 4.6 (1M context) · Claude Max",
      "❯ fix the auto naming logic",
    ].join("\n");

    expect(normalizeContentForNaming(raw)).toBe("fix the auto naming logic");
  });
});
