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
  linear_project_id: string | null;
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
  /** Whether the agent has made file changes (set via hook events). */
  has_changes: boolean;
  /** Shell command to auto-run on session creation/revival (terminal sessions). */
  builtin_command: string | null;
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
  has_changes: number;
  builtin_command: string | null;
  created_at: string;
  sort_order: number;
}

// ── Orchestration Types ─────────────────────────────────────────────

/** Job status in the orchestration workflow. */
export type JobStatus =
  | "todo"
  | "working"
  | "waiting_input"
  | "review"
  | "finished"
  | "rejected";

/** Role of a session within an orchestration job. */
export type JobSessionRole = "implement" | "review" | "test" | "orchestrator";

/** An orchestration job as returned by the API. */
export interface OrchestrationJob {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  source_url: string | null;
  status: JobStatus;
  agent_type: string;
  review_agent_type: string | null;
  test_agent_type: string | null;
  max_review_loops: number;
  max_test_loops: number;
  current_loop: number;
  error_message: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** Raw DB row shape for orchestration_jobs. */
export interface RawOrchestrationJobRow {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  source_url: string | null;
  status: string;
  agent_type: string;
  review_agent_type: string | null;
  test_agent_type: string | null;
  max_review_loops: number;
  max_test_loops: number;
  current_loop: number;
  error_message: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** A link between an orchestration job and a devbench session. */
export interface OrchestrationJobSession {
  id: number;
  job_id: number;
  session_id: number;
  role: JobSessionRole;
  created_at: string;
}

/** Orchestration engine state. */
export interface OrchestrationState {
  running: boolean;
  currentJobId: number | null;
  activeJobCount: number;
}

/** Event type for the orchestration job event log. */
export type JobEventType = "info" | "phase" | "error" | "session" | "output";

/** A structured event in a job's execution log. */
export interface JobEvent {
  id: number;
  job_id: number;
  timestamp: string;
  type: JobEventType;
  message: string;
}

/** Raw DB row for orchestration_job_events. */
export interface RawJobEventRow {
  id: number;
  job_id: number;
  timestamp: string;
  type: string;
  message: string;
}
