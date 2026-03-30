import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from "react";
import type { Project, ProjectDashboard, PullResult, DashboardStack, DashboardBranch, ButChange, ButCommit, LinkedSession, MrStatus } from "../api";
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
  projects: Project[];
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
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [pullResults, setPullResults] = useState<PullResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Data fetching ──────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    try {
      if (mode === "project" && projectId) {
        const data = await fetchGitButlerStatus(projectId);
        setDashboards([data]);
      } else {
        const data = await fetchAllGitButlerStatus();
        setDashboards(data);
      }
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [mode, projectId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Pull action ────────────────────────────────────────────────

  const handlePull = useCallback(async () => {
    setPulling(true);
    setPullResults(null);
    try {
      let results: PullResult[];
      if (mode === "project" && projectId) {
        const r = await gitButlerPull(projectId);
        results = [r];
      } else {
        results = await gitButlerPullAll();
      }
      setPullResults(results);
      // Refresh dashboard data after pull
      await fetchData();
    } catch (e: any) {
      setPullResults([{
        projectId: 0,
        projectName: "Unknown",
        success: false,
        hasConflicts: false,
        error: e.message,
      }]);
    } finally {
      setPulling(false);
    }
  }, [mode, projectId, fetchData]);

  // Expose pull to parent via ref
  useImperativeHandle(ref, () => ({
    triggerPull: handlePull,
  }), [handlePull]);

  // ── Dismiss pull results ───────────────────────────────────────

  const dismissPullResults = useCallback(() => setPullResults(null), []);

  // ── Render ─────────────────────────────────────────────────────

  const title = mode === "project" && dashboards.length === 1
    ? dashboards[0].projectName
    : "All Projects";

  const upstreamCount = dashboards.reduce((sum, d) =>
    sum + (d.pullCheck?.upstreamCommits?.count ?? 0), 0);

  return (
    <main className="main-content">
      <div className="gb-dashboard">
        {/* Header */}
        <div className="gb-header">
          <button
            className="sidebar-open-btn"
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
          >
            <Icon name="menu" size={20} />
          </button>
          <Icon name="git-branch" size={18} />
          <h2>{title}</h2>
          <div className="gb-header-spacer" />
          <button
            className="btn btn-secondary gb-header-btn"
            onClick={fetchData}
            disabled={loading}
            title="Refresh (fetches latest status)"
          >
            <Icon name="refresh-cw" size={14} />
          </button>
          <button
            className={`btn btn-primary gb-header-btn${upstreamCount > 0 ? " gb-pull-available" : ""}`}
            onClick={handlePull}
            disabled={pulling}
            title={`Pull${upstreamCount > 0 ? ` (${upstreamCount} upstream commits)` : ""}`}
          >
            {pulling ? (
              <><Icon name="loader" size={14} /> Pulling…</>
            ) : (
              <><Icon name="arrow-down" size={14} /> Pull{upstreamCount > 0 ? ` (${upstreamCount})` : ""}</>
            )}
          </button>
          <button className="icon-btn" onClick={onClose} title="Close dashboard">
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Pull results banner */}
        {pullResults && (
          <PullResultsBanner results={pullResults} onDismiss={dismissPullResults} />
        )}

        {/* Body */}
        <div className="gb-body">
          {loading && dashboards.length === 0 && (
            <div className="gb-loading">Loading GitButler status…</div>
          )}
          {error && (
            <div className="gb-error"><Icon name="alert-circle" size={14} /> {error}</div>
          )}
          {dashboards.map((dashboard) => (
            <ProjectCard
              key={dashboard.projectId}
              dashboard={dashboard}
              showProjectName={mode === "all"}
              onNavigateToSession={onNavigateToSession}
            />
          ))}
          {!loading && dashboards.length === 0 && !error && (
            <div className="gb-empty">No projects configured.</div>
          )}
        </div>
      </div>
    </main>
  );
});

export default GitButlerDashboard;

// ── Pull Results Banner ─────────────────────────────────────────

function PullResultsBanner({ results, onDismiss }: { results: PullResult[]; onDismiss: () => void }) {
  const hasErrors = results.some((r) => !r.success);
  const hasConflicts = results.some((r) => r.hasConflicts);

  return (
    <div className={`gb-pull-banner ${hasErrors ? "error" : hasConflicts ? "warning" : "success"}`}>
      <div className="gb-pull-banner-content">
        {results.map((r) => (
          <div key={r.projectId} className="gb-pull-result-row">
            <span className="gb-pull-project-name">{r.projectName}</span>
            {r.success && !r.hasConflicts && (
              <span className="gb-pull-status success"><Icon name="check" size={12} /> Up to date</span>
            )}
            {r.success && r.hasConflicts && (
              <span className="gb-pull-status warning"><Icon name="alert-triangle" size={12} /> Pulled with conflicts</span>
            )}
            {!r.success && (
              <span className="gb-pull-status error"><Icon name="x-circle" size={12} /> {r.error}</span>
            )}
          </div>
        ))}
      </div>
      <button className="icon-btn" onClick={onDismiss}><Icon name="x" size={14} /></button>
    </div>
  );
}

// ── Project Card ────────────────────────────────────────────────

function ProjectCard({
  dashboard,
  showProjectName,
  onNavigateToSession,
}: {
  dashboard: ProjectDashboard;
  showProjectName: boolean;
  onNavigateToSession: (sessionId: number) => void;
}) {
  const totalChanges = dashboard.unassignedChanges.length +
    dashboard.stacks.reduce((s, st) => s + st.assignedChanges.length, 0);

  return (
    <div className="gb-project-card">
      {showProjectName && (
        <div className="gb-project-header">
          <Icon name="folder" size={14} />
          <span className="gb-project-name">{dashboard.projectName}</span>
          {dashboard.pullCheck && !dashboard.pullCheck.upToDate && (
            <span className="gb-upstream-badge" title={`${dashboard.pullCheck.upstreamCommits.count} upstream commits`}>
              ↓ {dashboard.pullCheck.upstreamCommits.count}
            </span>
          )}
        </div>
      )}

      {dashboard.error && (
        <div className="gb-project-error">
          <Icon name="alert-circle" size={13} /> {dashboard.error}
        </div>
      )}

      {!showProjectName && dashboard.pullCheck && !dashboard.pullCheck.upToDate && (
        <div className="gb-upstream-info">
          <Icon name="arrow-down" size={13} />
          <span>{dashboard.pullCheck.upstreamCommits.count} upstream commit(s) available</span>
        </div>
      )}

      {dashboard.stacks.length === 0 && !dashboard.error && (
        <div className="gb-no-stacks">No active branches</div>
      )}

      {dashboard.stacks.map((stack) => (
        <StackCard key={stack.cliId} stack={stack} onNavigateToSession={onNavigateToSession} />
      ))}

      {dashboard.unassignedChanges.length > 0 && (
        <div className="gb-unassigned">
          <div className="gb-unassigned-header">
            <Icon name="file-question" size={13} />
            <span>Unassigned changes</span>
            <span className="gb-change-count">{dashboard.unassignedChanges.length} file(s)</span>
          </div>
          <div className="gb-file-list">
            {dashboard.unassignedChanges.map((c) => (
              <FileRow key={c.cliId} change={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stack Card ──────────────────────────────────────────────────

function StackCard({
  stack,
  onNavigateToSession,
}: {
  stack: DashboardStack;
  onNavigateToSession: (sessionId: number) => void;
}) {
  return (
    <div className="gb-stack">
      {stack.branches.map((branch, i) => (
        <BranchCard
          key={branch.cliId}
          branch={branch}
          isStacked={stack.branches.length > 1}
          stackPosition={i}
          onNavigateToSession={onNavigateToSession}
        />
      ))}
      {stack.assignedChanges.length > 0 && (
        <div className="gb-stack-changes">
          <span className="gb-change-count">{stack.assignedChanges.length} staged file(s)</span>
        </div>
      )}
    </div>
  );
}

// ── Branch Card ─────────────────────────────────────────────────

function BranchCard({
  branch,
  isStacked,
  stackPosition,
  onNavigateToSession,
}: {
  branch: DashboardBranch;
  isStacked: boolean;
  stackPosition: number;
  onNavigateToSession: (sessionId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const commitCount = branch.commits.length;
  const latestCommit = branch.commits[0] ?? null;
  const hasConflicts = branch.commits.some((c) => c.conflicted);

  const statusClass =
    hasConflicts ? "conflicted" :
    branch.branchStatus === "integrated" ? "integrated" :
    branch.branchStatus === "nothingToPush" ? "local" :
    "default";

  return (
    <div className={`gb-branch gb-branch-${statusClass}`}>
      <div className="gb-branch-header" onClick={() => setExpanded(!expanded)}>
        {isStacked && (
          <span className="gb-stack-indicator" title={`Stacked branch (position ${stackPosition + 1})`}>
            {stackPosition === 0 ? "┌" : "├"}
          </span>
        )}
        <Icon name="git-branch" size={14} className="gb-branch-icon" />
        <span className="gb-branch-name">{branch.name}</span>
        <BranchStatusBadge status={branch.branchStatus} hasConflicts={hasConflicts} />
        {commitCount > 0 && (
          <span className="gb-commit-count" title={`${commitCount} commit(s)`}>
            {commitCount}c
          </span>
        )}
        <div className="gb-branch-spacer" />

        {/* MR links */}
        {branch.linkedMrUrls.map((url) => {
          const status = branch.linkedMrStatuses[url];
          return (
            <MrBadge key={url} url={url} status={status ?? undefined} />
          );
        })}

        {/* Linked session */}
        {branch.linkedSession && (
          <button
            className="gb-session-link"
            title={`Go to session: ${branch.linkedSession.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToSession(branch.linkedSession!.id);
            }}
          >
            <Icon name="terminal" size={11} />
            <span>{branch.linkedSession.name}</span>
          </button>
        )}

        <span className={`gb-expand-icon ${expanded ? "expanded" : ""}`}>
          <Icon name="chevron-right" size={14} />
        </span>
      </div>

      {!expanded && latestCommit && (
        <div className="gb-branch-summary">
          <span className="gb-commit-msg-preview">{firstLine(latestCommit.message)}</span>
        </div>
      )}

      {expanded && (
        <div className="gb-commit-list">
          {branch.commits.map((commit) => (
            <CommitRow key={commit.cliId} commit={commit} />
          ))}
          {branch.upstreamCommits.length > 0 && (
            <div className="gb-upstream-commits">
              <span className="gb-upstream-label">↓ {branch.upstreamCommits.length} upstream</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Branch status badge ─────────────────────────────────────────

function BranchStatusBadge({ status, hasConflicts }: { status: string; hasConflicts: boolean }) {
  if (hasConflicts) {
    return <span className="gb-status-badge conflicted" title="Has conflicts"><Icon name="alert-triangle" size={11} /> conflict</span>;
  }

  switch (status) {
    case "integrated":
      return <span className="gb-status-badge integrated" title="Pushed to remote"><Icon name="check" size={11} /> pushed</span>;
    case "nothingToPush":
      return <span className="gb-status-badge local" title="Local only">local</span>;
    default:
      return <span className="gb-status-badge default">{status}</span>;
  }
}

// ── MR badge ────────────────────────────────────────────────────

function MrBadge({ url, status }: { url: string; status?: MrStatus }) {
  const statusClass = getMrStatusClass(status);
  const tooltip = status ? `${url}\n${getMrStatusTooltip(status)}` : url;

  return (
    <a
      className={`gb-mr-badge mr-status-${statusClass}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip}
      onClick={(e) => e.stopPropagation()}
    >
      {getMrLabel(url)}
    </a>
  );
}

// ── Commit Row ──────────────────────────────────────────────────

function CommitRow({ commit }: { commit: ButCommit }) {
  return (
    <div className={`gb-commit ${commit.conflicted ? "conflicted" : ""}`}>
      <span className="gb-commit-sha">{commit.commitId.slice(0, 7)}</span>
      <span className="gb-commit-msg">{firstLine(commit.message)}</span>
      {commit.conflicted && (
        <span className="gb-conflict-icon" title="Conflicted"><Icon name="alert-triangle" size={11} /></span>
      )}
      <span className="gb-commit-author">{commit.authorName}</span>
      <span className="gb-commit-date">{formatRelativeTime(commit.createdAt)}</span>
    </div>
  );
}

// ── File Row ────────────────────────────────────────────────────

function FileRow({ change }: { change: ButChange }) {
  const typeIcon = change.changeType === "added" ? "plus" :
    change.changeType === "deleted" ? "minus" : "edit-3";
  return (
    <div className="gb-file-row">
      <Icon name={typeIcon} size={11} className={`gb-file-icon gb-file-${change.changeType}`} />
      <span className="gb-file-path">{change.filePath}</span>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

function firstLine(msg: string): string {
  return msg.split("\n")[0].slice(0, 80);
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
