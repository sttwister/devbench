// @lat: [[tests#GitButler#Git Diff Parser]]
import { describe, it, expect } from "vitest";
import { getDiff } from "../gitbutler.ts";
import path from "path";

// These tests use the actual git repo to verify the git diff fallback parser.
// They run `git diff` against real commits in this repo.

const repoPath = path.resolve(import.meta.dirname, "../..");

describe("getDiff git fallback", () => {
  it("returns changes for a known commit", async () => {
    // The initial lat.md commit added many files
    const result = await getDiff(repoPath, "9d13478");
    expect(result.changes.length).toBeGreaterThan(0);

    // Check structure of a change
    const change = result.changes[0];
    expect(change).toHaveProperty("path");
    expect(change).toHaveProperty("status");
    expect(change).toHaveProperty("diff");
    expect(change.diff).toHaveProperty("type", "patch");
    expect(change.diff).toHaveProperty("hunks");
    expect(change.diff.hunks.length).toBeGreaterThan(0);

    // Verify hunk structure
    const hunk = change.diff.hunks[0];
    expect(hunk).toHaveProperty("oldStart");
    expect(hunk).toHaveProperty("oldLines");
    expect(hunk).toHaveProperty("newStart");
    expect(hunk).toHaveProperty("newLines");
    expect(hunk).toHaveProperty("diff");
    expect(hunk.diff).toMatch(/^@@/);
  });

  it("detects added files", async () => {
    const result = await getDiff(repoPath, "9d13478");
    const added = result.changes.filter((c) => c.status === "added");
    expect(added.length).toBeGreaterThan(0);
  });

  it("returns empty changes for no-diff scenario", async () => {
    // Diff of HEAD against itself via merge-base should be empty
    const result = await getDiff(repoPath, "HEAD");
    expect(result.changes).toEqual([]);
  });
});
