/**
 * Type definitions for GitButler CLI JSON output and the enriched
 * dashboard data returned by the DevBench API.
 */

import type { Session, MrStatus, SessionType } from "./types.ts";

// ── Raw `but status --json` output ──────────────────────────────

export interface ButChange {
  cliId: string;
  filePath: string;
  changeType: string;
}

export interface ButCommit {
  cliId: string;
  commitId: string;
  message: string;
  authorName: string;
  authorEmail?: string;
  createdAt: string;
  conflicted: boolean;
  reviewId: string | null;
  changes: unknown | null;
}

export interface ButBranch {
  cliId: string;
  name: string;
  commits: ButCommit[];
  upstreamCommits: ButCommit[];
  branchStatus: string;
  reviewId: string | null;
  ci: unknown | null;
}

export interface ButStack {
  cliId: string;
  assignedChanges: ButChange[];
  branches: ButBranch[];
}

export interface ButStatus {
  unassignedChanges: ButChange[];
  stacks: ButStack[];
}

// ── `but pull --check --json` output ────────────────────────────

export interface ButPullCheck {
  baseBranch: {
    name: string;
    remoteName: string;
    baseSha: string;
    currentSha: string;
  };
  upstreamCommits: { count: number };
  branchStatuses: unknown[];
  upToDate: boolean;
  hasWorktreeConflicts: boolean;
}

// ── Enriched dashboard types ────────────────────────────────────

export interface LinkedSession {
  id: number;
  name: string;
  type: SessionType;
}

export interface DashboardBranch extends ButBranch {
  linkedSession: LinkedSession | null;
  /** Branch's own review URLs from `but branch list --review`. */
  reviewUrls: string[];
  /** All MR URLs: branch review URLs + linked session's mr_urls (for display). */
  linkedMrUrls: string[];
  linkedMrStatuses: Record<string, MrStatus>;
}

export interface DashboardStack {
  cliId: string;
  assignedChanges: ButChange[];
  branches: DashboardBranch[];
}

export interface ProjectDashboard {
  projectId: number;
  projectName: string;
  projectPath: string;
  stacks: DashboardStack[];
  unassignedChanges: ButChange[];
  pullCheck: ButPullCheck | null;
  error: string | null;
  /** Whether a background refresh is currently running for this project. */
  refreshing: boolean;
  /** ISO timestamp of when the cached data was last refreshed. */
  lastRefreshed: string | null;
}

// ── Pull result ─────────────────────────────────────────────────

export interface PullResult {
  projectId: number;
  projectName: string;
  success: boolean;
  hasConflicts: boolean;
  error: string | null;
}

// ── Merge result ────────────────────────────────────────────────

export interface MergeResult {
  url: string;
  /** "merged" = merged immediately, "auto-merge" = will merge when CI passes, "error" = failed */
  outcome: "merged" | "auto-merge" | "error";
  message: string;
}

// ── Unapply result ──────────────────────────────────────────────

export interface UnapplyResult {
  projectId: number;
  projectName: string;
  branchName: string;
  success: boolean;
  error: string | null;
}

// ── Push result ─────────────────────────────────────────────────

export interface PushResult {
  projectId: number;
  projectName: string;
  branchName: string;
  success: boolean;
  error: string | null;
}
