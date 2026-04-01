// @lat: [[tests#Sessions#Session Naming]]
import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAME_RE,
  isDefaultSessionName,
  slugifySessionWorkName,
  toFeatureBranchName,
} from "../session-naming.ts";

describe("DEFAULT_NAME_RE", () => {
  it("matches generated default names", () => {
    expect(DEFAULT_NAME_RE.test("Terminal 1")).toBe(true);
    expect(DEFAULT_NAME_RE.test("Claude Code 2")).toBe(true);
    expect(DEFAULT_NAME_RE.test("Pi 3")).toBe(true);
    expect(DEFAULT_NAME_RE.test("Codex 4")).toBe(true);
  });

  it("does not match resolved work names", () => {
    expect(DEFAULT_NAME_RE.test("mobile-sidebar-buttons")).toBe(false);
    expect(DEFAULT_NAME_RE.test("feature/mobile-sidebar-buttons")).toBe(false);
  });
});

describe("isDefaultSessionName", () => {
  it("trims surrounding whitespace", () => {
    expect(isDefaultSessionName("  Pi 7  ")).toBe(true);
  });
});

describe("slugifySessionWorkName", () => {
  it("normalizes to lowercase kebab-case", () => {
    expect(slugifySessionWorkName("Fix Mobile Sidebar")).toBe("fix-mobile-sidebar");
  });

  it("removes a leading feature prefix", () => {
    expect(slugifySessionWorkName("feature/mobile-sidebar-buttons")).toBe("mobile-sidebar-buttons");
  });
});

describe("toFeatureBranchName", () => {
  it("adds the feature prefix", () => {
    expect(toFeatureBranchName("mobile-sidebar-buttons")).toBe("feature/mobile-sidebar-buttons");
  });

  it("returns null when the name has no usable slug", () => {
    expect(toFeatureBranchName("!!!")).toBeNull();
  });
});
