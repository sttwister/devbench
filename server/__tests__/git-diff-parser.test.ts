// @lat: [[tests#GitButler#Git Diff Parser]]
import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "../gitbutler.ts";

describe("parseUnifiedDiff", () => {
  it("parses a modified file with one hunk", () => {
    const raw = `diff --git a/file.txt b/file.txt
index abc1234..def5678 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line one
-old line
+new line
+added line
 line three
`;
    const result = parseUnifiedDiff(raw);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].path).toBe("file.txt");
    expect(result.changes[0].status).toBe("modified");
    expect(result.changes[0].diff.type).toBe("patch");
    expect(result.changes[0].diff.hunks).toHaveLength(1);

    const hunk = result.changes[0].diff.hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(3);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(4);
    expect(hunk.diff).toContain("@@");
    expect(hunk.diff).toContain("-old line");
    expect(hunk.diff).toContain("+new line");
    expect(hunk.diff).toContain("+added line");
  });

  it("detects added files", () => {
    const raw = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+line one
+line two
+line three
`;
    const result = parseUnifiedDiff(raw);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].status).toBe("added");
    expect(result.changes[0].path).toBe("new.ts");
    expect(result.changes[0].diff.hunks).toHaveLength(1);
    expect(result.changes[0].diff.hunks[0].newLines).toBe(3);
  });

  it("detects deleted files", () => {
    const raw = `diff --git a/old.ts b/old.ts
deleted file mode 100644
index abc1234..0000000
--- a/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line one
-line two
`;
    const result = parseUnifiedDiff(raw);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].status).toBe("deleted");
    expect(result.changes[0].path).toBe("old.ts");
  });

  it("detects binary files", () => {
    const raw = `diff --git a/image.png b/image.png
index abc1234..def5678 100644
Binary files a/image.png and b/image.png differ
`;
    const result = parseUnifiedDiff(raw);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].path).toBe("image.png");
    expect(result.changes[0].diff.type).toBe("binary");
    expect(result.changes[0].diff.hunks).toEqual([]);
  });

  it("parses multiple files", () => {
    const raw = `diff --git a/a.txt b/a.txt
index 1234..5678 100644
--- a/a.txt
+++ b/a.txt
@@ -1,1 +1,2 @@
 hello
+world
diff --git a/b.txt b/b.txt
new file mode 100644
index 0000..1234
--- /dev/null
+++ b/b.txt
@@ -0,0 +1,1 @@
+new content
`;
    const result = parseUnifiedDiff(raw);
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0].path).toBe("a.txt");
    expect(result.changes[0].status).toBe("modified");
    expect(result.changes[1].path).toBe("b.txt");
    expect(result.changes[1].status).toBe("added");
  });

  it("parses multiple hunks in one file", () => {
    const raw = `diff --git a/big.ts b/big.ts
index 1234..5678 100644
--- a/big.ts
+++ b/big.ts
@@ -1,3 +1,4 @@
 first
+inserted
 second
 third
@@ -20,3 +21,2 @@
 twenty
-removed
 twenty-two
`;
    const result = parseUnifiedDiff(raw);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].diff.hunks).toHaveLength(2);
    expect(result.changes[0].diff.hunks[0].oldStart).toBe(1);
    expect(result.changes[0].diff.hunks[1].oldStart).toBe(20);
  });

  it("returns empty changes for empty input", () => {
    const result = parseUnifiedDiff("");
    expect(result.changes).toEqual([]);
  });
});
