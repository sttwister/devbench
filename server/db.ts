import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

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
    type TEXT NOT NULL CHECK(type IN ('terminal', 'claude')),
    tmux_name TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )
`);

// Migration: add browser_url column
try {
  db.exec(`ALTER TABLE projects ADD COLUMN browser_url TEXT DEFAULT NULL`);
} catch (e: any) {
  if (!e.message?.includes("duplicate column")) throw e;
}

const stmts = {
  insertProject: db.prepare("INSERT INTO projects (name, path, browser_url) VALUES (?, ?, ?)"),
  updateBrowserUrl: db.prepare("UPDATE projects SET browser_url = ? WHERE id = ?"),
  selectProjects: db.prepare("SELECT * FROM projects ORDER BY name"),
  selectProject: db.prepare("SELECT * FROM projects WHERE id = ?"),
  deleteProject: db.prepare("DELETE FROM projects WHERE id = ?"),
  insertSession: db.prepare(
    "INSERT INTO sessions (project_id, name, type, tmux_name) VALUES (?, ?, ?, ?)"
  ),
  selectSessionsByProject: db.prepare(
    "SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at"
  ),
  selectSession: db.prepare("SELECT * FROM sessions WHERE id = ?"),
  deleteSession: db.prepare("DELETE FROM sessions WHERE id = ?"),
  selectAllSessions: db.prepare("SELECT * FROM sessions ORDER BY created_at"),
};

export interface Project {
  id: number;
  name: string;
  path: string;
  browser_url: string | null;
  created_at: string;
}

export interface Session {
  id: number;
  project_id: number;
  name: string;
  type: "terminal" | "claude";
  tmux_name: string;
  status: string;
  created_at: string;
}

export function getProjects(): Project[] {
  return stmts.selectProjects.all() as Project[];
}

export function getProject(id: number): Project | null {
  return (stmts.selectProject.get(id) as Project) ?? null;
}

export function addProject(name: string, path: string, browserUrl?: string | null): Project {
  const info = stmts.insertProject.run(name, path, browserUrl ?? null);
  return getProject(Number(info.lastInsertRowid))!;
}

export function updateProjectBrowserUrl(id: number, browserUrl: string | null): boolean {
  return stmts.updateBrowserUrl.run(browserUrl, id).changes > 0;
}

export function removeProject(id: number): boolean {
  return stmts.deleteProject.run(id).changes > 0;
}

export function getSessionsByProject(projectId: number): Session[] {
  return stmts.selectSessionsByProject.all(projectId) as Session[];
}

export function getAllSessions(): Session[] {
  return stmts.selectAllSessions.all() as Session[];
}

export function getSession(id: number): Session | null {
  return (stmts.selectSession.get(id) as Session) ?? null;
}

export function addSession(
  projectId: number,
  name: string,
  type: "terminal" | "claude",
  tmuxName: string
): Session {
  const info = stmts.insertSession.run(projectId, name, type, tmuxName);
  return getSession(Number(info.lastInsertRowid))!;
}

export function removeSession(id: number): boolean {
  return stmts.deleteSession.run(id).changes > 0;
}
