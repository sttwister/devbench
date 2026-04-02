import { describe, it, expect } from "vitest";
import { createDatabase } from "../db.ts";

// @lat: [[tests#Database#Schema Integrity]]

describe("Fresh database schema", () => {
  it("has all project columns on a fresh DB", () => {
    const db = createDatabase(":memory:");
    const p = db.addProject("test", "/tmp/test", "http://localhost", "mobile");
    expect(p).toMatchObject({
      name: "test",
      path: "/tmp/test",
      browser_url: "http://localhost",
      default_view_mode: "mobile",
    });
    expect(p.id).toBeGreaterThan(0);
    expect(p.created_at).toBeTruthy();
  });

  it("has all session columns on a fresh DB", () => {
    const db = createDatabase(":memory:");
    const p = db.addProject("proj", "/tmp/proj");
    const s = db.addSession(p.id, "Claude Code 1", "claude", "tmux_1");

    // Verify all parsed fields exist
    expect(s).toMatchObject({
      name: "Claude Code 1",
      type: "claude",
      tmux_name: "tmux_1",
      status: "active",
      mr_urls: [],
      agent_session_id: null,
      browser_open: false,
      view_mode: null,
    });
  });

  it("supports sort_order on projects from a fresh DB", () => {
    const db = createDatabase(":memory:");
    const a = db.addProject("a", "/tmp/a");
    const b = db.addProject("b", "/tmp/b");
    const c = db.addProject("c", "/tmp/c");

    db.reorderProjects([c.id, a.id, b.id]);
    const ordered = db.getProjects();
    expect(ordered.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
  });

  it("supports sort_order on sessions from a fresh DB", () => {
    const db = createDatabase(":memory:");
    const p = db.addProject("proj", "/tmp/proj");
    const s1 = db.addSession(p.id, "s1", "terminal", "t1");
    const s2 = db.addSession(p.id, "s2", "terminal", "t2");
    const s3 = db.addSession(p.id, "s3", "terminal", "t3");

    db.reorderSessions(p.id, [s3.id, s1.id, s2.id]);
    const ordered = db.getSessionsByProject(p.id);
    expect(ordered.map((s) => s.id)).toEqual([s3.id, s1.id, s2.id]);
  });

  it("supports browser_open and view_mode on sessions", () => {
    const db = createDatabase(":memory:");
    const p = db.addProject("proj", "/tmp/proj");
    const s = db.addSession(p.id, "s1", "terminal", "t1");

    db.updateSessionBrowserState(s.id, true, "mobile");
    const updated = db.getSession(s.id)!;
    expect(updated.browser_open).toBe(true);
    expect(updated.view_mode).toBe("mobile");
  });

  it("supports agent_session_id on sessions", () => {
    const db = createDatabase(":memory:");
    const p = db.addProject("proj", "/tmp/proj");
    const s = db.addSession(p.id, "agent", "claude", "t1");

    db.updateSessionAgentId(s.id, "uuid-abc-123");
    expect(db.getSession(s.id)!.agent_session_id).toBe("uuid-abc-123");
  });

  it("auto-increments sort_order for new projects", () => {
    const db = createDatabase(":memory:");
    db.addProject("a", "/tmp/a");
    db.addProject("b", "/tmp/b");
    db.addProject("c", "/tmp/c");

    // All three should be retrievable in insertion order
    const all = db.getProjects();
    expect(all).toHaveLength(3);
    expect(all[0].name).toBe("a");
    expect(all[1].name).toBe("b");
    expect(all[2].name).toBe("c");
  });

  it("supports source_url and source_type via updateSessionSource", () => {
    const db = createDatabase(":memory:");
    const p = db.addProject("proj", "/tmp/proj");
    const s = db.addSession(p.id, "s1", "claude", "t1");

    db.updateSessionSource(s.id, "https://myco.atlassian.net/browse/PROJ-123", "jira");
    const updated = db.getSession(s.id)!;
    expect(updated.source_url).toBe("https://myco.atlassian.net/browse/PROJ-123");
    expect(updated.source_type).toBe("jira");
  });

  it("clears source_url and source_type via updateSessionSource", () => {
    const db = createDatabase(":memory:");
    const p = db.addProject("proj", "/tmp/proj");
    const s = db.addSession(p.id, "s1", "claude", "t1");

    db.updateSessionSource(s.id, "https://example.com", "jira");
    db.updateSessionSource(s.id, null, null);

    const updated = db.getSession(s.id)!;
    expect(updated.source_url).toBeNull();
    expect(updated.source_type).toBeNull();
  });

  it("has merge_requests table on a fresh DB", () => {
    const db = createDatabase(":memory:");
    const p = db.addProject("proj", "/tmp/proj");
    const s = db.addSession(p.id, "agent", "claude", "t1");

    const mr = db.addMergeRequest("https://github.com/o/r/pull/1", "github", s.id, p.id);
    expect(mr).not.toBeNull();
    expect(mr!.url).toBe("https://github.com/o/r/pull/1");
    expect(mr!.provider).toBe("github");
    expect(mr!.state).toBe("open");
    expect(mr!.session_id).toBe(s.id);
    expect(mr!.project_id).toBe(p.id);
  });

  it("auto-increments sort_order for new sessions", () => {
    const db = createDatabase(":memory:");
    const p = db.addProject("proj", "/tmp/proj");
    db.addSession(p.id, "s1", "terminal", "t1");
    db.addSession(p.id, "s2", "terminal", "t2");
    db.addSession(p.id, "s3", "terminal", "t3");

    const sessions = db.getSessionsByProject(p.id);
    expect(sessions).toHaveLength(3);
    expect(sessions[0].name).toBe("s1");
    expect(sessions[1].name).toBe("s2");
    expect(sessions[2].name).toBe("s3");
  });
});
