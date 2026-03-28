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

export interface ProjectWithSessions extends Project {
  sessions: Session[];
}

const BASE = "/api";

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${BASE}/projects`);
  return res.json();
}

export async function fetchSessions(projectId: number): Promise<Session[]> {
  const res = await fetch(`${BASE}/projects/${projectId}/sessions`);
  return res.json();
}

export async function createProject(name: string, path: string): Promise<Project> {
  const res = await fetch(`${BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, path }),
  });
  return res.json();
}

export async function deleteProject(id: number): Promise<void> {
  await fetch(`${BASE}/projects/${id}`, { method: "DELETE" });
}

export async function createSession(
  projectId: number,
  name: string,
  type: "terminal" | "claude"
): Promise<Session> {
  const res = await fetch(`${BASE}/projects/${projectId}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type }),
  });
  return res.json();
}

export async function deleteSession(id: number): Promise<void> {
  await fetch(`${BASE}/sessions/${id}`, { method: "DELETE" });
}
