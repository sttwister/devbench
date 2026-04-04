/** The supported session types. */
export type SessionType = "terminal" | "claude" | "pi" | "codex";

/** Agent activity status (tracked for non-terminal sessions). */
export type AgentStatus = "working" | "waiting";

/** A project as stored in the database. */
export interface Project {
  id: number;
  name: string;
  path: string;
  browser_url: string | null;
  default_view_mode: string;
  active: boolean;
  created_at: string;
}

/** MR/PR status from GitLab/GitHub API polling. */
export interface MrStatus {
  state: "open" | "merged" | "closed";
  draft: boolean;
  approved: boolean;
  changes_requested: boolean;
  pipeline_status: "success" | "failed" | "running" | "pending" | null;
  /** Whether auto-merge / merge-when-pipeline-succeeds is enabled. */
  auto_merge: boolean;
  last_checked: string; // ISO timestamp
}

/** MR/PR provider type. */
export type MrProvider = "gitlab" | "github";

/** A merge request / pull request as a first-class entity. */
export interface MergeRequest {
  id: number;
  url: string;
  provider: MrProvider;
  state: "open" | "merged" | "closed";
  draft: boolean;
  approved: boolean;
  changes_requested: boolean;
  pipeline_status: "success" | "failed" | "running" | "pending" | null;
  auto_merge: boolean;
  last_checked: string | null;
  session_id: number | null;
  created_at: string;
}

/** Raw DB row shape for merge_requests. */
export interface RawMergeRequestRow {
  id: number;
  url: string;
  provider: string;
  state: string;
  draft: number;
  approved: number;
  changes_requested: number;
  pipeline_status: string | null;
  auto_merge: number;
  last_checked: string | null;
  session_id: number | null;
  created_at: string;
}

/** A session as returned by the API (with parsed mr_urls). */
export interface Session {
  id: number;
  project_id: number;
  name: string;
  type: SessionType;
  tmux_name: string;
  status: string;
  mr_urls: string[];
  mr_statuses: Record<string, MrStatus>;
  source_url: string | null;
  source_type: string | null;
  agent_session_id: string | null;
  git_branch: string | null;
  browser_open: boolean;
  view_mode: string | null;
  /** ISO timestamp when the session last transitioned to "waiting", null if read/cleared. */
  notified_at: string | null;
  created_at: string;
}

/** A project with its active sessions attached (API response shape). */
export interface ProjectWithSessions extends Project {
  sessions: Session[];
}

/** Raw DB row shape before parsing (mr_url stored as TEXT). */
export interface RawSessionRow {
  id: number;
  project_id: number;
  name: string;
  type: SessionType;
  tmux_name: string;
  status: string;
  mr_url: string | null;
  mr_statuses: string | null;
  source_url: string | null;
  source_type: string | null;
  agent_session_id: string | null;
  git_branch: string | null;
  browser_open: number;
  view_mode: string | null;
  notified_at: string | null;
  created_at: string;
  sort_order: number;
}
