import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const db = new Database("./devbench.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL DEFAULT 'Session',
    type TEXT NOT NULL CHECK(type IN ('terminal', 'claude')),
    status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle', 'waiting', 'working', 'done', 'error')),
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

export interface Project {
  id: number;
  name: string;
  path: string;
  created_at: string;
}

export interface Session {
  id: number;
  project_id: number;
  name: string;
  type: "terminal" | "claude";
  status: "idle" | "waiting" | "working" | "done" | "error";
  created_at: string;
}

export function getProjects(): Project[] {
  return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all() as Project[];
}

export function createProject(name: string, path: string): Project {
  const stmt = db.prepare("INSERT INTO projects (name, path) VALUES (?, ?) RETURNING *");
  return stmt.get(name, path) as Project;
}

export function deleteProject(id: number): void {
  db.prepare("DELETE FROM sessions WHERE project_id = ?").run(id);
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

export function getSessionsByProject(projectId: number): Session[] {
  return db
    .prepare("SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at ASC")
    .all(projectId) as Session[];
}

export function createSession(projectId: number, name: string, type: string): Session {
  const stmt = db.prepare(
    "INSERT INTO sessions (project_id, name, type) VALUES (?, ?, ?) RETURNING *"
  );
  return stmt.get(projectId, name, type) as Session;
}

export function getSession(id: number): Session | undefined {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as Session | undefined;
}

export function deleteSession(id: number): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function getProjectById(id: number): Project | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
}
