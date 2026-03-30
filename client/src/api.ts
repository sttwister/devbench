import type { ProjectWithSessions, Session, SessionType, AgentStatus, MrStatus, ProjectDashboard, PullResult, MergeResult, UnapplyResult, PushResult } from "@devbench/shared";
export { getMrLabel, getMrStatusClass, getMrStatusTooltip, getSessionIcon, getSessionLabel, SESSION_TYPES_LIST } from "@devbench/shared";
export { detectSourceType, getSourceLabel, getSourceIcon } from "@devbench/shared";
export type { SessionTypeConfig, SourceType, MrStatus, ProjectDashboard, PullResult, MergeResult, PushResult } from "@devbench/shared";
export type { DashboardBranch, DashboardStack, ButChange, ButCommit, LinkedSession, UnapplyResult } from "@devbench/shared";

export type { Session, SessionType, AgentStatus };
export type Project = ProjectWithSessions;

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
  const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || "Failed to delete project");
  }
}

export async function createSession(
  projectId: number,
  name: string,
  type: SessionType,
  sourceUrl?: string | null
): Promise<Session> {
  const body: Record<string, unknown> = { name, type };
  if (sourceUrl) body.source_url = sourceUrl;
  const res = await fetch(`/api/projects/${projectId}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to create session");
  }
  return res.json();
}

export async function deleteSession(id: number): Promise<void> {
  const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || "Failed to delete session");
  }
}

export async function deleteSessionPermanently(id: number): Promise<void> {
  const res = await fetch(`/api/sessions/${id}?permanent=1`, { method: "DELETE" });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || "Failed to delete session");
  }
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

export async function fetchAgentStatuses(): Promise<Record<string, AgentStatus>> {
  try {
    const res = await fetch("/api/agent-statuses");
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export interface PollData {
  agentStatuses: Record<string, AgentStatus>;
  orphanedSessionIds: number[];
}

/** Combined poll — fetches agent statuses and orphaned IDs in a single request. */
export async function fetchPollData(): Promise<PollData> {
  try {
    const res = await fetch("/api/poll");
    if (!res.ok) return { agentStatuses: {}, orphanedSessionIds: [] };
    return res.json();
  } catch {
    return { agentStatuses: {}, orphanedSessionIds: [] };
  }
}

export async function updateSessionSource(id: number, sourceUrl: string | null): Promise<Session> {
  const res = await fetch(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_url: sourceUrl }),
  });
  if (!res.ok) {
    const d = await res.json();
    throw new Error(d.error || "Failed to update source URL");
  }
  return res.json();
}

export async function removeMrUrl(id: number, url: string): Promise<Session> {
  const res = await fetch(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ remove_mr_url: url }),
  });
  if (!res.ok) {
    const d = await res.json();
    throw new Error(d.error || "Failed to remove MR URL");
  }
  return res.json();
}

export async function addMrUrl(id: number, url: string): Promise<Session> {
  const res = await fetch(`/api/sessions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ add_mr_url: url }),
  });
  if (!res.ok) {
    const d = await res.json();
    throw new Error(d.error || "Failed to add MR URL");
  }
  return res.json();
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

export async function reorderProjects(order: number[]): Promise<void> {
  await fetch("/api/projects/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
}

export async function reorderSessions(projectId: number, order: number[]): Promise<void> {
  await fetch(`/api/projects/${projectId}/sessions/reorder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order }),
  });
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

// ── Settings API ──────────────────────────────────────────────────

export async function fetchSettings(): Promise<Record<string, string>> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}

export async function updateSetting(key: string, value: string): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || "Failed to update setting");
  }
}

export interface TokenValidation {
  valid: boolean;
  user?: string;
  error?: string;
}

export async function validateToken(key: string): Promise<TokenValidation> {
  const res = await fetch("/api/settings/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  return res.json();
}

// ── GitButler Dashboard API ───────────────────────────────────────

export async function fetchGitButlerStatus(projectId: number, force = false): Promise<ProjectDashboard> {
  const qs = force ? "?force=1" : "";
  const res = await fetch(`/api/projects/${projectId}/gitbutler${qs}`);
  if (!res.ok) throw new Error("Failed to fetch GitButler status");
  return res.json();
}

export async function fetchAllGitButlerStatus(force = false): Promise<ProjectDashboard[]> {
  const qs = force ? "?force=1" : "";
  const res = await fetch(`/api/gitbutler${qs}`);
  if (!res.ok) throw new Error("Failed to fetch GitButler status");
  return res.json();
}

export async function gitButlerPull(projectId: number): Promise<PullResult> {
  const res = await fetch(`/api/projects/${projectId}/gitbutler/pull`, { method: "POST" });
  if (!res.ok) throw new Error("Pull failed");
  return res.json();
}

export async function gitButlerPullAll(): Promise<PullResult[]> {
  const res = await fetch("/api/gitbutler/pull-all", { method: "POST" });
  if (!res.ok) throw new Error("Pull failed");
  return res.json();
}

export async function unapplyBranch(projectId: number, branch: string): Promise<UnapplyResult> {
  const res = await fetch(`/api/projects/${projectId}/gitbutler/unapply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch }),
  });
  if (!res.ok) throw new Error("Unapply failed");
  return res.json();
}

export async function pushBranch(projectId: number, branch: string, force = false): Promise<PushResult> {
  const res = await fetch(`/api/projects/${projectId}/gitbutler/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch, force }),
  });
  if (!res.ok) throw new Error("Push failed");
  return res.json();
}

export async function pushAll(): Promise<PushResult[]> {
  const res = await fetch("/api/gitbutler/push-all", { method: "POST" });
  if (!res.ok) throw new Error("Push failed");
  return res.json();
}

// ── File Upload API ───────────────────────────────────────────────

/** Upload a file to the server tmp directory. Returns the saved file path. */
export async function uploadFile(file: File | Blob, filename?: string): Promise<string> {
  const name = filename || (file instanceof File ? file.name : "upload");
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": name,
    },
    body: file,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || "Upload failed");
  }
  const data = await res.json();
  return data.path;
}

export async function mergeMrs(urls: string[]): Promise<{ mergeResults: MergeResult[]; pullResults: PullResult[] | null }> {
  const res = await fetch("/api/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) throw new Error("Merge failed");
  return res.json();
}
