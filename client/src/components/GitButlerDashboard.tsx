import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import type { ProjectDashboard, PullResult, DashboardStack, DashboardBranch, ButChange, ButCommit, MrStatus } from "../api";
import { getMrLabel, getMrStatusClass, getMrStatusTooltip } from "../api";
import { fetchGitButlerStatus, fetchAllGitButlerStatus, gitButlerPull, gitButlerPullAll } from "../api";
import Icon from "./Icon";

// ── Public handle for keyboard shortcut integration ─────────────

export interface GitButlerDashboardHandle {
  triggerPull: () => void;
}

// ── Props ───────────────────────────────────────────────────────

interface Props {
  mode: "project" | "all";
  projectId?: number | null;
  projects: import("../api").Project[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onClose: () => void;
  onNavigateToSession: (sessionId: number) => void;
}

// ── Main component ──────────────────────────────────────────────

const GitButlerDashboard = forwardRef<GitButlerDashboardHandle, Props>(function GitButlerDashboard(
  { mode, projectId, projects, sidebarOpen, setSidebarOpen, onClose, onNavigateToSession },
  ref
) {
  const [dashboards, setDashboards] = useState<ProjectDashboard[]>([]);
  const [pulling, setPulling] = useState(false);
  const [pullResults, setPullResults] = useState<PullResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (force = false) => {
    try {
      if (mode === "project" && projectId) {
        const data = await fetchGitButlerStatus(projectId, force);
        setDashboards([data]);
      } else {
        const data = await fetchAllGitButlerStatus(force);
        setDashboards(data);
      }
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [mode, projectId]);

  // Poll: fast (2s) when any project is refreshing, slow (10s) when settled
  const anyRefreshing = dashboards.some((d) => d.refreshing);
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, anyRefreshing ? 2_000 : 10_000);
    return () => clearInterval(interval);
  }, [fetchData, anyRefreshing]);

  const handlePull = useCallback(async () => {
    setPulling(true);
    setPullResults(null);
    try {
      let results: PullResult[];
      if (mode === "project" && projectId) {
        results = [await gitButlerPull(projectId)];
      } else {
        results = await gitButlerPullAll();
      }
      setPullResults(results);
      await fetchData();
    } catch (e: any) {
      setPullResults([{ projectId: 0, projectName: "Unknown", success: false, hasConflicts: false, error: e.message }]);
    } finally {
      setPulling(false);
    }
  }, [mode, projectId, fetchData]);

  useImperativeHandle(ref, () => ({ triggerPull: handlePull }), [handlePull]);

  // Use already-loaded project name for immediate title (no flash)
  const projectName = mode === "project" && projectId
    ? projects.find((p) => p.id === projectId)?.name ?? null
    : null;
  const title = projectName ?? (mode === "project" ? "Project" : "All Projects");

  const upstreamCount = dashboards.reduce((sum, d) =>
    sum + (d.pullCheck?.upstreamCommits?.count ?? 0), 0);

  return (
    <main className="main-content">
      <div className="gb-dashboard">
        {/* Header */}
        <div className="gb-header">
          <button className="sidebar-open-btn" onClick={() => setSidebarOpen(true)} title="Open sidebar">
            <Icon name="menu" size={20} />
          </button>
          <Icon name="git-graph" size={18} />
          <h2>{title}</h2>
          <div className="gb-header-spacer" />
          <button className="btn btn-secondary gb-header-btn" onClick={() => fetchData(true)} title="Refresh">
            <Icon name="refresh-cw" size={14} />
          </button>
          <button
            className={`btn btn-primary gb-header-btn${upstreamCount > 0 ? " gb-pull-available" : ""}`}
            onClick={handlePull}
            disabled={pulling}
            title={`Pull${upstreamCount > 0 ? ` (${upstreamCount} upstream)` : ""}`}
          >
            {pulling
              ? <><Icon name="loader" size={14} /> Pulling…</>
              : <><Icon name="arrow-down" size={14} /> Pull{upstreamCount > 0 ? ` (${upstreamCount})` : ""}</>}
          </button>
          <button className="icon-btn" onClick={onClose} title="Close dashboard">
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Pull results banner */}
        {pullResults && <PullResultsBanner results={pullResults} onDismiss={() => setPullResults(null)} />}

        {/* Body — side-by-side when multiple projects */}
        <div className={`gb-body ${dashboards.length > 1 ? "gb-body-multi" : ""}`}>
          {error && <div className="gb-error"><Icon name="alert-circle" size={14} /> {error}</div>}
          {dashboards.map((d) => (
            <ProjectTree key={d.projectId} dashboard={d} showName={mode === "all"} onNavigateToSession={onNavigateToSession} />
          ))}
          {dashboards.length === 0 && !error && <div className="gb-loading">Loading GitButler status…</div>}
        </div>
      </div>
    </main>
  );
});

export default GitButlerDashboard;

// ── Pull Results Banner ─────────────────────────────────────────

function PullResultsBanner({ results, onDismiss }: { results: PullResult[]; onDismiss: () => void }) {
  const cls = results.some((r) => !r.success) ? "error" : results.some((r) => r.hasConflicts) ? "warning" : "success";
  return (
    <div className={`gb-pull-banner ${cls}`}>
      <div className="gb-pull-banner-content">
        {results.map((r) => (
          <div key={r.projectId} className="gb-pull-result-row">
            <span className="gb-pull-project-name">{r.projectName}</span>
            {r.success && !r.hasConflicts && <span className="gb-pull-ok"><Icon name="check" size={12} /> Up to date</span>}
            {r.success && r.hasConflicts && <span className="gb-pull-warn"><Icon name="alert-triangle" size={12} /> Conflicts</span>}
            {!r.success && <span className="gb-pull-err"><Icon name="x-circle" size={12} /> {r.error}</span>}
          </div>
        ))}
      </div>
      <button className="icon-btn" onClick={onDismiss}><Icon name="x" size={14} /></button>
    </div>
  );
}

// ── Project Tree ────────────────────────────────────────────────
// Mimics `but status` tree output:
//   ╭┄zz [unstaged changes]
//   ┊  files…
//   ┊╭┄br [branch-name] #PR
//   ┊● commit
//   ├╯
//   ┴ base

function ProjectTree({
  dashboard: d,
  showName,
  onNavigateToSession,
}: {
  dashboard: ProjectDashboard;
  showName: boolean;
  onNavigateToSession: (sessionId: number) => void;
}) {
  const hasUnassigned = d.unassignedChanges.length > 0;
  const hasContent = d.stacks.length > 0 || hasUnassigned;

  return (
    <div className="gb-tree">
      {showName && (
        <div className="gb-tree-project-name">
          <Icon name="folder" size={13} />
          <span>{d.projectName}</span>
          {d.refreshing && <span className="gb-refreshing" title="Refreshing…"><Icon name="loader" size={12} /></span>}
          {d.pullCheck && !d.pullCheck.upToDate && (
            <span className="gb-upstream-badge">↓ {d.pullCheck.upstreamCommits.count}</span>
          )}
        </div>
      )}
      {!showName && (
        <div className="gb-tree-project-status">
          {d.refreshing && <span className="gb-refreshing" title="Refreshing…"><Icon name="loader" size={12} /></span>}
          {d.pullCheck && !d.pullCheck.upToDate && (
            <span className="gb-tree-upstream">
              <Icon name="arrow-down" size={12} /> {d.pullCheck.upstreamCommits.count} upstream commit(s)
            </span>
          )}
        </div>
      )}
      {d.error && <div className="gb-tree-error"><Icon name="alert-circle" size={12} /> {d.error}</div>}

      {hasContent && (
        <div className="gb-tree-trunk">
          {/* Unassigned changes */}
          {hasUnassigned && <UnassignedNode changes={d.unassignedChanges} />}

          {/* Branches */}
          {d.stacks.map((stack) =>
            stack.branches.map((branch, bi) => (
              <BranchNode
                key={branch.cliId}
                branch={branch}
                onNavigateToSession={onNavigateToSession}
              />
            ))
          )}

          {/* Base commit */}
          <div className="gb-tree-base">
            <span className="gb-tree-gutter">┴</span>
            <span className="gb-tree-base-label">
              {d.pullCheck?.baseBranch?.name ?? "base"}
            </span>
          </div>
        </div>
      )}

      {!hasContent && !d.error && <div className="gb-tree-empty">No active branches</div>}
    </div>
  );
}

// ── Unassigned changes node ─────────────────────────────────────

function UnassignedNode({ changes }: { changes: ButChange[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="gb-tree-node">
      <div className="gb-tree-branch-line">
        <span className="gb-tree-gutter">┊</span>
        <span className="gb-tree-fork">╭┄</span>
        <span className="gb-tree-zz" onClick={() => setExpanded(!expanded)}>
          zz
          <span className="gb-tree-bracket">[unstaged: {changes.length} file(s)]</span>
        </span>
      </div>
      {expanded && changes.map((c) => (
        <div key={c.cliId} className="gb-tree-file-row">
          <span className="gb-tree-gutter">┊</span>
          <span className={`gb-tree-file-type gb-ft-${c.changeType}`}>
            {c.changeType === "added" ? "A" : c.changeType === "deleted" ? "D" : "M"}
          </span>
          <span className="gb-tree-file-path">{c.filePath}</span>
        </div>
      ))}
      <div className="gb-tree-close-line">
        <span className="gb-tree-gutter">├╯</span>
      </div>
    </div>
  );
}

// ── Branch node ─────────────────────────────────────────────────

function BranchNode({
  branch,
  onNavigateToSession,
}: {
  branch: DashboardBranch;
  onNavigateToSession: (sessionId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasConflicts = branch.commits.some((c) => c.conflicted);
  const commitCount = branch.commits.length;
  const mrUrls = branch.linkedMrUrls;

  const statusDot = hasConflicts ? "◈" :
    branch.branchStatus === "integrated" || branch.branchStatus === "nothingToPush" ? "●" : "◐";

  return (
    <div className="gb-tree-node">
      {/* Branch header line */}
      <div className="gb-tree-branch-line" onClick={() => setExpanded(!expanded)}>
        <span className="gb-tree-gutter">┊</span>
        <span className="gb-tree-fork">╭┄</span>
        <span className={`gb-tree-branch-name gb-bs-${branchStatusClass(branch.branchStatus, hasConflicts)}`}>
          {branch.name}
        </span>
        {/* PR badges inline */}
        {mrUrls.map((url) => (
          <MrBadge key={url} url={url} status={branch.linkedMrStatuses[url]} />
        ))}
        {/* Session link */}
        {branch.linkedSession && (
          <button
            className="gb-tree-session"
            title={`Go to session: ${branch.linkedSession.name}`}
            onClick={(e) => { e.stopPropagation(); onNavigateToSession(branch.linkedSession!.id); }}
          >
            <Icon name="terminal" size={10} />
            <span>{branch.linkedSession.name}</span>
          </button>
        )}
      </div>

      {/* Compact: show latest commit on one line */}
      {!expanded && commitCount > 0 && (
        <div className="gb-tree-commit-row" onClick={() => setExpanded(true)}>
          <span className="gb-tree-gutter">┊</span>
          <span className={`gb-tree-dot gb-bs-${branchStatusClass(branch.branchStatus, hasConflicts)}`}>{statusDot}</span>
          <span className="gb-tree-commit-summary">
            {commitCount > 1 && <span className="gb-tree-commit-count">{commitCount}× </span>}
            {firstLine(branch.commits[0].message)}
          </span>
        </div>
      )}
      {commitCount === 0 && !expanded && (
        <div className="gb-tree-commit-row">
          <span className="gb-tree-gutter">┊</span>
          <span className="gb-tree-no-commits">(no commits)</span>
        </div>
      )}

      {/* Expanded: all commits */}
      {expanded && branch.commits.map((commit) => (
        <div key={commit.cliId} className={`gb-tree-commit-row${commit.conflicted ? " conflicted" : ""}`}>
          <span className="gb-tree-gutter">┊</span>
          <span className={`gb-tree-dot gb-bs-${branchStatusClass(branch.branchStatus, hasConflicts)}`}>{statusDot}</span>
          <span className="gb-tree-sha">{commit.commitId.slice(0, 9)}</span>
          <span className="gb-tree-commit-msg">{firstLine(commit.message)}</span>
        </div>
      ))}
      {expanded && branch.upstreamCommits.length > 0 && (
        <div className="gb-tree-commit-row">
          <span className="gb-tree-gutter">┊</span>
          <span className="gb-tree-upstream-label">↓ {branch.upstreamCommits.length} upstream</span>
        </div>
      )}

      {/* Close branch */}
      <div className="gb-tree-close-line">
        <span className="gb-tree-gutter">├╯</span>
      </div>
    </div>
  );
}

// ── MR badge ────────────────────────────────────────────────────

function MrBadge({ url, status }: { url: string; status?: MrStatus }) {
  const statusClass = getMrStatusClass(status);
  const tooltip = status ? `${url}\n${getMrStatusTooltip(status)}` : url;
  return (
    <a
      className={`gb-tree-mr mr-status-${statusClass}`}
      href={url} target="_blank" rel="noopener noreferrer"
      title={tooltip}
      onClick={(e) => e.stopPropagation()}
    >
      {getMrLabel(url)}
    </a>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function firstLine(msg: string): string {
  return msg.split("\n")[0].slice(0, 72);
}

function branchStatusClass(status: string, hasConflicts: boolean): string {
  if (hasConflicts) return "conflicted";
  if (status === "integrated" || status === "nothingToPush") return "pushed";
  if (status === "completelyUnpushed") return "unpushed";
  if (status === "unpushedCommitsRequiringForce") return "force";
  return "default";
}
