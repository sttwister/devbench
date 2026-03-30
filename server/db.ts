import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Project, Session, SessionType, RawSessionRow, MrStatus } from "@devbench/shared";

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
    browser_open: !!raw.browser_open,
    view_mode: raw.view_mode ?? null,
    created_at: raw.created_at,
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
      browser_open INTEGER DEFAULT 0,
      view_mode TEXT DEFAULT NULL,
      sort_order INTEGER DEFAULT 0,
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
    selectProject: db.prepare("SELECT * FROM projects WHERE id = ?"),
    deleteProject: db.prepare("DELETE FROM projects WHERE id = ?"),
    insertSession: db.prepare(
      "INSERT INTO sessions (project_id, name, type, tmux_name, source_url, source_type, sort_order) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sessions WHERE project_id = ?))"
    ),
    selectSessionsByProject: db.prepare(
      "SELECT * FROM sessions WHERE project_id = ? AND status = 'active' ORDER BY sort_order, created_at"
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
    getSetting: db.prepare("SELECT value FROM settings WHERE key = ?"),
    upsertSetting: db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"),
    deleteSetting: db.prepare("DELETE FROM settings WHERE key = ?"),
    getAllSettings: db.prepare("SELECT key, value FROM settings"),
  };

  // ── Public API ──────────────────────────────────────────────────

  function getProjects(): Project[] {
    return stmts.selectProjects.all() as Project[];
  }

  function getProject(id: number): Project | null {
    return (stmts.selectProject.get(id) as Project) ?? null;
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

  return {
    getProjects,
    getProject,
    addProject,
    updateProjectBrowserUrl,
    updateProject,
    removeProject,
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
    getSetting,
    setSetting,
    deleteSetting,
    getAllSettings,
  };
}

// ── Default instance ────────────────────────────────────────────────

const _default = createDatabase(DB_PATH);

export const {
  getProjects,
  getProject,
  addProject,
  updateProjectBrowserUrl,
  updateProject,
  removeProject,
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
  getSetting,
  setSetting,
  deleteSetting,
  getAllSettings,
} = _default;
