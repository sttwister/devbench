import type { ProjectWithSessions, Session, SessionType } from "@devbench/shared";

export type { Session, SessionType };
export type Project = ProjectWithSessions;

/** Derive a short display label from an MR/PR URL. */
export function getMrLabel(url: string): string {
  const gitlabMr = url.match(/\/-\/merge_requests\/(\d+)/);
  if (gitlabMr) return `!${gitlabMr[1]}`;
  const githubPr = url.match(/\/pull\/(\d+)/);
  if (githubPr) return `#${githubPr[1]}`;
  const bbPr = url.match(/\/pull-requests\/(\d+)/);
  if (bbPr) return `#${bbPr[1]}`;
  if (url.includes("/merge_requests/new")) return "MR";
  if (url.includes("/pull/new/")) return "PR";
  return "MR";
}

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  return res.json();
}

export async function createProject(
  name: string,
  path: string,
  browserUrl?: string,
  defaultViewMode?: string
): Promise<Project> {
  const body: Record<string, unknown> = { name, path };
  if (browserUrl) body.browser_url = browserUrl;
  if (defaultViewMode) body.default_view_mode = defaultViewMode;
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
  type: SessionType
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

export async function deleteSessionPermanently(id: number): Promise<void> {
  await fetch(`/api/sessions/${id}?permanent=1`, { method: "DELETE" });
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
  data: { name?: string; path?: string; browser_url?: string | null; default_view_mode?: string }
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

export type AgentStatus = "working" | "waiting";

export async function fetchAgentStatuses(): Promise<Record<string, AgentStatus>> {
  try {
    const res = await fetch("/api/agent-statuses");
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export async function updateSessionBrowserState(
  id: number,
  browserOpen: boolean,
  viewMode: string | null
): Promise<void> {
  await fetch(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ browser_open: browserOpen, view_mode: viewMode }),
  });
}

export async function fetchArchivedSessions(projectId: number): Promise<Session[]> {
  const res = await fetch(`/api/projects/${projectId}/archived-sessions`);
  if (!res.ok) throw new Error("Failed to fetch archived sessions");
  return res.json();
}

export async function fetchOrphanedSessions(): Promise<number[]> {
  try {
    const res = await fetch("/api/orphaned-sessions");
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export async function reviveSession(id: number): Promise<Session> {
  const res = await fetch(`/api/sessions/${id}/revive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const d = await res.json();
    throw new Error(d.error || "Failed to revive session");
  }
  return res.json();
}
