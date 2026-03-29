import { describe, it, expect } from "vitest";
import { DEFAULT_NAME_RE } from "../monitor-manager.ts";

describe("DEFAULT_NAME_RE", () => {
  it("matches default terminal names", () => {
    expect(DEFAULT_NAME_RE.test("Terminal 1")).toBe(true);
    expect(DEFAULT_NAME_RE.test("Terminal 42")).toBe(true);
  });

  it("matches default Claude Code names", () => {
    expect(DEFAULT_NAME_RE.test("Claude Code 1")).toBe(true);
    expect(DEFAULT_NAME_RE.test("Claude Code 99")).toBe(true);
  });

  it("matches default Pi names", () => {
    expect(DEFAULT_NAME_RE.test("Pi 1")).toBe(true);
    expect(DEFAULT_NAME_RE.test("Pi 10")).toBe(true);
  });

  it("matches default Codex names", () => {
    expect(DEFAULT_NAME_RE.test("Codex 1")).toBe(true);
    expect(DEFAULT_NAME_RE.test("Codex 5")).toBe(true);
  });

  it("does NOT match custom names", () => {
    expect(DEFAULT_NAME_RE.test("fix-auth-bug")).toBe(false);
    expect(DEFAULT_NAME_RE.test("my-terminal")).toBe(false);
    expect(DEFAULT_NAME_RE.test("Claude")).toBe(false);
    expect(DEFAULT_NAME_RE.test("Terminal")).toBe(false);
  });

  it("does NOT match names with extra text", () => {
    expect(DEFAULT_NAME_RE.test("Terminal 1 extra")).toBe(false);
    expect(DEFAULT_NAME_RE.test("prefix Terminal 1")).toBe(false);
  });
});
