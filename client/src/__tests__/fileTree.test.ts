// @lat: [[tests#Client#File Tree]]
import { describe, it, expect } from "vitest";
import { buildFileTree, getTreeSortedPaths } from "../components/DiffViewer";
import type { DiffChange } from "@devbench/shared";

/** Helper to create a minimal DiffChange for testing. */
function change(path: string, status = "modified"): DiffChange {
  return { path, status, diff: { type: "patch", hunks: [] } };
}

/** Flatten a tree to an array of { name, path?, childCount } for easier assertions. */
function flatten(entries: ReturnType<typeof buildFileTree>, depth = 0): { name: string; path?: string; depth: number; childCount: number }[] {
  const result: { name: string; path?: string; depth: number; childCount: number }[] = [];
  for (const e of entries) {
    result.push({ name: e.name, path: e.path, depth, childCount: e.children.length });
    result.push(...flatten(e.children, depth + 1));
  }
  return result;
}

describe("buildFileTree", () => {
  it("groups files under their directory", () => {
    const tree = buildFileTree([
      change("src/a.ts"),
      change("src/b.ts"),
      change("lib/c.ts"),
    ]);
    // Two top-level folders: lib, src (sorted alphabetically)
    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe("lib");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe("c.ts");
    expect(tree[1].name).toBe("src");
    expect(tree[1].children).toHaveLength(2);
    expect(tree[1].children[0].name).toBe("a.ts");
    expect(tree[1].children[1].name).toBe("b.ts");
  });

  it("collapses single-child folder chains", () => {
    const tree = buildFileTree([
      change("src/components/ui/Button.tsx"),
      change("src/components/ui/Input.tsx"),
      change("src/components/App.tsx"),
    ]);
    // src/components is collapsed into one entry
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("src/components");
    // Inside: folder "ui" + file "App.tsx"
    const children = tree[0].children;
    expect(children).toHaveLength(2);
    // folders first, then files
    expect(children[0].name).toBe("ui");
    expect(children[0].children).toHaveLength(2);
    expect(children[1].name).toBe("App.tsx");
    expect(children[1].path).toBe("src/components/App.tsx");
  });

  it("handles root-level files (no directory)", () => {
    const tree = buildFileTree([
      change("README.md"),
      change("package.json"),
    ]);
    // Files directly at root, sorted alphabetically by localeCompare
    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe("package.json");
    expect(tree[0].path).toBe("package.json");
    expect(tree[1].name).toBe("README.md");
    expect(tree[1].path).toBe("README.md");
  });

  it("mixes root files and directories, folders first", () => {
    const tree = buildFileTree([
      change("README.md"),
      change("src/index.ts"),
    ]);
    expect(tree).toHaveLength(2);
    // folder first
    expect(tree[0].name).toBe("src");
    expect(tree[0].path).toBeUndefined();
    // then file
    expect(tree[1].name).toBe("README.md");
    expect(tree[1].path).toBe("README.md");
  });

  it("handles deeply nested single-child chain collapse", () => {
    const tree = buildFileTree([
      change("a/b/c/d/file.txt"),
    ]);
    // Entire chain a/b/c/d collapses into one folder
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("a/b/c/d");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe("file.txt");
    expect(tree[0].children[0].path).toBe("a/b/c/d/file.txt");
  });

  it("does not collapse when a folder has multiple children", () => {
    const tree = buildFileTree([
      change("src/a.ts"),
      change("src/sub/b.ts"),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("src");
    expect(tree[0].children).toHaveLength(2);
    // folder "sub" first, then file "a.ts"
    expect(tree[0].children[0].name).toBe("sub");
    expect(tree[0].children[1].name).toBe("a.ts");
  });

  it("returns empty array for empty changes", () => {
    expect(buildFileTree([])).toEqual([]);
  });
});

describe("getTreeSortedPaths", () => {
  it("returns file paths in tree order (folders first, alphabetical)", () => {
    const tree = buildFileTree([
      change("README.md"),
      change("src/index.ts"),
      change("src/utils.ts"),
      change("lib/helper.ts"),
      change("package.json"),
    ]);
    const paths = getTreeSortedPaths(tree);
    // folders first (lib, src), then root files (package.json, README.md)
    expect(paths).toEqual([
      "lib/helper.ts",
      "src/index.ts",
      "src/utils.ts",
      "package.json",
      "README.md",
    ]);
  });

  it("returns empty array for empty tree", () => {
    expect(getTreeSortedPaths([])).toEqual([]);
  });

  it("handles nested folders with files at multiple levels", () => {
    const tree = buildFileTree([
      change("src/components/App.tsx"),
      change("src/components/ui/Button.tsx"),
      change("src/index.ts"),
    ]);
    const paths = getTreeSortedPaths(tree);
    // src/components: folder ui first, then App.tsx; then src/index.ts
    expect(paths).toEqual([
      "src/components/ui/Button.tsx",
      "src/components/App.tsx",
      "src/index.ts",
    ]);
  });
});
