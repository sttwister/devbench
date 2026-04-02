// @lat: [[tests#Database#Merge Requests CRUD]]
import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase } from "../db.ts";

describe("Merge Requests CRUD", () => {
  let db: ReturnType<typeof createDatabase>;
  let projectId: number;
  let sessionId: number;

  beforeEach(() => {
    db = createDatabase(":memory:");
    projectId = db.addProject("proj", "/tmp/proj").id;
    sessionId = db.addSession(projectId, "session1", "claude", "tmux_1").id;
  });

  it("creates a merge request and retrieves by URL", () => {
    const mr = db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId);
    expect(mr).not.toBeNull();
    expect(mr!.url).toBe("https://github.com/o/r/pull/1");
    expect(mr!.provider).toBe("github");
    expect(mr!.state).toBe("open");
    expect(mr!.session_id).toBe(sessionId);
    expect(mr!.project_id).toBe(projectId);
    expect(mr!.draft).toBe(false);
    expect(mr!.approved).toBe(false);

    const retrieved = db.getMergeRequestByUrl("https://github.com/o/r/pull/1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(mr!.id);
  });

  it("returns null for nonexistent URL", () => {
    expect(db.getMergeRequestByUrl("https://nonexistent.com")).toBeNull();
  });

  it("upserts on duplicate URL (updates session_id)", () => {
    const session2 = db.addSession(projectId, "session2", "claude", "tmux_2");
    db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId);
    db.addMergeRequest("https://github.com/o/r/pull/1", "github", session2.id, projectId);

    const mr = db.getMergeRequestByUrl("https://github.com/o/r/pull/1");
    expect(mr).not.toBeNull();
    expect(mr!.session_id).toBe(session2.id);
  });

  it("preserves existing session_id when upserting with null", () => {
    db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId);
    db.addMergeRequest("https://github.com/o/r/pull/1", "github", null, projectId);

    const mr = db.getMergeRequestByUrl("https://github.com/o/r/pull/1");
    expect(mr).not.toBeNull();
    expect(mr!.session_id).toBe(sessionId);
  });

  it("retrieves merge requests by session", () => {
    db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId);
    db.addMergeRequest("https://github.com/o/r/pull/2", "github", sessionId, projectId);

    const session2 = db.addSession(projectId, "session2", "claude", "tmux_2");
    db.addMergeRequest("https://github.com/o/r/pull/3", "github", session2.id, projectId);

    const mrs = db.getMergeRequestsBySession(sessionId);
    expect(mrs).toHaveLength(2);
    expect(mrs.map((m) => m.url)).toEqual([
      "https://github.com/o/r/pull/1",
      "https://github.com/o/r/pull/2",
    ]);
  });

  it("retrieves merge requests by project", () => {
    db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId);

    const project2 = db.addProject("proj2", "/tmp/proj2");
    const session2 = db.addSession(project2.id, "s2", "claude", "tmux_2");
    db.addMergeRequest("https://github.com/o/r/pull/2", "github", session2.id, project2.id);

    const mrs = db.getMergeRequestsByProject(projectId);
    expect(mrs).toHaveLength(1);
    expect(mrs[0].url).toBe("https://github.com/o/r/pull/1");
  });

  it("gets all merge requests", () => {
    db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId);
    db.addMergeRequest("https://gitlab.com/g/p/-/merge_requests/5", "gitlab", sessionId, projectId);

    const all = db.getAllMergeRequests();
    expect(all).toHaveLength(2);
  });

  it("gets open merge requests for active sessions only", () => {
    db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId);

    // Create archived session with MR
    const archivedSession = db.addSession(projectId, "archived", "claude", "tmux_2");
    db.addMergeRequest("https://github.com/o/r/pull/2", "github", archivedSession.id, projectId);
    db.archiveSession(archivedSession.id);

    const openActive = db.getOpenMergeRequestsForActiveSessions();
    expect(openActive).toHaveLength(1);
    expect(openActive[0].url).toBe("https://github.com/o/r/pull/1");
  });

  it("updates merge request status", () => {
    const mr = db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId)!;

    db.updateMergeRequestStatus(mr.id, {
      state: "merged",
      draft: false,
      approved: true,
      changes_requested: false,
      pipeline_status: "success",
      auto_merge: false,
      last_checked: "2026-01-01T00:00:00Z",
    });

    const updated = db.getMergeRequestByUrl("https://github.com/o/r/pull/1")!;
    expect(updated.state).toBe("merged");
    expect(updated.approved).toBe(true);
    expect(updated.pipeline_status).toBe("success");
    expect(updated.last_checked).toBe("2026-01-01T00:00:00Z");
  });

  it("removes merge request by id", () => {
    const mr = db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId)!;
    expect(db.removeMergeRequest(mr.id)).toBe(true);
    expect(db.getMergeRequestByUrl("https://github.com/o/r/pull/1")).toBeNull();
  });

  it("removes merge request by URL", () => {
    db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId);
    expect(db.removeMergeRequestByUrl("https://github.com/o/r/pull/1")).toBe(true);
    expect(db.getMergeRequestByUrl("https://github.com/o/r/pull/1")).toBeNull();
  });

  it("cascades session deletion to SET NULL", () => {
    db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId);
    db.removeSession(sessionId);

    const mr = db.getMergeRequestByUrl("https://github.com/o/r/pull/1");
    expect(mr).not.toBeNull();
    expect(mr!.session_id).toBeNull();
  });

  it("cascades project deletion to DELETE", () => {
    db.addMergeRequest("https://github.com/o/r/pull/1", "github", sessionId, projectId);
    db.removeProject(projectId);

    expect(db.getMergeRequestByUrl("https://github.com/o/r/pull/1")).toBeNull();
  });

  it("handles GitLab provider", () => {
    const mr = db.addMergeRequest(
      "https://gitlab.com/group/project/-/merge_requests/42",
      "gitlab",
      sessionId,
      projectId,
    )!;
    expect(mr.provider).toBe("gitlab");
  });

  it("handles merge request without session", () => {
    const mr = db.addMergeRequest("https://github.com/o/r/pull/1", "github", null, projectId)!;
    expect(mr.session_id).toBeNull();
  });
});
