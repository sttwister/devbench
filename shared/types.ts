/** The supported session types. */
export type SessionType = "terminal" | "claude" | "pi" | "codex";

/** A project as stored in the database. */
export interface Project {
  id: number;
  name: string;
  path: string;
  browser_url: string | null;
  default_view_mode: string;
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
  agent_session_id: string | null;
  browser_open: boolean;
  view_mode: string | null;
  created_at: string;
}

/** A project with its active sessions attached (API response shape). */
export interface ProjectWithSessions extends Project {
  sessions: Session[];
}
