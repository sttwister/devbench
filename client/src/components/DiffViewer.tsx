// @lat: [[gitbutler#Diff Viewer]]
import { useState, useEffect, useCallback, useRef } from "react";
import type { DiffResult, DiffChange, DiffHunk, ProjectDashboard } from "../api";
import { fetchDiff, fetchGitButlerStatus } from "../api";
import Icon from "./Icon";

// ── Types ───────────────────────────────────────────────────────

export interface DiffTarget {
  projectId: number;
  /** CLI ID or branch name; omit for uncommitted changes. */
  target?: string;
  /** Display label, e.g. "Unstaged changes" or a commit message. */
  label: string;
}

interface Props {
  diffTarget: DiffTarget;
  onClose: () => void;
  /** Callback to switch the diff target (for split-view navigation). */
  onChangeDiffTarget?: (target: DiffTarget) => void;
}

// ── Parsed diff line ────────────────────────────────────────────

export type DiffLineType = "add" | "del" | "context" | "hunk-header";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

/** Parse a hunk's raw unified diff string into structured lines. */
export function parseHunkLines(hunk: DiffHunk): DiffLine[] {
  const lines: DiffLine[] = [];
  const rawLines = hunk.diff.split("\n");
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;

  for (const raw of rawLines) {
    if (raw.startsWith("@@")) {
      lines.push({ type: "hunk-header", content: raw, oldLineNo: null, newLineNo: null });
    } else if (raw.startsWith("+")) {
      lines.push({ type: "add", content: raw.slice(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
    } else if (raw.startsWith("-")) {
      lines.push({ type: "del", content: raw.slice(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
    } else if (raw === "\\ No newline at end of file") {
      lines.push({ type: "context", content: raw, oldLineNo: null, newLineNo: null });
    } else if (raw.startsWith(" ")) {
      lines.push({ type: "context", content: raw.slice(1), oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
    } else if (raw.length > 0) {
      // Treat any other non-empty line as context
      lines.push({ type: "context", content: raw, oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
    }
  }
  return lines;
}

/** Short status label for a change. */
function statusBadge(status: string): { letter: string; cls: string } {
  switch (status) {
    case "added": return { letter: "A", cls: "added" };
    case "deleted": return { letter: "D", cls: "deleted" };
    default: return { letter: "M", cls: "modified" };
  }
}

/** Merge changes that share the same path, combining their hunks. */
function mergeChangesByPath(changes: DiffChange[]): DiffChange[] {
  const map = new Map<string, DiffChange>();
  for (const change of changes) {
    const existing = map.get(change.path);
    if (!existing) {
      // Clone so we don't mutate the original
      map.set(change.path, { ...change, diff: { ...change.diff, hunks: [...(change.diff?.hunks ?? [])] } });
    } else {
      // Merge hunks into the existing entry
      if (change.diff?.hunks) {
        existing.diff.hunks.push(...change.diff.hunks);
      }
      // If any entry is non-binary patch, keep it as patch
      if (change.diff?.type === "patch") {
        existing.diff.type = "patch";
      }
      // Prefer non-"modified" status (added/deleted) if present
      if (change.status !== "modified") {
        existing.status = change.status;
      }
    }
  }
  return Array.from(map.values());
}

/** Basename of a file path. */
function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1];
}

// ── File tree for grouped sidebar ───────────────────────────────

export interface FileTreeEntry {
  /** Segment name (folder or file basename). */
  name: string;
  /** Full file path (only set on leaf files). */
  path?: string;
  /** The DiffChange (only set on leaf files). */
  change?: DiffChange;
  /** Child entries (subfolders and files). */
  children: FileTreeEntry[];
}

/**
 * Build a nested folder tree from a flat list of changes.
 * Folders with a single child folder are collapsed into one entry
 * (e.g. "src/components" instead of nested "src" → "components").
 */
export function buildFileTree(changes: DiffChange[]): FileTreeEntry[] {
  const root: FileTreeEntry = { name: "", children: [] };

  for (const change of changes) {
    const parts = change.path.split("/");
    let current = root;
    // Walk to the parent folder, creating intermediate nodes
    for (let i = 0; i < parts.length - 1; i++) {
      let child = current.children.find((c) => c.name === parts[i] && !c.path);
      if (!child) {
        child = { name: parts[i], children: [] };
        current.children.push(child);
      }
      current = child;
    }
    // Add the file leaf
    current.children.push({
      name: parts[parts.length - 1],
      path: change.path,
      change,
      children: [],
    });
  }

  // Collapse single-child folder chains (e.g. src → components → File becomes src/components → File)
  function collapse(node: FileTreeEntry): FileTreeEntry {
    node.children = node.children.map(collapse);
    // If this is a non-root folder with exactly one child that is also a folder, merge them
    if (node.name && !node.path && node.children.length === 1 && !node.children[0].path) {
      const child = node.children[0];
      return { name: `${node.name}/${child.name}`, children: child.children };
    }
    return node;
  }

  const collapsed = collapse(root);

  // Sort: folders first (alphabetically), then files (alphabetically)
  function sortTree(entries: FileTreeEntry[]): FileTreeEntry[] {
    const folders = entries.filter((e) => !e.path).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter((e) => !!e.path).sort((a, b) => a.name.localeCompare(b.name));
    for (const f of folders) f.children = sortTree(f.children);
    return [...folders, ...files];
  }

  return sortTree(collapsed.children);
}

// ── Component ───────────────────────────────────────────────────

export default function DiffViewer({ diffTarget, onClose, onChangeDiffTarget }: Props) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showFileList, setShowFileList] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [wrapLines, setWrapLines] = useState(true);
  const [splitView, setSplitView] = useState(() => {
    try { return localStorage.getItem("diff-split-view") === "true"; } catch { return false; }
  });
  const [targetDropdownOpen, setTargetDropdownOpen] = useState(false);
  const [branchTargets, setBranchTargets] = useState<{ name: string; label: string }[]>([]);
  const fileRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const contentRef = useRef<HTMLDivElement | null>(null);
  const targetDropdownRef = useRef<HTMLDivElement | null>(null);

  const zoomIn = useCallback(() => setZoomLevel((z) => Math.min(z + 25, 200)), []);
  const zoomOut = useCallback(() => setZoomLevel((z) => Math.max(z - 25, 50)), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDiff(diffTarget.projectId, diffTarget.target);
      result.changes = mergeChangesByPath(result.changes);
      setDiff(result);
      if (result.changes.length > 0) {
        setSelectedFile(result.changes[0].path);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load diff");
    } finally {
      setLoading(false);
    }
  }, [diffTarget.projectId, diffTarget.target]);

  useEffect(() => { load(); }, [load]);

  // Fetch branch targets for the target switcher dropdown
  useEffect(() => {
    if (!onChangeDiffTarget) return;
    let cancelled = false;
    fetchGitButlerStatus(diffTarget.projectId).then((dashboard: ProjectDashboard) => {
      if (cancelled) return;
      const targets: { name: string; label: string }[] = [];
      for (const stack of dashboard.stacks) {
        for (const branch of stack.branches) {
          targets.push({ name: branch.name, label: branch.name });
        }
      }
      setBranchTargets(targets);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [diffTarget.projectId, onChangeDiffTarget]);

  // Close target dropdown on outside click
  useEffect(() => {
    if (!targetDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (targetDropdownRef.current && !targetDropdownRef.current.contains(e.target as Node)) {
        setTargetDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [targetDropdownOpen]);

  // Persist split view preference
  const toggleSplitView = useCallback(() => {
    setSplitView((prev) => {
      const next = !prev;
      try { localStorage.setItem("diff-split-view", String(next)); } catch {}
      return next;
    });
  }, []);

  // Scroll to file in diff area when selected from file list
  const scrollToFile = useCallback((path: string) => {
    setSelectedFile(path);
    setShowFileList(false); // close on mobile
    const el = fileRefs.current[path];
    if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
  }, []);

  // ── Vim keybindings ─────────────────────────────────────────────
  useEffect(() => {
    const SCROLL_STEP = 60;

    const handler = (e: KeyboardEvent) => {
      // Don't capture when an input/textarea/select is focused
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const el = contentRef.current;
      if (!el) return;

      switch (e.key) {
        case "q":
          onClose();
          e.preventDefault();
          break;
        case "j":
          el.scrollBy({ top: SCROLL_STEP });
          e.preventDefault();
          break;
        case "k":
          el.scrollBy({ top: -SCROLL_STEP });
          e.preventDefault();
          break;
        case "d":
          el.scrollBy({ top: el.clientHeight / 2 });
          e.preventDefault();
          break;
        case "u":
          el.scrollBy({ top: -el.clientHeight / 2 });
          e.preventDefault();
          break;
        case "h": {
          // Jump to previous file
          if (diff) {
            const paths = diff.changes.map(c => c.path);
            const idx = selectedFile ? paths.indexOf(selectedFile) : -1;
            if (idx > 0) scrollToFile(paths[idx - 1]);
          }
          e.preventDefault();
          break;
        }
        case "l": {
          // Jump to next file
          if (diff) {
            const paths = diff.changes.map(c => c.path);
            const idx = selectedFile ? paths.indexOf(selectedFile) : -1;
            if (idx >= 0 && idx < paths.length - 1) scrollToFile(paths[idx + 1]);
          }
          e.preventDefault();
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [diff, selectedFile, scrollToFile, onClose]);

  // Count additions/deletions per change
  const getStats = (change: DiffChange) => {
    let additions = 0;
    let deletions = 0;
    if (change.diff?.hunks) {
      for (const hunk of change.diff.hunks) {
        for (const line of hunk.diff.split("\n")) {
          if (line.startsWith("+") && !line.startsWith("@@")) additions++;
          else if (line.startsWith("-") && !line.startsWith("@@")) deletions++;
        }
      }
    }
    return { additions, deletions };
  };

  // Total stats
  const totalStats = diff?.changes.reduce(
    (acc, c) => {
      const s = getStats(c);
      return { additions: acc.additions + s.additions, deletions: acc.deletions + s.deletions };
    },
    { additions: 0, deletions: 0 },
  ) ?? { additions: 0, deletions: 0 };

  return (
    <div className="diff-viewer">
      {/* Header */}
      <div className="diff-header">
        <button className="diff-back-btn" onClick={onClose} title="Back to dashboard">
          <Icon name="chevron-left" size={16} className="diff-back-icon-desktop" />
          <Icon name="x" size={16} className="diff-back-icon-mobile" />
          <span className="diff-back-label">Back</span>
        </button>
        <Icon name="file-diff" size={16} />
        {onChangeDiffTarget ? (
          <div className="diff-target-switcher" ref={targetDropdownRef}>
            <button
              className="diff-target-btn"
              onClick={() => setTargetDropdownOpen(!targetDropdownOpen)}
              title="Switch diff target"
            >
              <span className="diff-title">{diffTarget.label}</span>
              <Icon name="chevron-down" size={14} />
            </button>
            {targetDropdownOpen && (
              <div className="diff-target-dropdown">
                <button
                  className={`diff-target-option${!diffTarget.target ? " active" : ""}`}
                  onClick={() => {
                    onChangeDiffTarget({ projectId: diffTarget.projectId, label: "Unstaged changes" });
                    setTargetDropdownOpen(false);
                  }}
                >
                  <Icon name="alert-circle" size={12} />
                  <span>Unstaged changes</span>
                </button>
                {branchTargets.map((bt) => (
                  <button
                    key={bt.name}
                    className={`diff-target-option${diffTarget.target === bt.name ? " active" : ""}`}
                    onClick={() => {
                      onChangeDiffTarget({ projectId: diffTarget.projectId, target: bt.name, label: bt.label });
                      setTargetDropdownOpen(false);
                    }}
                  >
                    <Icon name="git-branch" size={12} />
                    <span>{bt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <h2 className="diff-title">{diffTarget.label}</h2>
        )}
        <div className="diff-header-spacer" />
        {diff && diff.changes.length > 0 && (
          <span className="diff-summary">
            <span className="diff-stat-files">{diff.changes.length} file{diff.changes.length !== 1 ? "s" : ""}</span>
            {totalStats.additions > 0 && <span className="diff-stat-add">+{totalStats.additions}</span>}
            {totalStats.deletions > 0 && <span className="diff-stat-del">-{totalStats.deletions}</span>}
          </span>
        )}
        {/* Split/unified view toggle */}
        <button
          className={`diff-wrap-btn${splitView ? " active" : ""}`}
          onClick={toggleSplitView}
          title={splitView ? "Switch to unified view" : "Switch to split view"}
        >
          <Icon name="columns" size={16} />
        </button>
        {/* Wrap lines toggle */}
        <button
          className={`diff-wrap-btn${wrapLines ? " active" : ""}`}
          onClick={() => setWrapLines(w => !w)}
          title={wrapLines ? "Disable line wrapping" : "Enable line wrapping"}
        >
          <Icon name="wrap-text" size={16} />
        </button>
        {/* Mobile zoom controls */}
        <div className="diff-zoom-controls">
          <button className="diff-zoom-btn" onClick={zoomOut} disabled={zoomLevel <= 50} title="Zoom out">
            <Icon name="zoom-out" size={16} />
          </button>
          <span className="diff-zoom-level">{zoomLevel}%</span>
          <button className="diff-zoom-btn" onClick={zoomIn} disabled={zoomLevel >= 200} title="Zoom in">
            <Icon name="zoom-in" size={16} />
          </button>
        </div>
        {/* Mobile file list toggle */}
        <button
          className="diff-file-list-toggle"
          onClick={() => setShowFileList(!showFileList)}
          title="File list"
        >
          <Icon name="menu" size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="diff-body">
        {/* File list sidebar */}
        {diff && diff.changes.length > 0 && (
          <div className={`diff-file-list${showFileList ? " diff-file-list-open" : ""}`}>
            <div className="diff-file-list-header">
              <span>Files</span>
              <button className="diff-file-list-close" onClick={() => setShowFileList(false)}>
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="diff-file-tree">
              {buildFileTree(diff.changes).map((entry) => (
                <FileTreeNode
                  key={entry.path ?? entry.name}
                  entry={entry}
                  depth={0}
                  selectedFile={selectedFile}
                  onSelectFile={scrollToFile}
                  getStats={getStats}
                />
              ))}
            </div>
          </div>
        )}

        {/* Diff content area */}
        <div
          ref={contentRef}
          className={`diff-content${wrapLines ? " diff-wrap" : ""}`}
          style={{ "--diff-zoom": `${zoomLevel / 100}` } as React.CSSProperties}
        >
          {loading && (
            <div className="diff-loading">
              <Icon name="loader" size={18} /> Loading diff…
            </div>
          )}
          {error && (
            <div className="diff-error">
              <Icon name="alert-circle" size={16} /> {error}
              <button className="btn btn-secondary" onClick={load} style={{ marginLeft: 12 }}>
                Retry
              </button>
            </div>
          )}
          {diff && diff.changes.length === 0 && !loading && !error && (
            <div className="diff-empty">No changes</div>
          )}
          {diff && diff.changes.map((change) => (
            <FileChange
              key={change.path}
              change={change}
              splitView={splitView}
              refCallback={(el) => { fileRefs.current[change.path] = el; }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── File Tree Node ─────────────────────────────────────────────

function FileTreeNode({
  entry,
  depth,
  selectedFile,
  onSelectFile,
  getStats,
}: {
  entry: FileTreeEntry;
  depth: number;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  getStats: (change: DiffChange) => { additions: number; deletions: number };
}) {
  const [collapsed, setCollapsed] = useState(false);
  const isFolder = !entry.path;

  if (isFolder) {
    return (
      <div className="diff-tree-folder">
        <button
          className="diff-tree-folder-btn"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => setCollapsed(!collapsed)}
        >
          <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={12} />
          <Icon name="folder" size={12} />
          <span className="diff-tree-folder-name">{entry.name}</span>
        </button>
        {!collapsed && entry.children.map((child) => (
          <FileTreeNode
            key={child.path ?? child.name}
            entry={child}
            depth={depth + 1}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            getStats={getStats}
          />
        ))}
      </div>
    );
  }

  // Leaf file
  const change = entry.change!;
  const badge = statusBadge(change.status);
  const stats = getStats(change);

  return (
    <button
      className={`diff-file-item${selectedFile === entry.path ? " active" : ""}`}
      style={{ paddingLeft: `${8 + (depth) * 12}px` }}
      onClick={() => onSelectFile(entry.path!)}
      title={entry.path}
    >
      <span className={`diff-file-status diff-fs-${badge.cls}`}>{badge.letter}</span>
      <span className="diff-file-name">{entry.name}</span>
      <span className="diff-file-stats">
        {stats.additions > 0 && <span className="diff-stat-add">+{stats.additions}</span>}
        {stats.deletions > 0 && <span className="diff-stat-del">-{stats.deletions}</span>}
      </span>
    </button>
  );
}

// ── File Change Block ───────────────────────────────────────────

function FileChange({
  change,
  splitView,
  refCallback,
}: {
  change: DiffChange;
  splitView: boolean;
  refCallback: (el: HTMLDivElement | null) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const badge = statusBadge(change.status);
  const isBinary = change.diff?.type !== "patch";
  const hunks = change.diff?.hunks ?? [];

  return (
    <div className="diff-file-block" ref={refCallback}>
      <div className="diff-file-header" onClick={() => setCollapsed(!collapsed)}>
        <Icon name={collapsed ? "chevron-right" : "chevron-down"} size={14} />
        <span className={`diff-file-status diff-fs-${badge.cls}`}>{badge.letter}</span>
        <span className="diff-file-path">{change.path}</span>
      </div>
      {!collapsed && (
        <div className="diff-file-body">
          {isBinary ? (
            <div className="diff-binary">Binary file changed</div>
          ) : hunks.length === 0 ? (
            <div className="diff-binary">Empty diff</div>
          ) : (
            <div className="diff-hunks">
              {hunks.map((hunk, i) => (
                splitView
                  ? <SplitHunkView key={i} hunk={hunk} isFirst={i === 0} />
                  : <HunkView key={i} hunk={hunk} isFirst={i === 0} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Hunk View ───────────────────────────────────────────────────

function HunkView({ hunk, isFirst }: { hunk: DiffHunk; isFirst: boolean }) {
  const lines = parseHunkLines(hunk);

  return (
    <table className="diff-hunk-table">
      <tbody>
        {lines.map((line, i) => {
          if (line.type === "hunk-header") {
            // Skip the separator for the very first hunk in a file
            if (isFirst) return null;
            return (
              <tr key={i} className="diff-line diff-line-hunk-header">
                <td className="diff-line-no diff-line-no-old diff-hunk-separator"></td>
                <td className="diff-line-no diff-line-no-new diff-hunk-separator"></td>
                <td className="diff-line-marker diff-hunk-separator"></td>
                <td className="diff-line-content diff-hunk-separator">
                  <span className="diff-hunk-dots">···</span>
                </td>
              </tr>
            );
          }
          return (
            <tr key={i} className={`diff-line diff-line-${line.type}`}>
              <td className="diff-line-no diff-line-no-old">
                {line.oldLineNo ?? ""}
              </td>
              <td className="diff-line-no diff-line-no-new">
                {line.newLineNo ?? ""}
              </td>
              <td className="diff-line-marker">
                {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
              </td>
              <td className="diff-line-content">
                <pre>{line.content}</pre>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Split line pairing ──────────────────────────────────────────

/** A row in the split (side-by-side) diff view. */
export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Pair parsed hunk lines into side-by-side rows. */
export function pairLinesForSplit(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.type === "hunk-header") {
      rows.push({ left: line, right: line });
      i++;
    } else if (line.type === "context") {
      rows.push({ left: line, right: line });
      i++;
    } else if (line.type === "del") {
      // Collect consecutive deletions
      const dels: DiffLine[] = [];
      while (i < lines.length && lines[i].type === "del") {
        dels.push(lines[i]);
        i++;
      }
      // Collect consecutive additions that follow
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === "add") {
        adds.push(lines[i]);
        i++;
      }
      // Pair them up
      const maxLen = Math.max(dels.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left: j < dels.length ? dels[j] : null,
          right: j < adds.length ? adds[j] : null,
        });
      }
    } else if (line.type === "add") {
      // Standalone addition (no preceding deletion)
      rows.push({ left: null, right: line });
      i++;
    } else {
      i++;
    }
  }
  return rows;
}

// ── Split Hunk View ─────────────────────────────────────────────

function SplitHunkView({ hunk, isFirst }: { hunk: DiffHunk; isFirst: boolean }) {
  const lines = parseHunkLines(hunk);
  const rows = pairLinesForSplit(lines);

  return (
    <table className="diff-hunk-table diff-hunk-split">
      <tbody>
        {rows.map((row, i) => {
          // Hunk header separator
          if (row.left?.type === "hunk-header") {
            if (isFirst) return null;
            return (
              <tr key={i} className="diff-line diff-line-hunk-header">
                <td className="diff-line-no diff-split-line-no diff-hunk-separator"></td>
                <td className="diff-line-marker diff-hunk-separator"></td>
                <td className="diff-line-content diff-split-content diff-hunk-separator">
                  <span className="diff-hunk-dots">···</span>
                </td>
                <td className="diff-split-gutter diff-hunk-separator"></td>
                <td className="diff-line-no diff-split-line-no diff-hunk-separator"></td>
                <td className="diff-line-marker diff-hunk-separator"></td>
                <td className="diff-line-content diff-split-content diff-hunk-separator">
                  <span className="diff-hunk-dots">···</span>
                </td>
              </tr>
            );
          }

          const leftType = row.left?.type ?? "empty";
          const rightType = row.right?.type ?? "empty";

          return (
            <tr key={i} className="diff-line diff-split-row">
              {/* Left side (old) */}
              <td className={`diff-line-no diff-split-line-no${leftType === "del" ? " diff-split-del" : leftType === "context" ? "" : " diff-split-empty"}`}>
                {row.left?.oldLineNo ?? ""}
              </td>
              <td className={`diff-line-marker${leftType === "del" ? " diff-split-del" : leftType === "context" ? "" : " diff-split-empty"}`}>
                {leftType === "del" ? "-" : leftType === "context" ? " " : ""}
              </td>
              <td className={`diff-line-content diff-split-content${leftType === "del" ? " diff-split-del" : leftType === "context" ? "" : " diff-split-empty"}`}>
                <pre>{row.left?.type !== "hunk-header" ? (row.left?.content ?? "") : ""}</pre>
              </td>
              {/* Gutter */}
              <td className="diff-split-gutter"></td>
              {/* Right side (new) */}
              <td className={`diff-line-no diff-split-line-no${rightType === "add" ? " diff-split-add" : rightType === "context" ? "" : " diff-split-empty"}`}>
                {row.right?.newLineNo ?? ""}
              </td>
              <td className={`diff-line-marker${rightType === "add" ? " diff-split-add" : rightType === "context" ? "" : " diff-split-empty"}`}>
                {rightType === "add" ? "+" : rightType === "context" ? " " : ""}
              </td>
              <td className={`diff-line-content diff-split-content${rightType === "add" ? " diff-split-add" : rightType === "context" ? "" : " diff-split-empty"}`}>
                <pre>{row.right?.type !== "hunk-header" ? (row.right?.content ?? "") : ""}</pre>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
