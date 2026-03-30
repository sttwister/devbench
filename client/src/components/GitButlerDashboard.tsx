import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import type { ProjectDashboard, PullResult, DashboardStack, DashboardBranch, ButChange, ButCommit } from "../api";
import { fetchGitButlerStatus, fetchAllGitButlerStatus, gitButlerPull, gitButlerPullAll, getSessionIcon } from "../api";
import Icon from "./Icon";
import MrBadge from "./MrBadge";

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
  ref,
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
            <ProjectFlow key={d.projectId} dashboard={d} showName={mode === "all"} onNavigateToSession={onNavigateToSession} />
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

// ── Project Flow ────────────────────────────────────────────────

function ProjectFlow({
  dashboard: d,
  showName,
  onNavigateToSession,
}: {
  dashboard: ProjectDashboard;
  showName: boolean;
  onNavigateToSession: (sessionId: number) => void;
}) {
  const hasUnassigned = d.unassignedChanges.length > 0;
  const allBranches = d.stacks.flatMap((s) => s.branches);
  const hasContent = allBranches.length > 0 || hasUnassigned;

  return (
    <div className="gb-flow">
      {/* Project header */}
      {showName && (
        <div className="gb-flow-project">
          <Icon name="folder" size={13} />
          <span>{d.projectName}</span>
          {d.refreshing && <span className="gb-refreshing" title="Refreshing…"><Icon name="loader" size={12} /></span>}
          {d.pullCheck && !d.pullCheck.upToDate && (
            <span className="gb-upstream-badge">↓ {d.pullCheck.upstreamCommits.count}</span>
          )}
        </div>
      )}
      {!showName && d.refreshing && (
        <div className="gb-flow-status">
          <span className="gb-refreshing" title="Refreshing…"><Icon name="loader" size={12} /></span>
        </div>
      )}
      {!showName && d.pullCheck && !d.pullCheck.upToDate && (
        <div className="gb-flow-status">
          <span className="gb-upstream-badge">↓ {d.pullCheck.upstreamCommits.count} upstream</span>
        </div>
      )}

      {d.error && <div className="gb-flow-error"><Icon name="alert-circle" size={12} /> {d.error}</div>}

      {hasContent && (
        <div className="gb-flow-cards">
          {/* Unassigned changes card */}
          {hasUnassigned && <UnassignedCard changes={d.unassignedChanges} />}

          {/* Branch cards */}
          {allBranches.map((branch) => (
            <BranchCard key={branch.cliId} branch={branch} onNavigateToSession={onNavigateToSession} />
          ))}

          {/* Base target */}
          <div className="gb-flow-base">
            <div className="gb-flow-connector" />
            <div className="gb-flow-base-label">
              {d.pullCheck?.baseBranch?.name ?? "base"}
            </div>
          </div>
        </div>
      )}

      {!hasContent && !d.error && <div className="gb-flow-empty">No active branches</div>}
    </div>
  );
}

// ── Unassigned Changes Card ─────────────────────────────────────

function UnassignedCard({ changes }: { changes: ButChange[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className="gb-card gb-card-unassigned" onClick={() => setExpanded(!expanded)}>
        <div className="gb-card-header">
          <span className="gb-card-icon gb-card-icon-warn">
            <Icon name="alert-circle" size={14} />
          </span>
          <div className="gb-card-title-block">
            <span className="gb-card-title">Unstaged changes</span>
            <span className="gb-card-subtitle">{changes.length} file(s)</span>
          </div>
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} className="gb-card-chevron" />
        </div>
        {expanded && (
          <div className="gb-card-files">
            {changes.map((c) => (
              <div key={c.cliId} className="gb-card-file">
                <span className={`gb-card-file-type gb-ft-${c.changeType}`}>
                  {c.changeType === "added" ? "A" : c.changeType === "deleted" ? "D" : "M"}
                </span>
                <span className="gb-card-file-path">{c.filePath}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="gb-flow-connector" />
    </>
  );
}

// ── Branch Card ─────────────────────────────────────────────────

function BranchCard({
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
  const session = branch.linkedSession;
  const statusCls = branchStatusClass(branch.branchStatus, hasConflicts);

  return (
    <>
      <div className={`gb-card gb-card-branch gb-card-${statusCls}`}>
        {/* Session header (primary) or branch-only header */}
        <div className="gb-card-header" onClick={() => setExpanded(!expanded)}>
          {session ? (
            <span
              className="gb-card-icon gb-card-icon-session"
              title={`Go to session: ${session.name}`}
              onClick={(e) => { e.stopPropagation(); onNavigateToSession(session.id); }}
            >
              <Icon name={getSessionIcon(session.type)} size={14} />
            </span>
          ) : (
            <span className="gb-card-icon gb-card-icon-branch">
              <Icon name="git-branch" size={14} />
            </span>
          )}
          <div className="gb-card-title-block">
            {session ? (
              <>
                <button
                  className="gb-card-title gb-card-session-link"
                  onClick={(e) => { e.stopPropagation(); onNavigateToSession(session.id); }}
                  title={`Go to session: ${session.name}`}
                >
                  {session.name}
                </button>
                <span className="gb-card-subtitle">
                  <span className={`gb-card-branch-name gb-bs-${statusCls}`}>{branch.name}</span>
                  {commitCount > 0 && <> · {commitCount} commit{commitCount !== 1 ? "s" : ""}</>}
                </span>
              </>
            ) : (
              <>
                <span className={`gb-card-title gb-bs-${statusCls}`}>{branch.name}</span>
                <span className="gb-card-subtitle">
                  {commitCount > 0 ? `${commitCount} commit${commitCount !== 1 ? "s" : ""}` : "no commits"}
                </span>
              </>
            )}
          </div>
          {/* PR badges */}
          <div className="gb-card-badges">
            {mrUrls.map((url) => (
              <MrBadge key={url} url={url} status={branch.linkedMrStatuses[url]} className="gb-card-mr" />
            ))}
          </div>
          <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} className="gb-card-chevron" />
        </div>

        {/* Expanded commits */}
        {expanded && commitCount > 0 && (
          <div className="gb-card-commits">
            {branch.commits.map((commit) => (
              <div key={commit.cliId} className={`gb-card-commit${commit.conflicted ? " conflicted" : ""}`}>
                <span className="gb-card-commit-sha">{commit.commitId.slice(0, 7)}</span>
                <span className="gb-card-commit-msg">{firstLine(commit.message)}</span>
              </div>
            ))}
            {branch.upstreamCommits.length > 0 && (
              <div className="gb-card-commit gb-card-commit-upstream">
                <Icon name="arrow-down" size={10} />
                <span>{branch.upstreamCommits.length} upstream commit{branch.upstreamCommits.length !== 1 ? "s" : ""}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="gb-flow-connector" />
    </>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function firstLine(msg: string): string {
  return msg.split("\n")[0].slice(0, 80);
}

function branchStatusClass(status: string, hasConflicts: boolean): string {
  if (hasConflicts) return "conflicted";
  if (status === "integrated" || status === "nothingToPush") return "pushed";
  if (status === "completelyUnpushed") return "unpushed";
  if (status === "unpushedCommitsRequiringForce") return "force";
  return "default";
}
