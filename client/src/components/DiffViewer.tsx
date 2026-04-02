// @lat: [[gitbutler#Diff Viewer]]
import { useState, useEffect, useCallback, useRef } from "react";
import type { DiffResult, DiffChange, DiffHunk } from "../api";
import { fetchDiff } from "../api";
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

/** Directory part of a file path (without trailing slash). */
function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : "";
}

// ── Component ───────────────────────────────────────────────────

export default function DiffViewer({ diffTarget, onClose }: Props) {
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showFileList, setShowFileList] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const fileRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  // Scroll to file in diff area when selected from file list
  const scrollToFile = useCallback((path: string) => {
    setSelectedFile(path);
    setShowFileList(false); // close on mobile
    const el = fileRefs.current[path];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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
        <h2 className="diff-title">{diffTarget.label}</h2>
        <div className="diff-header-spacer" />
        {diff && diff.changes.length > 0 && (
          <span className="diff-summary">
            <span className="diff-stat-files">{diff.changes.length} file{diff.changes.length !== 1 ? "s" : ""}</span>
            {totalStats.additions > 0 && <span className="diff-stat-add">+{totalStats.additions}</span>}
            {totalStats.deletions > 0 && <span className="diff-stat-del">-{totalStats.deletions}</span>}
          </span>
        )}
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
            {diff.changes.map((change) => {
              const badge = statusBadge(change.status);
              const stats = getStats(change);
              return (
                <button
                  key={change.path}
                  className={`diff-file-item${selectedFile === change.path ? " active" : ""}`}
                  onClick={() => scrollToFile(change.path)}
                  title={change.path}
                >
                  <span className={`diff-file-status diff-fs-${badge.cls}`}>{badge.letter}</span>
                  <span className="diff-file-name">{basename(change.path)}</span>
                  <span className="diff-file-dir">{dirname(change.path)}</span>
                  <span className="diff-file-stats">
                    {stats.additions > 0 && <span className="diff-stat-add">+{stats.additions}</span>}
                    {stats.deletions > 0 && <span className="diff-stat-del">-{stats.deletions}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Diff content area */}
        <div
          className="diff-content"
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
              refCallback={(el) => { fileRefs.current[change.path] = el; }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── File Change Block ───────────────────────────────────────────

function FileChange({
  change,
  refCallback,
}: {
  change: DiffChange;
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
                <HunkView key={i} hunk={hunk} isFirst={i === 0} />
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
