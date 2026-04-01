// @lat: [[tests#Monitoring#Agent Status Detection]]
import { describe, it, expect } from "vitest";
import { hashContent, INPUT_AREA_LINES } from "../agent-status.ts";

describe("INPUT_AREA_LINES", () => {
  it("is a positive number", () => {
    expect(INPUT_AREA_LINES).toBeGreaterThan(0);
  });
});

describe("hashContent", () => {
  it("returns same hash for identical content", () => {
    const content = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";
    expect(hashContent(content)).toBe(hashContent(content));
  });

  it("returns different hash for different content", () => {
    const a = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";
    const b = "changed\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";
    expect(hashContent(a)).not.toBe(hashContent(b));
  });

  it("ignores bottom INPUT_AREA_LINES lines (input area)", () => {
    // Two contents that differ ONLY in the bottom INPUT_AREA_LINES lines
    const upper = "output1\noutput2\noutput3\noutput4\noutput5\noutput6\noutput7\noutput8";
    const inputA = Array.from({ length: INPUT_AREA_LINES }, (_, i) => `inputA-${i}`).join("\n");
    const inputB = Array.from({ length: INPUT_AREA_LINES }, (_, i) => `inputB-${i}`).join("\n");
    expect(hashContent(`${upper}\n${inputA}`)).toBe(hashContent(`${upper}\n${inputB}`));
  });

  it("detects changes in the upper area", () => {
    const inputLines = Array.from({ length: INPUT_AREA_LINES }, (_, i) => `input-${i}`).join("\n");
    const a = `output-A\nline2\nline3\nline4\nline5\nline6\nline7\nline8\n${inputLines}`;
    const b = `output-B\nline2\nline3\nline4\nline5\nline6\nline7\nline8\n${inputLines}`;
    expect(hashContent(a)).not.toBe(hashContent(b));
  });

  it("normalizes trailing whitespace on lines", () => {
    const a = "line1   \nline2\t\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";
    const b = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";
    expect(hashContent(a)).toBe(hashContent(b));
  });

  it("returns a number", () => {
    expect(typeof hashContent("some content")).toBe("number");
  });

  it("handles empty content", () => {
    expect(typeof hashContent("")).toBe("number");
  });

  it("keeps at least 1 line even when content is very short", () => {
    // Even with fewer lines than INPUT_AREA_LINES, it should still hash something
    const result = hashContent("just one line");
    expect(typeof result).toBe("number");
  });
});
