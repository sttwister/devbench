// @lat: [[gitbutler#Dashboard UI]]
import { useState, useEffect, useCallback, useImperativeHandle, forwardRef, useRef } from "react";
import type { ProjectDashboard, PullResult, DashboardStack, DashboardBranch, ButChange, ButCommit, MergeResult, PushResult, UnapplyResult, MrStatus } from "../api";
import { fetchGitButlerStatus, fetchAllGitButlerStatus, gitButlerPull, gitButlerPullAll, mergeMrs, pushBranch, pushAll, unapplyBranch, getSessionIcon } from "../api";
import Icon from "./Icon";
import MrBadge from "./MrBadge";
import DiffViewer from "./DiffViewer";
import type { DiffTarget } from "./DiffViewer";
import { useMrStatus } from "../contexts/MrStatusContext";
import ConfirmPopup from "./ConfirmPopup";

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
  const [pushing, setPushing] = useState(false);
  const [pushResults, setPushResults] = useState<PushResult[] | null>(null);
  const [pushingBranches, setPushingBranches] = useState<Set<string>>(new Set());
  const [unapplyResults, setUnapplyResults] = useState<UnapplyResult[] | null>(null);
  const [unapplyingBranches, setUnapplyingBranches] = useState<Set<string>>(new Set());
  const [pullingProjects, setPullingProjects] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

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

  // ── "Q" to close dashboard (when diff viewer is not open) ─────
  useEffect(() => {
    if (diffTarget) return; // diff viewer handles its own keys
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "q") {
        onClose();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [diffTarget, onClose]);

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

  const handleMerge = useCallback(async (urls: string[], pullProjectId?: number) => {
    setMergeResults(null);
    setMergePullResults(null);
    setMergingUrls(new Set(urls));
    try {
      const { mergeResults: results, pullResults: pulls } = await mergeMrs(urls, pullProjectId);
      setMergeResults(results);
      setMergePullResults(pulls);
      await fetchData(true);
    } catch (e: any) {
      setMergeResults(urls.map((url) => ({ url, outcome: "error" as const, message: e.message })));
    } finally {
      setMergingUrls(new Set());
    }
  }, [fetchData]);

  const handlePushAll = useCallback(async () => {
    setPushing(true);
    setPushResults(null);
    try {
      const results = await pushAll();
      setPushResults(results);
      await fetchData(true);
    } catch (e: any) {
      setPushResults([{ projectId: 0, projectName: "Unknown", branchName: "unknown", success: false, error: e.message }]);
    } finally {
      setPushing(false);
    }
  }, [fetchData]);

  const handlePushBranch = useCallback(async (projectId: number, branchName: string, force: boolean) => {
    setPushingBranches((prev) => new Set(prev).add(branchName));
    setPushResults(null);
    try {
      const result = await pushBranch(projectId, branchName, force);
      setPushResults([result]);
      await fetchData(true);
    } catch (e: any) {
      setPushResults([{ projectId, projectName: "Unknown", branchName, success: false, error: e.message }]);
    } finally {
      setPushingBranches((prev) => { const s = new Set(prev); s.delete(branchName); return s; });
    }
  }, [fetchData]);

  const handleUnapplyBranch = useCallback(async (projectId: number, branchName: string) => {
    setUnapplyingBranches((prev) => new Set(prev).add(branchName));
    setUnapplyResults(null);
    try {
      const result = await unapplyBranch(projectId, branchName);
      setUnapplyResults([result]);
      await fetchData(true);
    } catch (e: any) {
      setUnapplyResults([{ projectId, projectName: "Unknown", branchName, success: false, error: e.message }]);
    } finally {
      setUnapplyingBranches((prev) => { const s = new Set(prev); s.delete(branchName); return s; });
    }
  }, [fetchData]);

  const handlePullProject = useCallback(async (projectId: number) => {
    setPullingProjects((prev) => new Set(prev).add(projectId));
    setPullResults(null);
    try {
      const result = await gitButlerPull(projectId);
      setPullResults([result]);
      await fetchData();
    } catch (e: any) {
      setPullResults([{ projectId, projectName: "Unknown", success: false, hasConflicts: false, error: e.message }]);
    } finally {
      setPullingProjects((prev) => { const s = new Set(prev); s.delete(projectId); return s; });
    }
  }, [fetchData]);

  useImperativeHandle(ref, () => ({ triggerPull: handlePull }), [handlePull]);

  const projectName = mode === "project" && projectId
    ? projects.find((p) => p.id === projectId)?.name ?? null
    : null;
  const title = projectName ?? (mode === "project" ? "Project" : "All Projects");

  const upstreamCount = dashboards.reduce((sum, d) =>
    sum + (d.pullCheck?.upstreamCommits?.count ?? 0), 0);

  const { statuses: topMrStatuses } = useMrStatus();
  const pushableCount = dashboards.reduce((sum, d) =>
    sum + d.stacks.reduce((ss, s) =>
      ss + s.branches.filter((b) => {
        if (!isPushable(b.branchStatus)) return false;
        // Exclude branches whose MR is already merged
        const urls = b.linkedMrUrls;
        if (urls.length > 0 && urls.every((url) => topMrStatuses[url]?.state === "merged")) return false;
        return true;
      }).length, 0), 0);

  const isMerging = mergingUrls.size > 0;

  // Diff viewer overlay
  if (diffTarget) {
    return (
      <main className="main-content">
        <DiffViewer diffTarget={diffTarget} onClose={() => setDiffTarget(null)} />
      </main>
    );
  }

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
          {pushableCount > 0 && (
            <button
              className="btn btn-secondary gb-header-btn"
              onClick={handlePushAll}
              disabled={pushing}
              title={`Push ${pushableCount} branch${pushableCount !== 1 ? "es" : ""}`}
            >
              {pushing
                ? <><Icon name="loader" size={14} /> Pushing…</>
                : <><Icon name="arrow-up" size={14} /> Push ({pushableCount})</>}
            </button>
          )}
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
        {pushResults && <PushResultsBanner results={pushResults} onDismiss={() => setPushResults(null)} />}
        {unapplyResults && <UnapplyResultsBanner results={unapplyResults} onDismiss={() => setUnapplyResults(null)} />}
        {pullResults && <PullResultsBanner results={pullResults} onDismiss={() => setPullResults(null)} />}

        {/* Body — side-by-side when multiple projects */}
        <div ref={bodyRef} className={`gb-body ${dashboards.length > 1 ? "gb-body-multi" : ""}`}>
          {error && <div className="gb-error"><Icon name="alert-circle" size={14} /> {error}</div>}
          {dashboards.map((d) => (
            <ProjectFlow
              key={d.projectId}
              dashboard={d}
              showName={mode === "all"}
              onNavigateToSession={onNavigateToSession}
              onMerge={handleMerge}
              mergingUrls={mergingUrls}
              onPushBranch={handlePushBranch}
              pushingBranches={pushingBranches}
              onUnapplyBranch={handleUnapplyBranch}
              unapplyingBranches={unapplyingBranches}
              onPullProject={handlePullProject}
              pullingProjects={pullingProjects}
              onViewDiff={setDiffTarget}
            />
          ))}
          {dashboards.length === 0 && !error && <div className="gb-loading">Loading GitButler status…</div>}
          {dashboards.length > 1 && <SessionConnectors containerRef={bodyRef} dashboards={dashboards} />}
        </div>

        {/* Legend */}
        {dashboards.length > 0 && <DashboardLegend />}
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

// ── Unapply Results Banner ───────────────────────────────────────

function UnapplyResultsBanner({ results, onDismiss }: { results: UnapplyResult[]; onDismiss: () => void }) {
  const cls = results.some((r) => !r.success) ? "error" : "success";
  return (
    <div className={`gb-pull-banner ${cls}`}>
      <div className="gb-pull-banner-content">
        {results.map((r) => (
          <div key={`${r.projectId}-${r.branchName}`} className="gb-pull-result-row">
            <span className="gb-pull-project-name">{r.branchName}</span>
            {r.success
              ? <span className="gb-pull-ok"><Icon name="check" size={12} /> Unapplied</span>
              : <span className="gb-pull-err"><Icon name="x-circle" size={12} /> {r.error}</span>}
          </div>
        ))}
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

// ── Push Results Banner ──────────────────────────────────────────

function PushResultsBanner({ results, onDismiss }: { results: PushResult[]; onDismiss: () => void }) {
  const cls = results.some((r) => !r.success) ? "error" : "success";
  return (
    <div className={`gb-pull-banner ${cls}`}>
      <div className="gb-pull-banner-content">
        {results.map((r) => (
          <div key={`${r.projectId}-${r.branchName}`} className="gb-pull-result-row">
            <span className="gb-pull-project-name">{r.branchName}</span>
            {r.success
              ? <span className="gb-pull-ok"><Icon name="check" size={12} /> Pushed</span>
              : <span className="gb-pull-err"><Icon name="x-circle" size={12} /> {r.error}</span>}
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
  onPushBranch,
  pushingBranches,
  onUnapplyBranch,
  unapplyingBranches,
  onPullProject,
  pullingProjects,
  onViewDiff,
}: {
  dashboard: ProjectDashboard;
  showName: boolean;
  onNavigateToSession: (sessionId: number) => void;
  onMerge: (urls: string[], pullProjectId?: number) => void;
  mergingUrls: Set<string>;
  onPushBranch: (projectId: number, branchName: string, force: boolean) => void;
  pushingBranches: Set<string>;
  onUnapplyBranch: (projectId: number, branchName: string) => void;
  unapplyingBranches: Set<string>;
  onPullProject: (projectId: number) => void;
  pullingProjects: Set<number>;
  onViewDiff: (target: DiffTarget) => void;
}) {
  const hasUnassigned = d.unassignedChanges.length > 0;
  const allBranches = d.stacks.flatMap((s) => s.branches);
  const hasContent = allBranches.length > 0 || hasUnassigned;

  // For stacked branches, compute cumulative merge URLs per branch.
  // Branch at index 0 is the top of stack; last index is the base.
  // Merging a top branch should also auto-merge all branches below it.
  const { statuses: mrStatuses } = useMrStatus();
  const stackMergeMap = new Map<string, string[]>();
  for (const stack of d.stacks) {
    const { branches } = stack;
    const allReviewUrls = new Set(branches.flatMap((b) => b.reviewUrls));

    const seen = new Set<string>();
    const cumulativeFromBottom: Set<string>[] = [];
    for (let i = branches.length - 1; i >= 0; i--) {
      const b = branches[i];
      for (const url of b.reviewUrls) {
        if (isOpenMr(url, mrStatuses)) seen.add(url);
      }
      cumulativeFromBottom[i] = new Set(seen);
    }

    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      const mergeSet = new Set(cumulativeFromBottom[i]);
      for (const url of b.linkedMrUrls) {
        if (!allReviewUrls.has(url) && isOpenMr(url, mrStatuses)) {
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
          <button
            className={`gb-project-pull-btn${d.pullCheck && !d.pullCheck.upToDate ? " gb-pull-available" : ""}`}
            onClick={() => onPullProject(d.projectId)}
            disabled={pullingProjects.has(d.projectId)}
            title={`Pull${d.pullCheck && !d.pullCheck.upToDate ? ` (${d.pullCheck.upstreamCommits.count} upstream)` : ""}`}
          >
            {pullingProjects.has(d.projectId)
              ? <Icon name="loader" size={12} />
              : <Icon name="arrow-down" size={12} />}
          </button>
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
          {hasUnassigned && (
            <UnassignedCard
              changes={d.unassignedChanges}
              onViewDiff={() => onViewDiff({ projectId: d.projectId, label: "Unstaged changes" })}
            />
          )}

          {/* Stacks — each rendered as a visual group */}
          {d.stacks.map((stack, si) => {
            const isMulti = stack.branches.length > 1;
            return (
              <div key={stack.cliId} className="gb-stack-group">
                {/* Connector from trunk into this stack */}
                {(si > 0 || hasUnassigned) && <div className="gb-flow-connector" />}

                {isMulti ? (
                  /* Stacked branches: grouped visually */
                  <div className="gb-stack-frame">
                    {stack.branches.map((branch, bi) => (
                      <div key={branch.cliId} className="gb-stack-item">
                        {bi > 0 && <div className="gb-stack-connector" />}
                        <BranchCard
                          branch={branch}
                          projectId={d.projectId}
                          stackMergeUrls={stackMergeMap.get(branch.cliId) ?? []}
                          onNavigateToSession={onNavigateToSession}
                          onMerge={onMerge}
                          mergingUrls={mergingUrls}
                          onPushBranch={onPushBranch}
                          pushingBranches={pushingBranches}
                          onUnapplyBranch={onUnapplyBranch}
                          unapplyingBranches={unapplyingBranches}
                          onViewDiff={onViewDiff}
                          inStack
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Single branch: plain card */
                  <BranchCard
                    branch={stack.branches[0]}
                    projectId={d.projectId}
                    stackMergeUrls={stackMergeMap.get(stack.branches[0].cliId) ?? []}
                    onNavigateToSession={onNavigateToSession}
                    onMerge={onMerge}
                    mergingUrls={mergingUrls}
                    onPushBranch={onPushBranch}
                    pushingBranches={pushingBranches}
                    onUnapplyBranch={onUnapplyBranch}
                    unapplyingBranches={unapplyingBranches}
                    onViewDiff={onViewDiff}
                  />
                )}
              </div>
            );
          })}

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

function UnassignedCard({ changes, onViewDiff }: { changes: ButChange[]; onViewDiff: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className="gb-card gb-card-unassigned" onClick={() => setExpanded(!expanded)}>
        <div className="gb-card-header">
          <div className="gb-card-header-row">
            <span className="gb-card-icon gb-card-icon-warn">
              <Icon name="alert-circle" size={14} />
            </span>
            <div className="gb-card-title-block">
              <span className="gb-card-title">Unstaged changes</span>
              <span className="gb-card-subtitle">{changes.length} file(s)</span>
            </div>
            <button
              className="gb-diff-btn"
              onClick={(e) => { e.stopPropagation(); onViewDiff(); }}
              title="View diff"
            >
              <Icon name="file-diff" size={12} /> Diff
            </button>
            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} className="gb-card-chevron" />
          </div>
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
    </>
  );
}

// ── Branch Card ─────────────────────────────────────────────────

function BranchCard({
  branch,
  projectId,
  stackMergeUrls,
  onNavigateToSession,
  onMerge,
  mergingUrls,
  onPushBranch,
  pushingBranches,
  onUnapplyBranch,
  unapplyingBranches,
  onViewDiff,
  inStack,
}: {
  branch: DashboardBranch;
  projectId: number;
  /** Open MR URLs to merge: this branch + all branches below it in the stack. */
  stackMergeUrls: string[];
  onNavigateToSession: (sessionId: number) => void;
  onMerge: (urls: string[], pullProjectId?: number) => void;
  mergingUrls: Set<string>;
  onPushBranch: (projectId: number, branchName: string, force: boolean) => void;
  pushingBranches: Set<string>;
  onUnapplyBranch: (projectId: number, branchName: string) => void;
  unapplyingBranches: Set<string>;
  onViewDiff: (target: DiffTarget) => void;
  /** Whether this card is inside a multi-branch stack group. */
  inStack?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showUnapplyConfirm, setShowUnapplyConfirm] = useState(false);
  const [mergeDropdownOpen, setMergeDropdownOpen] = useState(false);
  const mergeDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!mergeDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (mergeDropdownRef.current && !mergeDropdownRef.current.contains(e.target as Node)) {
        setMergeDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mergeDropdownOpen]);
  const hasConflicts = branch.commits.some((c) => c.conflicted);
  const commitCount = branch.commits.length;
  const mrUrls = branch.linkedMrUrls;
  const session = branch.linkedSession;
  const { statuses: mrStatuses } = useMrStatus();

  // Detect "merged but not yet pulled": branch has MR(s) and all are merged
  const isMrMerged = mrUrls.length > 0 && mrUrls.every((url) => mrStatuses[url]?.state === "merged");
  const statusCls = branchStatusClass(branch.branchStatus, hasConflicts, isMrMerged);

  // Merge button uses stack-aware URLs (includes branches below in same stack)
  const isMergingThis = stackMergeUrls.some((u) => mergingUrls.has(u));
  const allApproved = stackMergeUrls.length > 0 && stackMergeUrls.every((url) => {
    return mrStatuses[url]?.approved;
  });

  return (
    <>
      <div
        className={`gb-card gb-card-branch gb-card-${statusCls}`}
        data-session-id={session?.id ?? undefined}
      >
        {/* Session header (primary) or branch-only header */}
        <div className="gb-card-header" onClick={() => setExpanded(!expanded)}>
          <div className="gb-card-header-row">
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
            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} className="gb-card-chevron" />
          </div>
          {/* PR badges — own row below title so names aren't truncated */}
          {mrUrls.length > 0 && (
            <div className="gb-card-badges">
              {mrUrls.map((url) => (
                <MrBadge key={url} url={url} className="gb-card-mr" />
              ))}
            </div>
          )}
        </div>

        {/* Expanded commits */}
        {expanded && commitCount > 0 && (
          <div className="gb-card-commits">
            {branch.commits.map((commit) => (
              <div
                key={commit.cliId}
                className={`gb-card-commit gb-card-commit-clickable${commit.conflicted ? " conflicted" : ""}`}
                onClick={() => onViewDiff({ projectId, target: commit.cliId, label: firstLine(commit.message) })}
                title="View commit diff"
              >
                <span className="gb-card-commit-sha">{commit.commitId.slice(0, 7)}</span>
                <span className="gb-card-commit-msg">{firstLine(commit.message)}</span>
                <Icon name="file-diff" size={11} className="gb-card-commit-diff-icon" />
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

        {/* Action buttons */}
        <div className="gb-card-actions">
            {stackMergeUrls.length > 0 && (
              <div className="gb-merge-split" ref={mergeDropdownRef}>
                <button
                  className={`gb-merge-btn gb-merge-btn-main${allApproved ? " gb-merge-ready" : ""}`}
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
                <button
                  className={`gb-merge-btn gb-merge-btn-dropdown${allApproved ? " gb-merge-ready" : ""}${mergeDropdownOpen ? " gb-merge-btn-dropdown-open" : ""}`}
                  onClick={() => setMergeDropdownOpen(!mergeDropdownOpen)}
                  disabled={isMergingThis}
                  title="More merge options"
                >
                  <Icon name="chevron-down" size={10} />
                </button>
                {mergeDropdownOpen && (
                  <div className="gb-merge-dropdown">
                    <button
                      className="gb-merge-dropdown-item"
                      onClick={() => {
                        setMergeDropdownOpen(false);
                        onMerge(stackMergeUrls, projectId);
                      }}
                    >
                      <Icon name="git-merge" size={12} />
                      <Icon name="arrow-down" size={12} />
                      <span>Merge &amp; Pull</span>
                    </button>
                  </div>
                )}
              </div>
            )}
            {isPushable(branch.branchStatus) && !isMrMerged && (
              <button
                className="gb-push-btn"
                onClick={() => onPushBranch(projectId, branch.name, branch.branchStatus === "unpushedCommitsRequiringForce")}
                disabled={pushingBranches.has(branch.name)}
                title={branch.branchStatus === "unpushedCommitsRequiringForce" ? "Force push" : "Push"}
              >
                {pushingBranches.has(branch.name) ? (
                  <><Icon name="loader" size={12} /> Pushing…</>
                ) : (
                  <><Icon name="arrow-up" size={12} /> {branch.branchStatus === "unpushedCommitsRequiringForce" ? "Force Push" : "Push"}</>
                )}
              </button>
            )}
            <button
              className="gb-diff-btn"
              onClick={() => onViewDiff({ projectId, target: branch.name, label: branch.name })}
              title="View branch diff"
            >
              <Icon name="file-diff" size={12} /> Diff
            </button>
            <button
              className="gb-unapply-btn"
              onClick={() => setShowUnapplyConfirm(true)}
              disabled={unapplyingBranches.has(branch.name)}
              title="Unapply branch (stash)"
            >
              {unapplyingBranches.has(branch.name) ? (
                <><Icon name="loader" size={12} /> Unapplying…</>
              ) : (
                <><Icon name="archive" size={12} /> Unapply</>
              )}
            </button>
          </div>
      </div>
      {showUnapplyConfirm && (
        <ConfirmPopup
          title="Unapply Branch"
          message={`Unapply "${branch.name}"? This will remove the branch changes from your working directory. You can re-apply it later.`}
          confirmLabel="Unapply"
          danger
          onConfirm={() => {
            setShowUnapplyConfirm(false);
            onUnapplyBranch(projectId, branch.name);
          }}
          onCancel={() => setShowUnapplyConfirm(false)}
        />
      )}
    </>
  );
}

// ── Legend ──────────────────────────────────────────────────────

function DashboardLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="gb-legend">
      <button className="gb-legend-toggle" onClick={() => setOpen(!open)}>
        <Icon name="info" size={12} />
        <span>Legend</span>
        <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
      </button>
      {open && (
        <div className="gb-legend-content">
          <div className="gb-legend-section">
            <span className="gb-legend-section-title">Branch / Session cards</span>
            <div className="gb-legend-items">
              <span className="gb-legend-item"><span className="gb-legend-swatch gb-legend-swatch-pushed" /> Pushed</span>
              <span className="gb-legend-item"><span className="gb-legend-swatch gb-legend-swatch-unpushed" /> Unpushed</span>
              <span className="gb-legend-item"><span className="gb-legend-swatch gb-legend-swatch-merged" /> Merged (pull to clean up)</span>
              <span className="gb-legend-item"><span className="gb-legend-swatch gb-legend-swatch-force" /> Needs force push</span>
              <span className="gb-legend-item"><span className="gb-legend-swatch gb-legend-swatch-conflicted" /> Conflicted</span>
            </div>
          </div>
          <div className="gb-legend-section">
            <span className="gb-legend-section-title">MR / PR status</span>
            <div className="gb-legend-items">
              <span className="gb-legend-item"><span className="gb-legend-badge mr-badge mr-status-open">!1</span> Open</span>
              <span className="gb-legend-item"><span className="gb-legend-badge mr-badge mr-status-draft">!1</span> Draft</span>
              <span className="gb-legend-item"><span className="gb-legend-badge mr-badge mr-status-approved">!1<span className="mr-badge-indicator mr-indicator-success"><Icon name="check" size={10} /></span></span> Approved + pipeline passed</span>
              <span className="gb-legend-item"><span className="gb-legend-badge mr-badge mr-status-approved">!1<span className="mr-badge-indicator mr-indicator-running"><Icon name="loader" size={10} /></span></span> Pipeline running</span>
              <span className="gb-legend-item"><span className="gb-legend-badge mr-badge mr-status-failed">!1<span className="mr-badge-indicator mr-indicator-failed"><Icon name="x" size={10} /></span></span> Pipeline failed</span>
              <span className="gb-legend-item"><span className="gb-legend-badge mr-badge mr-status-changes-requested">!1</span> Changes requested</span>
              <span className="gb-legend-item"><span className="gb-legend-badge mr-badge mr-status-merged">!1</span> Merged</span>
              <span className="gb-legend-item"><span className="gb-legend-badge mr-badge mr-status-closed">!1</span> Closed</span>
              <span className="gb-legend-item"><span className="gb-legend-badge mr-badge mr-status-approved mr-auto-merge"><span className="mr-badge-indicator mr-indicator-auto-merge"><Icon name="git-merge" size={10} /></span>!1<span className="mr-badge-indicator mr-indicator-running"><Icon name="loader" size={10} /></span></span> Auto-merge enabled</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────

// ── Cross-project session connector lines ──────────────────────

/**
 * Draws SVG lines between branch cards in different projects
 * that are linked to the same session.
 */
function SessionConnectors({
  containerRef,
  dashboards,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  dashboards: ProjectDashboard[];
}) {
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number; sessionId: number }[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function update() {
      const el = containerRef.current;
      if (!el) return;

      // Find all branch cards with a session-id attribute
      const cards = el.querySelectorAll<HTMLElement>("[data-session-id]");
      const bySession = new Map<number, HTMLElement[]>();
      cards.forEach((card) => {
        const sid = parseInt(card.dataset.sessionId!, 10);
        if (isNaN(sid)) return;
        let arr = bySession.get(sid);
        if (!arr) { arr = []; bySession.set(sid, arr); }
        arr.push(card);
      });

      const containerRect = el.getBoundingClientRect();
      const scrollLeft = el.scrollLeft;
      const scrollTop = el.scrollTop;
      const newLines: typeof lines = [];

      for (const [sessionId, cards] of bySession) {
        if (cards.length < 2) continue;
        // Connect each pair of adjacent cards
        for (let i = 0; i < cards.length - 1; i++) {
          const a = cards[i].getBoundingClientRect();
          const b = cards[i + 1].getBoundingClientRect();
          // Connect from right edge of left card to left edge of right card
          // (or center-to-center vertically)
          const aRight = a.left < b.left;
          const [left, right] = aRight ? [a, b] : [b, a];
          newLines.push({
            x1: left.right - containerRect.left + scrollLeft,
            y1: left.top + left.height / 2 - containerRect.top + scrollTop,
            x2: right.left - containerRect.left + scrollLeft,
            y2: right.top + right.height / 2 - containerRect.top + scrollTop,
            sessionId,
          });
        }
      }
      setLines(newLines);
    }

    // Update on any layout change
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    // Also re-calc on scroll (the body scrolls)
    container.addEventListener("scroll", update);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", update);
    };
  }, [containerRef, dashboards]);

  if (lines.length === 0) return null;

  return (
    <svg className="gb-session-connectors">
      {lines.map((l, i) => {
        const dx = l.x2 - l.x1;
        const dy = l.y2 - l.y1;
        // Cubic bezier: go right from source, come in from left at target
        const cx = Math.min(Math.abs(dx) * 0.4, 60);
        const d = `M ${l.x1} ${l.y1} C ${l.x1 + cx} ${l.y1}, ${l.x2 - cx} ${l.y2}, ${l.x2} ${l.y2}`;
        return <path key={i} d={d} />;
      })}
    </svg>
  );
}

function firstLine(msg: string): string {
  return msg.split("\n")[0].slice(0, 80);
}

function isPushable(branchStatus: string): boolean {
  return branchStatus === "completelyUnpushed" || branchStatus === "unpushedCommitsRequiringForce";
}

function branchStatusClass(status: string, hasConflicts: boolean, isMrMerged = false): string {
  if (hasConflicts) return "conflicted";
  if (isMrMerged) return "merged";
  if (status === "integrated" || status === "nothingToPush") return "pushed";
  if (status === "completelyUnpushed") return "unpushed";
  if (status === "unpushedCommitsRequiringForce") return "force";
  return "default";
}

/** Check if a MR URL is open (not merged/closed) based on known statuses. */
function isOpenMr(url: string, statuses: Record<string, MrStatus>): boolean {
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
