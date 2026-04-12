// @lat: [[database]]
import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Project, Session, SessionType, RawSessionRow, MrStatus, MergeRequest, RawMergeRequestRow, OrchestrationJob, RawOrchestrationJobRow, OrchestrationJobSession, JobStatus, JobSessionRole, JobEvent, JobEventType, RawJobEventRow } from "@devbench/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "devbench.db");

export type { Project, Session, SessionType };

// ── Row parser ──────────────────────────────────────────────────────

/** Convert a raw DB row (mr_url TEXT) into a Session with mr_urls: string[] */
export function parseSession(raw: RawSessionRow): Session {
  let mr_urls: string[] = [];
  if (raw.mr_url) {
    try {
      const parsed = JSON.parse(raw.mr_url);
      mr_urls = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // Legacy: plain URL string from earlier version
      mr_urls = [raw.mr_url];
    }
  }

  let mr_statuses: Record<string, MrStatus> = {};
  if (raw.mr_statuses) {
    try {
      mr_statuses = JSON.parse(raw.mr_statuses);
    } catch { /* ignore bad JSON */ }
  }

  return {
    id: raw.id,
    project_id: raw.project_id,
    name: raw.name,
    type: raw.type,
    tmux_name: raw.tmux_name,
    status: raw.status,
    mr_urls,
    mr_statuses,
    source_url: raw.source_url ?? null,
    source_type: raw.source_type ?? null,
    agent_session_id: raw.agent_session_id ?? null,
    git_branch: raw.git_branch ?? null,
    browser_open: !!raw.browser_open,
    view_mode: raw.view_mode ?? null,
    notified_at: raw.notified_at ?? null,
    has_changes: !!(raw as any).has_changes,
    created_at: raw.created_at,
  };
}

/** Convert a raw DB row into a typed MergeRequest. */
export function parseMergeRequest(raw: RawMergeRequestRow): MergeRequest {
  return {
    id: raw.id,
    url: raw.url,
    provider: raw.provider as MergeRequest["provider"],
    state: raw.state as MergeRequest["state"],
    draft: !!raw.draft,
    approved: !!raw.approved,
    changes_requested: !!raw.changes_requested,
    pipeline_status: raw.pipeline_status as MergeRequest["pipeline_status"],
    auto_merge: !!raw.auto_merge,
    last_checked: raw.last_checked,
    session_id: raw.session_id,
    created_at: raw.created_at,
  };
}

export function parseOrchestrationJob(raw: RawOrchestrationJobRow): OrchestrationJob {
  return {
    id: raw.id,
    project_id: raw.project_id,
    title: raw.title,
    description: raw.description,
    source_url: raw.source_url,
    status: raw.status as JobStatus,
    agent_type: raw.agent_type,
    review_agent_type: raw.review_agent_type,
    test_agent_type: raw.test_agent_type,
    max_review_loops: raw.max_review_loops,
    max_test_loops: raw.max_test_loops,
    current_loop: raw.current_loop,
    error_message: raw.error_message,
    sort_order: raw.sort_order,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}

// ── Migrations ──────────────────────────────────────────────────────

type Migration = { version: number; description: string; up: (db: Database.Database) => void };

const migrations: Migration[] = [
  {
    version: 1,
    description: "Update sessions CHECK constraint to include codex type",
    up(db) {
      const tableInfo = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'"
      ).get() as { sql: string } | undefined;
      if (tableInfo && !tableInfo.sql.includes("'codex'")) {
        db.exec(`
          CREATE TABLE sessions_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('terminal', 'claude', 'pi', 'codex')),
            tmux_name TEXT NOT NULL UNIQUE,
            status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )
        `);
        db.exec(`INSERT INTO sessions_new SELECT * FROM sessions`);
        db.exec(`DROP TABLE sessions`);
        db.exec(`ALTER TABLE sessions_new RENAME TO sessions`);
      }
    },
  },
  {
    version: 2,
    description: "Add mr_url column to sessions",
    up(db) {
      db.exec(`ALTER TABLE sessions ADD COLUMN mr_url TEXT DEFAULT NULL`);
    },
  },
  {
    version: 3,
    description: "Add browser_url column to projects",
    up(db) {
      db.exec(`ALTER TABLE projects ADD COLUMN browser_url TEXT DEFAULT NULL`);
    },
  },
  {
    version: 4,
    description: "Add default_view_mode column to projects",
    up(db) {
      db.exec(`ALTER TABLE projects ADD COLUMN default_view_mode TEXT DEFAULT 'desktop'`);
    },
  },
  {
    version: 5,
    description: "Add browser_open and view_mode columns to sessions",
    up(db) {
      db.exec(`ALTER TABLE sessions ADD COLUMN browser_open INTEGER DEFAULT 0`);
      db.exec(`ALTER TABLE sessions ADD COLUMN view_mode TEXT DEFAULT NULL`);
    },
  },
  {
    version: 6,
    description: "Add agent_session_id column to sessions",
    up(db) {
      db.exec(`ALTER TABLE sessions ADD COLUMN agent_session_id TEXT DEFAULT NULL`);
    },
  },
  {
    version: 7,
    description: "Add sort_order column to projects",
    up(db) {
      db.exec(`ALTER TABLE projects ADD COLUMN sort_order INTEGER DEFAULT 0`);
      const rows = db.prepare("SELECT id FROM projects ORDER BY name").all() as { id: number }[];
      const upd = db.prepare("UPDATE projects SET sort_order = ? WHERE id = ?");
      rows.forEach((r, i) => upd.run(i, r.id));
    },
  },
  {
    version: 8,
    description: "Add sort_order column to sessions",
    up(db) {
      db.exec(`ALTER TABLE sessions ADD COLUMN sort_order INTEGER DEFAULT 0`);
      const rows = db.prepare("SELECT id, project_id FROM sessions ORDER BY created_at").all() as { id: number; project_id: number }[];
      const upd = db.prepare("UPDATE sessions SET sort_order = ? WHERE id = ?");
      const counters: Record<number, number> = {};
      rows.forEach((r) => {
        const idx = counters[r.project_id] ?? 0;
        upd.run(idx, r.id);
        counters[r.project_id] = idx + 1;
      });
    },
  },
  {
    version: 9,
    description: "Add source_url and source_type columns to sessions",
    up(db) {
      db.exec(`ALTER TABLE sessions ADD COLUMN source_url TEXT DEFAULT NULL`);
      db.exec(`ALTER TABLE sessions ADD COLUMN source_type TEXT DEFAULT NULL`);
    },
  },
  {
    version: 10,
    description: "Add settings table for integration tokens",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
    },
  },
  {
    version: 11,
    description: "Add mr_statuses column to sessions",
    up(db) {
      db.exec(`ALTER TABLE sessions ADD COLUMN mr_statuses TEXT DEFAULT NULL`);
    },
  },
  {
    version: 12,
    description: "Add git_branch column to sessions",
    up(db) {
      db.exec(`ALTER TABLE sessions ADD COLUMN git_branch TEXT DEFAULT NULL`);
    },
  },
  {
    version: 13,
    description: "Add gitbutler_cache table for dashboard state",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS gitbutler_cache (
          project_id INTEGER PRIMARY KEY,
          data TEXT NOT NULL,
          last_refreshed TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);
    },
  },
  {
    version: 14,
    description: "Add merge_requests table and migrate existing session MR data",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS merge_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL UNIQUE,
          provider TEXT NOT NULL,
          state TEXT DEFAULT 'open',
          draft INTEGER DEFAULT 0,
          approved INTEGER DEFAULT 0,
          changes_requested INTEGER DEFAULT 0,
          pipeline_status TEXT DEFAULT NULL,
          auto_merge INTEGER DEFAULT 0,
          last_checked TEXT DEFAULT NULL,
          session_id INTEGER,
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        )
      `);

      // Migrate existing MR data from sessions into merge_requests
      const rows = db.prepare("SELECT id, mr_url, mr_statuses FROM sessions WHERE mr_url IS NOT NULL").all() as any[];
      const insertMr = db.prepare(
        `INSERT OR IGNORE INTO merge_requests (url, provider, state, draft, approved, changes_requested, pipeline_status, auto_merge, last_checked, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const row of rows) {
        let urls: string[] = [];
        try {
          const parsed = JSON.parse(row.mr_url);
          urls = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          urls = [row.mr_url];
        }

        let statuses: Record<string, any> = {};
        if (row.mr_statuses) {
          try { statuses = JSON.parse(row.mr_statuses); } catch { /* ignore */ }
        }

        for (const url of urls) {
          let provider = "gitlab";
          if (url.match(/github\.com/)) provider = "github";
          else if (url.match(/bitbucket/)) provider = "bitbucket";

          const status = statuses[url];
          insertMr.run(
            url,
            provider,
            status?.state ?? "open",
            status?.draft ? 1 : 0,
            status?.approved ? 1 : 0,
            status?.changes_requested ? 1 : 0,
            status?.pipeline_status ?? null,
            status?.auto_merge ? 1 : 0,
            status?.last_checked ?? null,
            row.id,
          );
        }
      }
    },
  },
  {
    version: 15,
    description: "Add notified_at column to sessions for notification tracking",
    up(db) {
      db.exec(`ALTER TABLE sessions ADD COLUMN notified_at TEXT DEFAULT NULL`);
    },
  },
  {
    version: 16,
    description: "Add active column to projects for deactivation support",
    up(db) {
      db.exec(`ALTER TABLE projects ADD COLUMN active INTEGER DEFAULT 1`);
    },
  },
  {
    version: 17,
    description: "Add has_changes column to sessions for tracking file modifications via agent hooks",
    up(db) {
      db.exec(`ALTER TABLE sessions ADD COLUMN has_changes INTEGER DEFAULT 0`);
    },
  },
  {
    version: 18,
    description: "Add orchestration_jobs and orchestration_job_sessions tables",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestration_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          description TEXT DEFAULT NULL,
          source_url TEXT DEFAULT NULL,
          status TEXT DEFAULT 'todo' CHECK(status IN ('todo','working','waiting_input','testing','review','finished','rejected')),
          agent_type TEXT DEFAULT 'claude',
          review_agent_type TEXT DEFAULT NULL,
          test_agent_type TEXT DEFAULT NULL,
          max_review_loops INTEGER DEFAULT 3,
          max_test_loops INTEGER DEFAULT 3,
          current_loop INTEGER DEFAULT 0,
          error_message TEXT DEFAULT NULL,
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestration_job_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL,
          session_id INTEGER NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('implement','review','test')),
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (job_id) REFERENCES orchestration_jobs(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )
      `);
    },
  },
  {
    version: 19,
    description: "Add orchestration_job_events table for persistent event log",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS orchestration_job_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL,
          timestamp TEXT DEFAULT (datetime('now')),
          type TEXT NOT NULL CHECK(type IN ('info','phase','error','session','output')),
          message TEXT NOT NULL,
          FOREIGN KEY (job_id) REFERENCES orchestration_jobs(id) ON DELETE CASCADE
        )
      `);
    },
  },
  {
    version: 20,
    description: "Add 'orchestrator' to orchestration_job_sessions role CHECK constraint",
    up(db) {
      // SQLite doesn't support ALTER CHECK constraints, so we recreate the table
      db.exec(`
        CREATE TABLE orchestration_job_sessions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL,
          session_id INTEGER NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('implement','review','test','orchestrator')),
          created_at TEXT DEFAULT (datetime('now')),
          FOREIGN KEY (job_id) REFERENCES orchestration_jobs(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        INSERT INTO orchestration_job_sessions_new SELECT * FROM orchestration_job_sessions;
        DROP TABLE orchestration_job_sessions;
        ALTER TABLE orchestration_job_sessions_new RENAME TO orchestration_job_sessions;
      `);
    },
  },

];

// ── Database factory ────────────────────────────────────────────────

export function createDatabase(dbPath: string) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // ── Schema: base tables (includes all current columns) ──────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      browser_url TEXT DEFAULT NULL,
      default_view_mode TEXT DEFAULT 'desktop',
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('terminal', 'claude', 'pi', 'codex')),
      tmux_name TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'active',
      mr_url TEXT DEFAULT NULL,
      mr_statuses TEXT DEFAULT NULL,
      source_url TEXT DEFAULT NULL,
      source_type TEXT DEFAULT NULL,
      agent_session_id TEXT DEFAULT NULL,
      git_branch TEXT DEFAULT NULL,
      browser_open INTEGER DEFAULT 0,
      view_mode TEXT DEFAULT NULL,
      sort_order INTEGER DEFAULT 0,
      notified_at TEXT DEFAULT NULL,
      has_changes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS gitbutler_cache (
      project_id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      last_refreshed TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS merge_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      state TEXT DEFAULT 'open',
      draft INTEGER DEFAULT 0,
      approved INTEGER DEFAULT 0,
      changes_requested INTEGER DEFAULT 0,
      pipeline_status TEXT DEFAULT NULL,
      auto_merge INTEGER DEFAULT 0,
      last_checked TEXT DEFAULT NULL,
      session_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestration_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT NULL,
      source_url TEXT DEFAULT NULL,
      status TEXT DEFAULT 'todo' CHECK(status IN ('todo','working','waiting_input','testing','review','finished','rejected')),
      agent_type TEXT DEFAULT 'claude',
      review_agent_type TEXT DEFAULT NULL,
      test_agent_type TEXT DEFAULT NULL,
      max_review_loops INTEGER DEFAULT 3,
      max_test_loops INTEGER DEFAULT 3,
      current_loop INTEGER DEFAULT 0,
      error_message TEXT DEFAULT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestration_job_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('implement','review','test','orchestrator')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (job_id) REFERENCES orchestration_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS orchestration_job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      type TEXT NOT NULL CHECK(type IN ('info','phase','error','session','output')),
      message TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES orchestration_jobs(id) ON DELETE CASCADE
    )
  `);

  // ── Migrations ────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `);

  function getSchemaVersion(): number {
    const row = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null };
    return row?.v ?? 0;
  }

  function setSchemaVersion(version: number): void {
    db.prepare("INSERT OR REPLACE INTO schema_version (version) VALUES (?)").run(version);
  }

  // Run pending migrations
  {
    const current = getSchemaVersion();
    const pending = migrations.filter((m) => m.version > current);
    if (pending.length > 0) {
      console.log(`[db] Running ${pending.length} migration(s) from v${current}…`);
      db.transaction(() => {
        for (const m of pending) {
          console.log(`[db]   v${m.version}: ${m.description}`);
          try {
            m.up(db);
          } catch (e: any) {
            // Tolerate "duplicate column" for databases that were partially
            // migrated before the version-tracking system was introduced.
            if (!e.message?.includes("duplicate column")) throw e;
            console.log(`[db]     (already applied — skipped)`);
          }
          setSchemaVersion(m.version);
        }
      })();
      console.log(`[db] Schema at v${getSchemaVersion()}`);
    }
  }

  // ── Prepared statements ───────────────────────────────────────────

  const stmts = {
    insertProject: db.prepare("INSERT INTO projects (name, path, browser_url, default_view_mode, sort_order) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects))"),
    updateBrowserUrl: db.prepare("UPDATE projects SET browser_url = ? WHERE id = ?"),
    updateProject: db.prepare("UPDATE projects SET name = ?, path = ?, browser_url = ?, default_view_mode = ? WHERE id = ?"),
    selectProjects: db.prepare("SELECT * FROM projects ORDER BY sort_order, name"),
    selectActiveProjects: db.prepare("SELECT * FROM projects WHERE active = 1 ORDER BY sort_order, name"),
    setProjectActive: db.prepare("UPDATE projects SET active = ? WHERE id = ?"),
    selectProject: db.prepare("SELECT * FROM projects WHERE id = ?"),
    deleteProject: db.prepare("DELETE FROM projects WHERE id = ?"),
    insertSession: db.prepare(
      "INSERT INTO sessions (project_id, name, type, tmux_name, source_url, source_type, sort_order) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sessions WHERE project_id = ?))"
    ),
    selectSessionsByProject: db.prepare(
      `SELECT * FROM sessions WHERE project_id = ? AND status = 'active'
       AND id NOT IN (SELECT session_id FROM orchestration_job_sessions)
       ORDER BY sort_order, created_at`
    ),
    selectArchivedSessionsByProject: db.prepare(
      "SELECT * FROM sessions WHERE project_id = ? AND status = 'archived' ORDER BY created_at DESC"
    ),
    unarchiveSession: db.prepare("UPDATE sessions SET status = 'active' WHERE id = ?"),
    selectSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
    renameSession: db.prepare("UPDATE sessions SET name = ? WHERE id = ?"),
    selectAllSessions: db.prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY sort_order, created_at"),
    archiveSession: db.prepare("UPDATE sessions SET status = 'archived' WHERE id = ?"),
    updateSessionMrUrl: db.prepare("UPDATE sessions SET mr_url = ? WHERE id = ?"),
    updateSessionBrowserState: db.prepare("UPDATE sessions SET browser_open = ?, view_mode = ? WHERE id = ?"),
    updateSessionAgentId: db.prepare("UPDATE sessions SET agent_session_id = ? WHERE id = ?"),
    updateSessionTmuxName: db.prepare("UPDATE sessions SET tmux_name = ? WHERE id = ?"),
    updateSessionSource: db.prepare("UPDATE sessions SET source_url = ?, source_type = ? WHERE id = ?"),
    updateSessionMrStatuses: db.prepare("UPDATE sessions SET mr_statuses = ? WHERE id = ?"),
    updateSessionGitBranch: db.prepare("UPDATE sessions SET git_branch = ? WHERE id = ?"),
    getSetting: db.prepare("SELECT value FROM settings WHERE key = ?"),
    upsertSetting: db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"),
    deleteSetting: db.prepare("DELETE FROM settings WHERE key = ?"),
    getAllSettings: db.prepare("SELECT key, value FROM settings"),
    getGitButlerCache: db.prepare("SELECT data, last_refreshed FROM gitbutler_cache WHERE project_id = ?"),
    upsertGitButlerCache: db.prepare("INSERT OR REPLACE INTO gitbutler_cache (project_id, data, last_refreshed) VALUES (?, ?, ?)"),
    getAllGitButlerCache: db.prepare("SELECT project_id, data, last_refreshed FROM gitbutler_cache"),
    // Merge requests
    insertMergeRequest: db.prepare(
      `INSERT OR IGNORE INTO merge_requests (url, provider, session_id) VALUES (?, ?, ?)`
    ),
    upsertMergeRequest: db.prepare(
      `INSERT INTO merge_requests (url, provider, session_id)
       VALUES (?, ?, ?)
       ON CONFLICT(url) DO UPDATE SET session_id = COALESCE(excluded.session_id, merge_requests.session_id)`
    ),
    selectMergeRequestByUrl: db.prepare("SELECT * FROM merge_requests WHERE url = ?"),
    selectMergeRequestsBySession: db.prepare("SELECT * FROM merge_requests WHERE session_id = ? ORDER BY created_at"),
    selectAllOpenMergeRequests: db.prepare("SELECT * FROM merge_requests WHERE state = 'open' ORDER BY created_at"),
    selectAllMergeRequests: db.prepare("SELECT * FROM merge_requests ORDER BY created_at DESC"),
    selectMergeRequestsForActiveSessions: db.prepare(
      `SELECT mr.* FROM merge_requests mr
       INNER JOIN sessions s ON mr.session_id = s.id
       WHERE s.status = 'active' AND mr.state = 'open'
       ORDER BY mr.created_at`
    ),
    updateMergeRequestStatus: db.prepare(
      `UPDATE merge_requests SET state = ?, draft = ?, approved = ?, changes_requested = ?,
       pipeline_status = ?, auto_merge = ?, last_checked = ? WHERE id = ?`
    ),
    updateMergeRequestSession: db.prepare("UPDATE merge_requests SET session_id = ? WHERE id = ?"),
    deleteMergeRequest: db.prepare("DELETE FROM merge_requests WHERE id = ?"),
    deleteMergeRequestByUrl: db.prepare("DELETE FROM merge_requests WHERE url = ?"),
    // Changes tracking
    setSessionHasChanges: db.prepare("UPDATE sessions SET has_changes = 1 WHERE id = ?"),
    clearSessionHasChanges: db.prepare("UPDATE sessions SET has_changes = 0 WHERE id = ?"),
    // Notifications
    setSessionNotified: db.prepare("UPDATE sessions SET notified_at = datetime('now') WHERE id = ? AND notified_at IS NULL"),
    clearSessionNotified: db.prepare("UPDATE sessions SET notified_at = NULL WHERE id = ?"),
    getNotifiedSessionIds: db.prepare("SELECT id FROM sessions WHERE notified_at IS NOT NULL AND status = 'active'"),
    // Orchestration jobs
    insertJob: db.prepare(
      `INSERT INTO orchestration_jobs (project_id, title, description, source_url, agent_type, review_agent_type, test_agent_type, max_review_loops, max_test_loops, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM orchestration_jobs WHERE project_id = ?))`
    ),
    selectJobsByProject: db.prepare(
      "SELECT * FROM orchestration_jobs WHERE project_id = ? ORDER BY sort_order, created_at"
    ),
    selectAllJobs: db.prepare(
      "SELECT * FROM orchestration_jobs ORDER BY sort_order, created_at"
    ),
    selectJob: db.prepare("SELECT * FROM orchestration_jobs WHERE id = ?"),
    updateJobStatus: db.prepare(
      "UPDATE orchestration_jobs SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ),
    updateJob: db.prepare(
      "UPDATE orchestration_jobs SET title = ?, description = ?, source_url = ?, agent_type = ?, review_agent_type = ?, test_agent_type = ?, max_review_loops = ?, max_test_loops = ?, updated_at = datetime('now') WHERE id = ?"
    ),
    updateJobError: db.prepare(
      "UPDATE orchestration_jobs SET error_message = ?, updated_at = datetime('now') WHERE id = ?"
    ),
    updateJobLoop: db.prepare(
      "UPDATE orchestration_jobs SET current_loop = ?, updated_at = datetime('now') WHERE id = ?"
    ),
    deleteJob: db.prepare("DELETE FROM orchestration_jobs WHERE id = ?"),
    selectNextTodoJob: db.prepare(
      "SELECT * FROM orchestration_jobs WHERE status = 'todo' ORDER BY sort_order, created_at LIMIT 1"
    ),
    // Orchestration job sessions
    insertJobSession: db.prepare(
      "INSERT INTO orchestration_job_sessions (job_id, session_id, role) VALUES (?, ?, ?)"
    ),
    selectJobSessionsByJob: db.prepare(
      "SELECT * FROM orchestration_job_sessions WHERE job_id = ? ORDER BY created_at"
    ),
    selectJobBySessionId: db.prepare(
      "SELECT j.* FROM orchestration_jobs j INNER JOIN orchestration_job_sessions js ON j.id = js.job_id WHERE js.session_id = ?"
    ),
    // Orchestration job events
    insertJobEvent: db.prepare(
      "INSERT INTO orchestration_job_events (job_id, type, message) VALUES (?, ?, ?)"
    ),
    selectJobEvents: db.prepare(
      "SELECT * FROM orchestration_job_events WHERE job_id = ? ORDER BY id"
    ),
    selectJobEventsAfter: db.prepare(
      "SELECT * FROM orchestration_job_events WHERE job_id = ? AND id > ? ORDER BY id"
    ),
    deleteJobEvents: db.prepare(
      "DELETE FROM orchestration_job_events WHERE job_id = ?"
    ),
  };

  // ── Public API ──────────────────────────────────────────────────

  function getProjects(): Project[] {
    return (stmts.selectProjects.all() as any[]).map(row => ({ ...row, active: !!row.active })) as Project[];
  }

  function getActiveProjects(): Project[] {
    return (stmts.selectActiveProjects.all() as any[]).map(row => ({ ...row, active: true })) as Project[];
  }

  function getProject(id: number): Project | null {
    const row = stmts.selectProject.get(id) as any;
    if (!row) return null;
    return { ...row, active: !!row.active } as Project;
  }

  function addProject(name: string, path: string, browserUrl?: string | null, defaultViewMode?: string | null): Project {
    const info = stmts.insertProject.run(name, path, browserUrl ?? null, defaultViewMode ?? "desktop");
    return getProject(Number(info.lastInsertRowid))!;
  }

  function updateProjectBrowserUrl(id: number, browserUrl: string | null): boolean {
    return stmts.updateBrowserUrl.run(browserUrl, id).changes > 0;
  }

  function updateProject(
    id: number,
    name: string,
    projectPath: string,
    browserUrl: string | null,
    defaultViewMode?: string | null
  ): boolean {
    return stmts.updateProject.run(name, projectPath, browserUrl, defaultViewMode ?? "desktop", id).changes > 0;
  }

  function removeProject(id: number): boolean {
    return stmts.deleteProject.run(id).changes > 0;
  }

  function setProjectActive(id: number, active: boolean): boolean {
    return stmts.setProjectActive.run(active ? 1 : 0, id).changes > 0;
  }

  function getSessionsByProject(projectId: number): Session[] {
    return (stmts.selectSessionsByProject.all(projectId) as RawSessionRow[]).map(parseSession);
  }

  function getAllSessions(): Session[] {
    return (stmts.selectAllSessions.all() as RawSessionRow[]).map(parseSession);
  }

  function getSession(id: number): Session | null {
    const raw = stmts.selectSession.get(id);
    return raw ? parseSession(raw) : null;
  }

  function addSession(
    projectId: number,
    name: string,
    type: SessionType,
    tmuxName: string,
    sourceUrl?: string | null,
    sourceType?: string | null
  ): Session {
    // projectId passed twice: once for the column, once for the sort_order subquery
    const info = stmts.insertSession.run(
      projectId, name, type, tmuxName,
      sourceUrl ?? null, sourceType ?? null,
      projectId
    );
    return getSession(Number(info.lastInsertRowid))!;
  }

  function renameSession(id: number, name: string): boolean {
    return stmts.renameSession.run(name, id).changes > 0;
  }

  function removeSession(id: number): boolean {
    return stmts.deleteSession.run(id).changes > 0;
  }

  function archiveSession(id: number): boolean {
    return stmts.archiveSession.run(id).changes > 0;
  }

  function updateSessionSource(id: number, sourceUrl: string | null, sourceType: string | null): boolean {
    return stmts.updateSessionSource.run(sourceUrl, sourceType, id).changes > 0;
  }

  function updateSessionMrUrls(id: number, mrUrls: string[]): boolean {
    const json = mrUrls.length > 0 ? JSON.stringify(mrUrls) : null;
    return stmts.updateSessionMrUrl.run(json, id).changes > 0;
  }

  function updateSessionBrowserState(id: number, browserOpen: boolean, viewMode: string | null): boolean {
    return stmts.updateSessionBrowserState.run(browserOpen ? 1 : 0, viewMode, id).changes > 0;
  }

  function getArchivedSessionsByProject(projectId: number): Session[] {
    return (stmts.selectArchivedSessionsByProject.all(projectId) as RawSessionRow[]).map(parseSession);
  }

  function unarchiveSession(id: number): boolean {
    return stmts.unarchiveSession.run(id).changes > 0;
  }

  function updateSessionAgentId(id: number, agentSessionId: string | null): boolean {
    return stmts.updateSessionAgentId.run(agentSessionId, id).changes > 0;
  }

  function updateSessionTmuxName(id: number, tmuxName: string): boolean {
    return stmts.updateSessionTmuxName.run(tmuxName, id).changes > 0;
  }

  function reorderProjects(orderedIds: number[]): void {
    const stmt = db.prepare("UPDATE projects SET sort_order = ? WHERE id = ?");
    db.transaction(() => {
      orderedIds.forEach((id, index) => stmt.run(index, id));
    })();
  }

  function reorderSessions(projectId: number, orderedIds: number[]): void {
    const stmt = db.prepare("UPDATE sessions SET sort_order = ? WHERE id = ? AND project_id = ?");
    db.transaction(() => {
      orderedIds.forEach((id, index) => stmt.run(index, id, projectId));
    })();
  }

  function updateSessionGitBranch(id: number, gitBranch: string | null): boolean {
    return stmts.updateSessionGitBranch.run(gitBranch, id).changes > 0;
  }

  function updateSessionMrStatuses(id: number, statuses: Record<string, import("@devbench/shared").MrStatus>): boolean {
    const json = Object.keys(statuses).length > 0 ? JSON.stringify(statuses) : null;
    return stmts.updateSessionMrStatuses.run(json, id).changes > 0;
  }

  function getSetting(key: string): string | null {
    const row = stmts.getSetting.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  function setSetting(key: string, value: string): void {
    stmts.upsertSetting.run(key, value);
  }

  function deleteSetting(key: string): void {
    stmts.deleteSetting.run(key);
  }

  function getAllSettings(): Record<string, string> {
    const rows = stmts.getAllSettings.all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) result[row.key] = row.value;
    return result;
  }

  function getGitButlerCache(projectId: number): { data: string; lastRefreshed: string } | null {
    const row = stmts.getGitButlerCache.get(projectId) as { data: string; last_refreshed: string } | undefined;
    return row ? { data: row.data, lastRefreshed: row.last_refreshed } : null;
  }

  function setGitButlerCache(projectId: number, data: string): void {
    stmts.upsertGitButlerCache.run(projectId, data, new Date().toISOString());
  }

  function getAllGitButlerCache(): Map<number, { data: string; lastRefreshed: string }> {
    const rows = stmts.getAllGitButlerCache.all() as { project_id: number; data: string; last_refreshed: string }[];
    const map = new Map<number, { data: string; lastRefreshed: string }>();
    for (const row of rows) map.set(row.project_id, { data: row.data, lastRefreshed: row.last_refreshed });
    return map;
  }

  // ── Merge Requests ────────────────────────────────────────────────

  function addMergeRequest(url: string, provider: string, sessionId: number | null): MergeRequest | null {
    stmts.upsertMergeRequest.run(url, provider, sessionId);
    return getMergeRequestByUrl(url);
  }

  function getMergeRequestByUrl(url: string): MergeRequest | null {
    const raw = stmts.selectMergeRequestByUrl.get(url) as RawMergeRequestRow | undefined;
    return raw ? parseMergeRequest(raw) : null;
  }

  function getMergeRequestsBySession(sessionId: number): MergeRequest[] {
    return (stmts.selectMergeRequestsBySession.all(sessionId) as RawMergeRequestRow[]).map(parseMergeRequest);
  }

  function getAllMergeRequests(): MergeRequest[] {
    return (stmts.selectAllMergeRequests.all() as RawMergeRequestRow[]).map(parseMergeRequest);
  }

  function getOpenMergeRequestsForActiveSessions(): MergeRequest[] {
    return (stmts.selectMergeRequestsForActiveSessions.all() as RawMergeRequestRow[]).map(parseMergeRequest);
  }

  function updateMergeRequestStatus(id: number, status: MrStatus): boolean {
    return stmts.updateMergeRequestStatus.run(
      status.state,
      status.draft ? 1 : 0,
      status.approved ? 1 : 0,
      status.changes_requested ? 1 : 0,
      status.pipeline_status,
      status.auto_merge ? 1 : 0,
      status.last_checked,
      id,
    ).changes > 0;
  }

  function removeMergeRequest(id: number): boolean {
    return stmts.deleteMergeRequest.run(id).changes > 0;
  }

  function removeMergeRequestByUrl(url: string): boolean {
    return stmts.deleteMergeRequestByUrl.run(url).changes > 0;
  }

  // ── Notifications ──────────────────────────────────────────────────────

  /** Mark a session as having a pending notification (working→waiting). No-op if already notified. */
  function setSessionNotified(id: number): boolean {
    return stmts.setSessionNotified.run(id).changes > 0;
  }

  /** Clear the notification for a session (user viewed it). */
  function clearSessionNotified(id: number): boolean {
    return stmts.clearSessionNotified.run(id).changes > 0;
  }

  /** Mark a session as having uncommitted file changes (from agent hooks). */
  function setSessionHasChanges(id: number): boolean {
    return stmts.setSessionHasChanges.run(id).changes > 0;
  }

  /** Clear the has_changes flag (e.g. after commit). */
  function clearSessionHasChanges(id: number): boolean {
    return stmts.clearSessionHasChanges.run(id).changes > 0;
  }

  /** Get IDs of all active sessions that have pending notifications. */
  function getNotifiedSessionIds(): number[] {
    const rows = stmts.getNotifiedSessionIds.all() as { id: number }[];
    return rows.map(r => r.id);
  }

  // ── Orchestration Jobs ───────────────────────────────────────────────

  function getJob(id: number): OrchestrationJob | null {
    const raw = stmts.selectJob.get(id) as RawOrchestrationJobRow | undefined;
    return raw ? parseOrchestrationJob(raw) : null;
  }

  function getJobsByProject(projectId: number): OrchestrationJob[] {
    return (stmts.selectJobsByProject.all(projectId) as RawOrchestrationJobRow[]).map(parseOrchestrationJob);
  }

  function getAllJobs(): OrchestrationJob[] {
    return (stmts.selectAllJobs.all() as RawOrchestrationJobRow[]).map(parseOrchestrationJob);
  }

  function addJob(
    projectId: number,
    title: string,
    description: string | null,
    sourceUrl: string | null,
    agentType: string = "claude",
    reviewAgentType: string | null = null,
    testAgentType: string | null = null,
    maxReviewLoops: number = 3,
    maxTestLoops: number = 3,
  ): OrchestrationJob {
    const info = stmts.insertJob.run(
      projectId, title, description, sourceUrl,
      agentType, reviewAgentType, testAgentType,
      maxReviewLoops, maxTestLoops,
      projectId // for sort_order subquery
    );
    return getJob(Number(info.lastInsertRowid))!;
  }

  function updateJob(
    id: number,
    title: string,
    description: string | null,
    sourceUrl: string | null,
    agentType: string,
    reviewAgentType: string | null,
    testAgentType: string | null,
    maxReviewLoops: number,
    maxTestLoops: number,
  ): boolean {
    return stmts.updateJob.run(
      title, description, sourceUrl,
      agentType, reviewAgentType, testAgentType,
      maxReviewLoops, maxTestLoops, id
    ).changes > 0;
  }

  function updateJobStatus(id: number, status: JobStatus): boolean {
    return stmts.updateJobStatus.run(status, id).changes > 0;
  }

  function updateJobError(id: number, error: string | null): boolean {
    return stmts.updateJobError.run(error, id).changes > 0;
  }

  function updateJobLoop(id: number, loop: number): boolean {
    return stmts.updateJobLoop.run(loop, id).changes > 0;
  }

  function removeJob(id: number): boolean {
    return stmts.deleteJob.run(id).changes > 0;
  }

  function getNextTodoJob(): OrchestrationJob | null {
    const raw = stmts.selectNextTodoJob.get() as RawOrchestrationJobRow | undefined;
    return raw ? parseOrchestrationJob(raw) : null;
  }

  // ── Orchestration Job Sessions ──────────────────────────────────────

  function addJobSession(jobId: number, sessionId: number, role: JobSessionRole): OrchestrationJobSession {
    const info = stmts.insertJobSession.run(jobId, sessionId, role);
    return {
      id: Number(info.lastInsertRowid),
      job_id: jobId,
      session_id: sessionId,
      role,
      created_at: new Date().toISOString(),
    };
  }

  function getJobSessionsByJob(jobId: number): OrchestrationJobSession[] {
    return stmts.selectJobSessionsByJob.all(jobId) as OrchestrationJobSession[];
  }

  function getJobBySessionId(sessionId: number): OrchestrationJob | null {
    const raw = stmts.selectJobBySessionId.get(sessionId) as RawOrchestrationJobRow | undefined;
    return raw ? parseOrchestrationJob(raw) : null;
  }

  // ── Orchestration Job Events ───────────────────────────────────────

  function addJobEvent(jobId: number, type: JobEventType, message: string): JobEvent {
    const info = stmts.insertJobEvent.run(jobId, type, message);
    return {
      id: Number(info.lastInsertRowid),
      job_id: jobId,
      timestamp: new Date().toISOString(),
      type,
      message,
    };
  }

  function getJobEvents(jobId: number): JobEvent[] {
    const rows = stmts.selectJobEvents.all(jobId) as RawJobEventRow[];
    return rows.map((r) => ({ ...r, type: r.type as JobEventType }));
  }

  function getJobEventsAfter(jobId: number, afterId: number): JobEvent[] {
    const rows = stmts.selectJobEventsAfter.all(jobId, afterId) as RawJobEventRow[];
    return rows.map((r) => ({ ...r, type: r.type as JobEventType }));
  }

  function deleteJobEvents(jobId: number): void {
    stmts.deleteJobEvents.run(jobId);
  }

  return {
    getProjects,
    getActiveProjects,
    getProject,
    addProject,
    updateProjectBrowserUrl,
    updateProject,
    removeProject,
    setProjectActive,
    getSessionsByProject,
    getAllSessions,
    getSession,
    addSession,
    renameSession,
    removeSession,
    archiveSession,
    updateSessionSource,
    updateSessionMrUrls,
    updateSessionBrowserState,
    getArchivedSessionsByProject,
    unarchiveSession,
    updateSessionAgentId,
    updateSessionTmuxName,
    reorderProjects,
    reorderSessions,
    updateSessionMrStatuses,
    updateSessionGitBranch,
    getSetting,
    setSetting,
    deleteSetting,
    getAllSettings,
    getGitButlerCache,
    setGitButlerCache,
    getAllGitButlerCache,
    addMergeRequest,
    getMergeRequestByUrl,
    getMergeRequestsBySession,
    getAllMergeRequests,
    getOpenMergeRequestsForActiveSessions,
    updateMergeRequestStatus,
    removeMergeRequest,
    removeMergeRequestByUrl,
    setSessionNotified,
    clearSessionNotified,
    getNotifiedSessionIds,
    setSessionHasChanges,
    clearSessionHasChanges,
    // Orchestration
    getJob,
    getJobsByProject,
    getAllJobs,
    addJob,
    updateJob,
    updateJobStatus,
    updateJobError,
    updateJobLoop,
    removeJob,
    getNextTodoJob,
    addJobSession,
    getJobSessionsByJob,
    getJobBySessionId,
    // Orchestration job events
    addJobEvent,
    getJobEvents,
    getJobEventsAfter,
    deleteJobEvents,
  };
}

// ── Default instance ────────────────────────────────────────────────
// In test mode, use an in-memory DB to avoid parallel test workers all hitting
// the same devbench.db file at module load time (SQLITE_BUSY).
const _default = createDatabase(process.env.VITEST ? ":memory:" : DB_PATH);

export const {
  getProjects,
  getActiveProjects,
  getProject,
  addProject,
  updateProjectBrowserUrl,
  updateProject,
  removeProject,
  setProjectActive,
  getSessionsByProject,
  getAllSessions,
  getSession,
  addSession,
  renameSession,
  removeSession,
  archiveSession,
  updateSessionSource,
  updateSessionMrUrls,
  updateSessionBrowserState,
  getArchivedSessionsByProject,
  unarchiveSession,
  updateSessionAgentId,
  updateSessionTmuxName,
  reorderProjects,
  reorderSessions,
  updateSessionMrStatuses,
  updateSessionGitBranch,
  getSetting,
  setSetting,
  deleteSetting,
  getAllSettings,
  getGitButlerCache,
  setGitButlerCache,
  getAllGitButlerCache,
  addMergeRequest,
  getMergeRequestByUrl,
  getMergeRequestsBySession,
  getAllMergeRequests,
  getOpenMergeRequestsForActiveSessions,
  updateMergeRequestStatus,
  removeMergeRequest,
  removeMergeRequestByUrl,
  setSessionNotified,
  clearSessionNotified,
  getNotifiedSessionIds,
  setSessionHasChanges,
  clearSessionHasChanges,
  // Orchestration
  getJob,
  getJobsByProject,
  getAllJobs,
  addJob,
  updateJob,
  updateJobStatus,
  updateJobError,
  updateJobLoop,
  removeJob,
  getNextTodoJob,
  addJobSession,
  getJobSessionsByJob,
  getJobBySessionId,
  // Orchestration job events
  addJobEvent,
  getJobEvents,
  getJobEventsAfter,
  deleteJobEvents,
} = _default;
