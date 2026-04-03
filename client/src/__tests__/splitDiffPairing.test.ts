// @lat: [[tests#Client#Split Diff Pairing]]
import { describe, it, expect } from "vitest";
import { parseHunkLines, pairLinesForSplit } from "../components/DiffViewer";
import type { DiffHunk } from "@devbench/shared";

describe("pairLinesForSplit", () => {
  it("pairs context lines on both sides", () => {
    const hunk: DiffHunk = {
      oldStart: 1, oldLines: 2, newStart: 1, newLines: 2,
      diff: "@@ -1,2 +1,2 @@\n hello\n world\n",
    };
    const lines = parseHunkLines(hunk);
    const rows = pairLinesForSplit(lines);
    // hunk-header + 2 context lines
    expect(rows).toHaveLength(3);
    expect(rows[0].left?.type).toBe("hunk-header");
    expect(rows[0].right?.type).toBe("hunk-header");
    expect(rows[1].left?.content).toBe("hello");
    expect(rows[1].right?.content).toBe("hello");
    expect(rows[2].left?.content).toBe("world");
    expect(rows[2].right?.content).toBe("world");
  });

  it("pairs consecutive del/add as modifications side-by-side", () => {
    const hunk: DiffHunk = {
      oldStart: 1, oldLines: 2, newStart: 1, newLines: 2,
      diff: "@@ -1,2 +1,2 @@\n-old line 1\n-old line 2\n+new line 1\n+new line 2\n",
    };
    const lines = parseHunkLines(hunk);
    const rows = pairLinesForSplit(lines);
    // hunk-header + 2 paired rows
    expect(rows).toHaveLength(3);
    expect(rows[1].left?.content).toBe("old line 1");
    expect(rows[1].right?.content).toBe("new line 1");
    expect(rows[2].left?.content).toBe("old line 2");
    expect(rows[2].right?.content).toBe("new line 2");
  });

  it("handles more deletions than additions", () => {
    const hunk: DiffHunk = {
      oldStart: 1, oldLines: 3, newStart: 1, newLines: 1,
      diff: "@@ -1,3 +1,1 @@\n-a\n-b\n-c\n+x\n",
    };
    const lines = parseHunkLines(hunk);
    const rows = pairLinesForSplit(lines);
    // hunk-header + 3 rows (c has no right match)
    expect(rows).toHaveLength(4);
    expect(rows[1].left?.content).toBe("a");
    expect(rows[1].right?.content).toBe("x");
    expect(rows[2].left?.content).toBe("b");
    expect(rows[2].right).toBeNull();
    expect(rows[3].left?.content).toBe("c");
    expect(rows[3].right).toBeNull();
  });

  it("handles more additions than deletions", () => {
    const hunk: DiffHunk = {
      oldStart: 1, oldLines: 1, newStart: 1, newLines: 3,
      diff: "@@ -1,1 +1,3 @@\n-a\n+x\n+y\n+z\n",
    };
    const lines = parseHunkLines(hunk);
    const rows = pairLinesForSplit(lines);
    // hunk-header + 3 rows
    expect(rows).toHaveLength(4);
    expect(rows[1].left?.content).toBe("a");
    expect(rows[1].right?.content).toBe("x");
    expect(rows[2].left).toBeNull();
    expect(rows[2].right?.content).toBe("y");
    expect(rows[3].left).toBeNull();
    expect(rows[3].right?.content).toBe("z");
  });

  it("handles standalone additions (no preceding deletion)", () => {
    const hunk: DiffHunk = {
      oldStart: 1, oldLines: 1, newStart: 1, newLines: 3,
      diff: "@@ -1,1 +1,3 @@\n context\n+added1\n+added2\n",
    };
    const lines = parseHunkLines(hunk);
    const rows = pairLinesForSplit(lines);
    // hunk-header + context + 2 additions
    expect(rows).toHaveLength(4);
    expect(rows[1].left?.content).toBe("context");
    expect(rows[1].right?.content).toBe("context");
    expect(rows[2].left).toBeNull();
    expect(rows[2].right?.content).toBe("added1");
    expect(rows[3].left).toBeNull();
    expect(rows[3].right?.content).toBe("added2");
  });

  it("handles standalone deletions", () => {
    const hunk: DiffHunk = {
      oldStart: 1, oldLines: 3, newStart: 1, newLines: 1,
      diff: "@@ -1,3 +1,1 @@\n context\n-removed1\n-removed2\n",
    };
    const lines = parseHunkLines(hunk);
    const rows = pairLinesForSplit(lines);
    // hunk-header + context + 2 deletions (no adds follow)
    expect(rows).toHaveLength(4);
    expect(rows[1].left?.content).toBe("context");
    expect(rows[1].right?.content).toBe("context");
    expect(rows[2].left?.content).toBe("removed1");
    expect(rows[2].right).toBeNull();
    expect(rows[3].left?.content).toBe("removed2");
    expect(rows[3].right).toBeNull();
  });

  it("handles empty hunk", () => {
    const hunk: DiffHunk = {
      oldStart: 1, oldLines: 0, newStart: 1, newLines: 0,
      diff: "",
    };
    const lines = parseHunkLines(hunk);
    const rows = pairLinesForSplit(lines);
    expect(rows).toHaveLength(0);
  });

  it("handles mixed context, modifications, and standalone additions", () => {
    const hunk: DiffHunk = {
      oldStart: 1, oldLines: 4, newStart: 1, newLines: 5,
      diff: "@@ -1,4 +1,5 @@\n ctx1\n-old\n+new\n ctx2\n+added\n ctx3\n",
    };
    const lines = parseHunkLines(hunk);
    const rows = pairLinesForSplit(lines);
    // hunk-header + ctx1 + mod(old→new) + ctx2 + added + ctx3
    expect(rows).toHaveLength(6);
    expect(rows[1].left?.content).toBe("ctx1");
    expect(rows[2].left?.content).toBe("old");
    expect(rows[2].right?.content).toBe("new");
    expect(rows[3].left?.content).toBe("ctx2");
    expect(rows[3].right?.content).toBe("ctx2");
    expect(rows[4].left).toBeNull();
    expect(rows[4].right?.content).toBe("added");
    expect(rows[5].left?.content).toBe("ctx3");
    expect(rows[5].right?.content).toBe("ctx3");
  });
});
