// @lat: [[tests#Client#Diff Parser]]
import { describe, it, expect } from "vitest";
import { parseHunkLines } from "../components/DiffViewer";
import type { DiffHunk } from "@devbench/shared";

describe("parseHunkLines", () => {
  it("parses a simple hunk with additions and context", () => {
    const hunk: DiffHunk = {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 2,
      diff: "@@ -1,1 +1,2 @@\n hello\n+world\n",
    };
    const lines = parseHunkLines(hunk);
    expect(lines[0]).toEqual({ type: "hunk-header", content: "@@ -1,1 +1,2 @@", oldLineNo: null, newLineNo: null });
    expect(lines[1]).toEqual({ type: "context", content: "hello", oldLineNo: 1, newLineNo: 1 });
    expect(lines[2]).toEqual({ type: "add", content: "world", oldLineNo: null, newLineNo: 2 });
  });

  it("parses deletions", () => {
    const hunk: DiffHunk = {
      oldStart: 5,
      oldLines: 3,
      newStart: 5,
      newLines: 1,
      diff: "@@ -5,3 +5,1 @@\n context\n-removed1\n-removed2\n",
    };
    const lines = parseHunkLines(hunk);
    expect(lines).toHaveLength(4); // header + context + 2 dels
    expect(lines[1]).toEqual({ type: "context", content: "context", oldLineNo: 5, newLineNo: 5 });
    expect(lines[2]).toEqual({ type: "del", content: "removed1", oldLineNo: 6, newLineNo: null });
    expect(lines[3]).toEqual({ type: "del", content: "removed2", oldLineNo: 7, newLineNo: null });
  });

  it("parses mixed additions and deletions (modification)", () => {
    const hunk: DiffHunk = {
      oldStart: 10,
      oldLines: 2,
      newStart: 10,
      newLines: 2,
      diff: "@@ -10,2 +10,2 @@\n-old line\n+new line\n context\n",
    };
    const lines = parseHunkLines(hunk);
    expect(lines[1]).toEqual({ type: "del", content: "old line", oldLineNo: 10, newLineNo: null });
    expect(lines[2]).toEqual({ type: "add", content: "new line", oldLineNo: null, newLineNo: 10 });
    expect(lines[3]).toEqual({ type: "context", content: "context", oldLineNo: 11, newLineNo: 11 });
  });

  it("handles no newline at end of file marker", () => {
    const hunk: DiffHunk = {
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      diff: "@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n",
    };
    const lines = parseHunkLines(hunk);
    const noNewline = lines.find(l => l.content === "\\ No newline at end of file");
    expect(noNewline).toBeDefined();
    expect(noNewline!.type).toBe("context");
  });

  it("handles empty hunk diff string", () => {
    const hunk: DiffHunk = {
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 0,
      diff: "",
    };
    const lines = parseHunkLines(hunk);
    expect(lines).toEqual([]);
  });
});
