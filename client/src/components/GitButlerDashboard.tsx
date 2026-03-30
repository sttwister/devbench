import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from "react";
import type { ProjectDashboard, PullResult, DashboardStack, DashboardBranch, ButChange, ButCommit, MergeResult } from "../api";
import { fetchGitButlerStatus, fetchAllGitButlerStatus, gitButlerPull, gitButlerPullAll, mergeMrs, getSessionIcon } from "../api";
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
  const [mergeResults, setMergeResults] = useState<MergeResult[] | null>(null);
  const [mergePullResults, setMergePullResults] = useState<PullResult[] | null>(null);
  const [mergingUrls, setMergingUrls] = useState<Set<string>>(new Set());
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

  const handleMerge = useCallback(async (urls: string[]) => {
    setMergeResults(null);
    setMergePullResults(null);
    setMergingUrls(new Set(urls));
    try {
      const { mergeResults: results, pullResults: pulls } = await mergeMrs(urls);
      setMergeResults(results);
      setMergePullResults(pulls);
      await fetchData(true);
    } catch (e: any) {
      setMergeResults(urls.map((url) => ({ url, outcome: "error" as const, message: e.message })));
    } finally {
      setMergingUrls(new Set());
    }
  }, [fetchData]);

  useImperativeHandle(ref, () => ({ triggerPull: handlePull }), [handlePull]);

  const projectName = mode === "project" && projectId
    ? projects.find((p) => p.id === projectId)?.name ?? null
    : null;
  const title = projectName ?? (mode === "project" ? "Project" : "All Projects");

  const upstreamCount = dashboards.reduce((sum, d) =>
    sum + (d.pullCheck?.upstreamCommits?.count ?? 0), 0);

  const isMerging = mergingUrls.size > 0;

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

        {/* Banners */}
        {mergeResults && (
          <MergeResultsBanner
            results={mergeResults}
            pullResults={mergePullResults}
            onDismiss={() => { setMergeResults(null); setMergePullResults(null); }}
          />
        )}
        {pullResults && <PullResultsBanner results={pullResults} onDismiss={() => setPullResults(null)} />}

        {/* Body — side-by-side when multiple projects */}
        <div className={`gb-body ${dashboards.length > 1 ? "gb-body-multi" : ""}`}>
          {error && <div className="gb-error"><Icon name="alert-circle" size={14} /> {error}</div>}
          {dashboards.map((d) => (
            <ProjectFlow
              key={d.projectId}
              dashboard={d}
              showName={mode === "all"}
              onNavigateToSession={onNavigateToSession}
              onMerge={handleMerge}
              mergingUrls={mergingUrls}
            />
          ))}
          {dashboards.length === 0 && !error && <div className="gb-loading">Loading GitButler status…</div>}
        </div>
      </div>
    </main>
  );
});

export default GitButlerDashboard;

// ── Merge Results Banner ────────────────────────────────────────

function MergeResultsBanner({
  results,
  pullResults,
  onDismiss,
}: {
  results: MergeResult[];
  pullResults: PullResult[] | null;
  onDismiss: () => void;
}) {
  const hasError = results.some((r) => r.outcome === "error");
  const hasAutoMerge = results.some((r) => r.outcome === "auto-merge");
  const cls = hasError ? "error" : hasAutoMerge ? "info" : "success";
  return (
    <div className={`gb-pull-banner ${cls}`}>
      <div className="gb-pull-banner-content">
        {results.map((r) => (
          <div key={r.url} className="gb-pull-result-row">
            <span className="gb-pull-project-name">{shortMrLabel(r.url)}</span>
            {r.outcome === "merged" && <span className="gb-pull-ok"><Icon name="check" size={12} /> {r.message}</span>}
            {r.outcome === "auto-merge" && <span className="gb-pull-auto"><Icon name="loader" size={12} /> {r.message}</span>}
            {r.outcome === "error" && <span className="gb-pull-err"><Icon name="x-circle" size={12} /> {r.message}</span>}
          </div>
        ))}
        {pullResults && pullResults.length > 0 && (
          <div className="gb-merge-pull-note">
            <Icon name="arrow-down" size={11} />
            <span>Pulled {pullResults.length} project{pullResults.length !== 1 ? "s" : ""} after merge</span>
          </div>
        )}
      </div>
      <button className="icon-btn" onClick={onDismiss}><Icon name="x" size={14} /></button>
    </div>
  );
}

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
  onMerge,
  mergingUrls,
}: {
  dashboard: ProjectDashboard;
  showName: boolean;
  onNavigateToSession: (sessionId: number) => void;
  onMerge: (urls: string[]) => void;
  mergingUrls: Set<string>;
}) {
  const hasUnassigned = d.unassignedChanges.length > 0;
  const allBranches = d.stacks.flatMap((s) => s.branches);
  const hasContent = allBranches.length > 0 || hasUnassigned;

  // For stacked branches, compute cumulative merge URLs per branch.
  // Branch at index 0 is the top of stack; last index is the base.
  // Merging a top branch should also auto-merge all branches below it.
  //
  // Uses `reviewUrls` (branch's own PRs from `but branch list --review`)
  // for stack accumulation — NOT `linkedMrUrls` which includes session MRs
  // that may belong to other branches.
  // Additionally, each branch's own session-only MR URLs (cross-repo MRs)
  // are included so a single merge button can merge across repos.
  const stackMergeMap = new Map<string, string[]>();
  for (const stack of d.stacks) {
    const { branches } = stack;
    // Collect all review URLs in this stack (to identify session-only URLs)
    const allReviewUrls = new Set(branches.flatMap((b) => b.reviewUrls));

    // Accumulate review URLs bottom-up
    const seen = new Set<string>();
    const cumulativeFromBottom: Set<string>[] = [];
    for (let i = branches.length - 1; i >= 0; i--) {
      const b = branches[i];
      for (const url of b.reviewUrls) {
        if (isOpenMr(url, b.linkedMrStatuses)) seen.add(url);
      }
      cumulativeFromBottom[i] = new Set(seen);
    }

    // For each branch, add its session-only URLs (cross-repo MRs not in any branch's reviewUrls)
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      const mergeSet = new Set(cumulativeFromBottom[i]);
      for (const url of b.linkedMrUrls) {
        if (!allReviewUrls.has(url) && isOpenMr(url, b.linkedMrStatuses)) {
          mergeSet.add(url);
        }
      }
      stackMergeMap.set(b.cliId, [...mergeSet]);
    }
  }

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
            <BranchCard
              key={branch.cliId}
              branch={branch}
              stackMergeUrls={stackMergeMap.get(branch.cliId) ?? []}
              onNavigateToSession={onNavigateToSession}
              onMerge={onMerge}
              mergingUrls={mergingUrls}
            />
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
  stackMergeUrls,
  onNavigateToSession,
  onMerge,
  mergingUrls,
}: {
  branch: DashboardBranch;
  /** Open MR URLs to merge: this branch + all branches below it in the stack. */
  stackMergeUrls: string[];
  onNavigateToSession: (sessionId: number) => void;
  onMerge: (urls: string[]) => void;
  mergingUrls: Set<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasConflicts = branch.commits.some((c) => c.conflicted);
  const commitCount = branch.commits.length;
  const mrUrls = branch.linkedMrUrls;
  const session = branch.linkedSession;
  const statusCls = branchStatusClass(branch.branchStatus, hasConflicts);

  // Merge button uses stack-aware URLs (includes branches below in same stack)
  const isMergingThis = stackMergeUrls.some((u) => mergingUrls.has(u));
  const allApproved = stackMergeUrls.length > 0 && stackMergeUrls.every((url) => {
    const st = branch.linkedMrStatuses[url];
    // For URLs from branches below, we don't have status in this branch's map —
    // treat unknown status as "not yet approved" (conservative)
    return st?.approved;
  });

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

        {/* Merge button */}
        {stackMergeUrls.length > 0 && (
          <div className="gb-card-actions">
            <button
              className={`gb-merge-btn${allApproved ? " gb-merge-ready" : ""}`}
              onClick={() => onMerge(stackMergeUrls)}
              disabled={isMergingThis}
              title={
                isMergingThis ? "Merging…" :
                allApproved ? `Merge ${stackMergeUrls.length} MR${stackMergeUrls.length !== 1 ? "s" : ""}` :
                `Merge when pipelines succeed (${stackMergeUrls.length} MR${stackMergeUrls.length !== 1 ? "s" : ""})`
              }
            >
              {isMergingThis ? (
                <><Icon name="loader" size={12} /> Merging…</>
              ) : (
                <><Icon name="git-merge" size={12} /> Merge{stackMergeUrls.length > 1 ? ` (${stackMergeUrls.length})` : ""}</>
              )}
            </button>
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

/** Check if a MR URL is open (not merged/closed) based on known statuses. */
function isOpenMr(url: string, statuses: Record<string, import("../api").MrStatus>): boolean {
  const st = statuses[url];
  return !st || (st.state !== "merged" && st.state !== "closed");
}

/** Short label for a MR URL, e.g. "repo#42" or "group/repo!42" */
function shortMrLabel(url: string): string {
  const gh = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (gh) return `${gh[1]}#${gh[2]}`;
  const gl = url.match(/([^/]+)\/-\/merge_requests\/(\d+)/);
  if (gl) return `${gl[1]}!${gl[2]}`;
  return url;
}
