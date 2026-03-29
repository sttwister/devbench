import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { Project, Session, SessionType } from "@devbench/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "devbench.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
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
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )
`);

// Migration: update sessions type CHECK constraint for new types
{
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
}

// Migration: add mr_url column to sessions
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN mr_url TEXT DEFAULT NULL`);
} catch (e: any) {
  if (!e.message?.includes("duplicate column")) throw e;
}

// Migration: add browser_url column
try {
  db.exec(`ALTER TABLE projects ADD COLUMN browser_url TEXT DEFAULT NULL`);
} catch (e: any) {
  if (!e.message?.includes("duplicate column")) throw e;
}

// Migration: add default_view_mode column
try {
  db.exec(`ALTER TABLE projects ADD COLUMN default_view_mode TEXT DEFAULT 'desktop'`);
} catch (e: any) {
  if (!e.message?.includes("duplicate column")) throw e;
}

// Migration: add browser_open and view_mode columns to sessions
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN browser_open INTEGER DEFAULT 0`);
} catch (e: any) {
  if (!e.message?.includes("duplicate column")) throw e;
}
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN view_mode TEXT DEFAULT NULL`);
} catch (e: any) {
  if (!e.message?.includes("duplicate column")) throw e;
}

// Migration: add agent_session_id column to sessions
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN agent_session_id TEXT DEFAULT NULL`);
} catch (e: any) {
  if (!e.message?.includes("duplicate column")) throw e;
}

// Migration: add sort_order column to projects
try {
  db.exec(`ALTER TABLE projects ADD COLUMN sort_order INTEGER DEFAULT 0`);
  const rows = db.prepare("SELECT id FROM projects ORDER BY name").all() as { id: number }[];
  const upd = db.prepare("UPDATE projects SET sort_order = ? WHERE id = ?");
  rows.forEach((r, i) => upd.run(i, r.id));
} catch (e: any) {
  if (!e.message?.includes("duplicate column")) throw e;
}

// Migration: add sort_order column to sessions
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN sort_order INTEGER DEFAULT 0`);
  const rows = db.prepare("SELECT id, project_id FROM sessions ORDER BY created_at").all() as { id: number; project_id: number }[];
  const upd = db.prepare("UPDATE sessions SET sort_order = ? WHERE id = ?");
  const counters: Record<number, number> = {};
  rows.forEach((r) => {
    const idx = counters[r.project_id] ?? 0;
    upd.run(idx, r.id);
    counters[r.project_id] = idx + 1;
  });
} catch (e: any) {
  if (!e.message?.includes("duplicate column")) throw e;
}

const stmts = {
  insertProject: db.prepare("INSERT INTO projects (name, path, browser_url, default_view_mode, sort_order) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM projects))"),
  updateBrowserUrl: db.prepare("UPDATE projects SET browser_url = ? WHERE id = ?"),
  updateProject: db.prepare("UPDATE projects SET name = ?, path = ?, browser_url = ?, default_view_mode = ? WHERE id = ?"),
  selectProjects: db.prepare("SELECT * FROM projects ORDER BY sort_order, name"),
  selectProject: db.prepare("SELECT * FROM projects WHERE id = ?"),
  deleteProject: db.prepare("DELETE FROM projects WHERE id = ?"),
  insertSession: db.prepare(
    "INSERT INTO sessions (project_id, name, type, tmux_name, sort_order) VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sessions WHERE project_id = ?1))"
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
};

export type { Project, Session, SessionType };

/** Convert a raw DB row (mr_url TEXT) into a Session with mr_urls: string[] */
function parseSession(raw: any): Session {
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
  return {
    id: raw.id,
    project_id: raw.project_id,
    name: raw.name,
    type: raw.type,
    tmux_name: raw.tmux_name,
    status: raw.status,
    mr_urls,
    agent_session_id: raw.agent_session_id ?? null,
    browser_open: !!raw.browser_open,
    view_mode: raw.view_mode ?? null,
    created_at: raw.created_at,
  };
}

export function getProjects(): Project[] {
  return stmts.selectProjects.all() as Project[];
}

export function getProject(id: number): Project | null {
  return (stmts.selectProject.get(id) as Project) ?? null;
}

export function addProject(name: string, path: string, browserUrl?: string | null, defaultViewMode?: string | null): Project {
  const info = stmts.insertProject.run(name, path, browserUrl ?? null, defaultViewMode ?? "desktop");
  return getProject(Number(info.lastInsertRowid))!;
}

export function updateProjectBrowserUrl(id: number, browserUrl: string | null): boolean {
  return stmts.updateBrowserUrl.run(browserUrl, id).changes > 0;
}

export function updateProject(
  id: number,
  name: string,
  projectPath: string,
  browserUrl: string | null,
  defaultViewMode?: string | null
): boolean {
  return stmts.updateProject.run(name, projectPath, browserUrl, defaultViewMode ?? "desktop", id).changes > 0;
}

export function removeProject(id: number): boolean {
  return stmts.deleteProject.run(id).changes > 0;
}

export function getSessionsByProject(projectId: number): Session[] {
  return (stmts.selectSessionsByProject.all(projectId) as any[]).map(parseSession);
}

export function getAllSessions(): Session[] {
  return (stmts.selectAllSessions.all() as any[]).map(parseSession);
}

export function getSession(id: number): Session | null {
  const raw = stmts.selectSession.get(id);
  return raw ? parseSession(raw) : null;
}

export function addSession(
  projectId: number,
  name: string,
  type: SessionType,
  tmuxName: string
): Session {
  const info = stmts.insertSession.run(projectId, name, type, tmuxName);
  return getSession(Number(info.lastInsertRowid))!;
}

export function renameSession(id: number, name: string): boolean {
  return stmts.renameSession.run(name, id).changes > 0;
}

export function removeSession(id: number): boolean {
  return stmts.deleteSession.run(id).changes > 0;
}

export function archiveSession(id: number): boolean {
  return stmts.archiveSession.run(id).changes > 0;
}

export function updateSessionMrUrls(id: number, mrUrls: string[]): boolean {
  const json = mrUrls.length > 0 ? JSON.stringify(mrUrls) : null;
  return stmts.updateSessionMrUrl.run(json, id).changes > 0;
}

export function updateSessionBrowserState(id: number, browserOpen: boolean, viewMode: string | null): boolean {
  return stmts.updateSessionBrowserState.run(browserOpen ? 1 : 0, viewMode, id).changes > 0;
}

export function getArchivedSessionsByProject(projectId: number): Session[] {
  return (stmts.selectArchivedSessionsByProject.all(projectId) as any[]).map(parseSession);
}

export function unarchiveSession(id: number): boolean {
  return stmts.unarchiveSession.run(id).changes > 0;
}

export function updateSessionAgentId(id: number, agentSessionId: string | null): boolean {
  return stmts.updateSessionAgentId.run(agentSessionId, id).changes > 0;
}

export function updateSessionTmuxName(id: number, tmuxName: string): boolean {
  return stmts.updateSessionTmuxName.run(tmuxName, id).changes > 0;
}

export function reorderProjects(orderedIds: number[]): void {
  const stmt = db.prepare("UPDATE projects SET sort_order = ? WHERE id = ?");
  db.transaction(() => {
    orderedIds.forEach((id, index) => stmt.run(index, id));
  })();
}

export function reorderSessions(projectId: number, orderedIds: number[]): void {
  const stmt = db.prepare("UPDATE sessions SET sort_order = ? WHERE id = ? AND project_id = ?");
  db.transaction(() => {
    orderedIds.forEach((id, index) => stmt.run(index, id, projectId));
  })();
}
