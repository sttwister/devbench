export interface Project {
  id: number;
  name: string;
  path: string;
  browser_url: string | null;
  created_at: string;
  sessions: Session[];
}

export interface Session {
  id: number;
  project_id: number;
  name: string;
  type: "terminal" | "claude" | "pi" | "codex";
  tmux_name: string;
  status: string;
  created_at: string;
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function createProject(
  name: string,
  path: string,
  browserUrl?: string
): Promise<Project> {
  const body: Record<string, unknown> = { name, path };
  if (browserUrl) body.browser_url = browserUrl;
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to create project");
  }
  return res.json();
}

export async function deleteProject(id: number): Promise<void> {
  await fetch(`/api/projects/${id}`, { method: "DELETE" });
}

export async function createSession(
  projectId: number,
  name: string,
  type: "terminal" | "claude" | "pi" | "codex"
): Promise<Session> {
  const res = await fetch(`/api/projects/${projectId}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to create session");
  }
  return res.json();
}

export async function deleteSession(id: number): Promise<void> {
  await fetch(`/api/sessions/${id}`, { method: "DELETE" });
}

export async function renameSession(id: number, name: string): Promise<Session> {
  const res = await fetch(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const d = await res.json();
    throw new Error(d.error || "Failed to rename session");
  }
  return res.json();
}

export async function updateProject(
  id: number,
  data: { name?: string; path?: string; browser_url?: string | null }
): Promise<Project> {
  const res = await fetch(`/api/projects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const d = await res.json();
    throw new Error(d.error || "Failed to update project");
  }
  return res.json();
}
