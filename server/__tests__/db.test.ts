import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase, parseSession } from "../db.ts";

// @lat: [[tests#Database#Row Parsing]]

// ── parseSession (pure function) ────────────────────────────────────

describe("parseSession", () => {
  const baseRow = {
    id: 1,
    project_id: 10,
    name: "test-session",
    type: "claude",
    tmux_name: "devbench_10_123",
    status: "active",
    mr_url: null,
    agent_session_id: null,
    browser_open: 0,
    view_mode: null,
    created_at: "2026-01-01 00:00:00",
  };

  it("returns empty mr_urls when mr_url is null", () => {
    const session = parseSession({ ...baseRow, mr_url: null });
    expect(session.mr_urls).toEqual([]);
  });

  it("parses JSON array mr_url", () => {
    const urls = ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"];
    const session = parseSession({ ...baseRow, mr_url: JSON.stringify(urls) });
    expect(session.mr_urls).toEqual(urls);
  });

  it("wraps JSON string mr_url in an array", () => {
    const session = parseSession({
      ...baseRow,
      mr_url: JSON.stringify("https://github.com/o/r/pull/1"),
    });
    expect(session.mr_urls).toEqual(["https://github.com/o/r/pull/1"]);
  });

  it("handles legacy plain URL string (non-JSON)", () => {
    const session = parseSession({
      ...baseRow,
      mr_url: "https://github.com/o/r/pull/1",
    });
    expect(session.mr_urls).toEqual(["https://github.com/o/r/pull/1"]);
  });

  it("converts browser_open 0 to false", () => {
    const session = parseSession({ ...baseRow, browser_open: 0 });
    expect(session.browser_open).toBe(false);
  });

  it("converts browser_open 1 to true", () => {
    const session = parseSession({ ...baseRow, browser_open: 1 });
    expect(session.browser_open).toBe(true);
  });

  it("defaults agent_session_id to null", () => {
    const session = parseSession({ ...baseRow, agent_session_id: undefined });
    expect(session.agent_session_id).toBeNull();
  });

  it("preserves agent_session_id when set", () => {
    const session = parseSession({ ...baseRow, agent_session_id: "uuid-123" });
    expect(session.agent_session_id).toBe("uuid-123");
  });

  it("defaults view_mode to null", () => {
    const session = parseSession({ ...baseRow, view_mode: undefined });
    expect(session.view_mode).toBeNull();
  });

  it("preserves all scalar fields", () => {
    const session = parseSession(baseRow);
    expect(session.id).toBe(1);
    expect(session.project_id).toBe(10);
    expect(session.name).toBe("test-session");
    expect(session.type).toBe("claude");
    expect(session.tmux_name).toBe("devbench_10_123");
    expect(session.status).toBe("active");
    expect(session.created_at).toBe("2026-01-01 00:00:00");
  });
});

// ── CRUD operations (using in-memory database) ─────────────────────

// @lat: [[tests#Database#CRUD Operations]]
describe("Database CRUD", () => {
  let db: ReturnType<typeof createDatabase>;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  // ── Projects ────────────────────────────────────────────────────

  describe("projects", () => {
    it("adds and retrieves a project", () => {
      const project = db.addProject("myapp", "/tmp/myapp");
      expect(project.name).toBe("myapp");
      expect(project.path).toBe("/tmp/myapp");
      expect(project.id).toBeGreaterThan(0);

      const retrieved = db.getProject(project.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("myapp");
    });

    it("returns null for nonexistent project", () => {
      expect(db.getProject(999)).toBeNull();
    });

    it("lists all projects", () => {
      db.addProject("a", "/tmp/a");
      db.addProject("b", "/tmp/b");
      const all = db.getProjects();
      expect(all).toHaveLength(2);
    });

    it("stores browser_url and default_view_mode", () => {
      const p = db.addProject("web", "/tmp/web", "http://localhost:3000", "mobile");
      expect(p.browser_url).toBe("http://localhost:3000");
      expect(p.default_view_mode).toBe("mobile");
    });

    it("defaults browser_url to null and default_view_mode to desktop", () => {
      const p = db.addProject("plain", "/tmp/plain");
      expect(p.browser_url).toBeNull();
      expect(p.default_view_mode).toBe("desktop");
    });

    it("updates a project", () => {
      const p = db.addProject("old", "/tmp/old");
      db.updateProject(p.id, "new", "/tmp/new", "http://new.dev", "mobile");
      const updated = db.getProject(p.id)!;
      expect(updated.name).toBe("new");
      expect(updated.path).toBe("/tmp/new");
      expect(updated.browser_url).toBe("http://new.dev");
      expect(updated.default_view_mode).toBe("mobile");
    });

    it("updates only browser_url", () => {
      const p = db.addProject("app", "/tmp/app");
      db.updateProjectBrowserUrl(p.id, "http://localhost:8080");
      expect(db.getProject(p.id)!.browser_url).toBe("http://localhost:8080");
    });

    it("removes a project", () => {
      const p = db.addProject("doomed", "/tmp/doomed");
      expect(db.removeProject(p.id)).toBe(true);
      expect(db.getProject(p.id)).toBeNull();
    });

    it("returns false when removing nonexistent project", () => {
      expect(db.removeProject(999)).toBe(false);
    });

    it("enforces unique path constraint", () => {
      db.addProject("a", "/tmp/unique");
      expect(() => db.addProject("b", "/tmp/unique")).toThrow(/UNIQUE/);
    });

    it("reorders projects", () => {
      const a = db.addProject("a", "/tmp/a");
      const b = db.addProject("b", "/tmp/b");
      const c = db.addProject("c", "/tmp/c");

      db.reorderProjects([c.id, a.id, b.id]);
      const ordered = db.getProjects();
      expect(ordered.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    });

    it("cascades delete to sessions", () => {
      const p = db.addProject("proj", "/tmp/proj");
      db.addSession(p.id, "s1", "terminal", "tmux_1");
      db.removeProject(p.id);
      expect(db.getSessionsByProject(p.id)).toEqual([]);
    });
  });

  // ── Sessions ────────────────────────────────────────────────────

  describe("sessions", () => {
    let projectId: number;

    beforeEach(() => {
      projectId = db.addProject("proj", "/tmp/proj").id;
    });

    it("adds and retrieves a session", () => {
      const s = db.addSession(projectId, "Terminal 1", "terminal", "tmux_1");
      expect(s.name).toBe("Terminal 1");
      expect(s.type).toBe("terminal");
      expect(s.status).toBe("active");
      expect(s.mr_urls).toEqual([]);

      const retrieved = db.getSession(s.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(s.id);
    });

    it("returns null for nonexistent session", () => {
      expect(db.getSession(999)).toBeNull();
    });

    it("lists active sessions by project", () => {
      db.addSession(projectId, "s1", "terminal", "t1");
      db.addSession(projectId, "s2", "claude", "t2");
      const sessions = db.getSessionsByProject(projectId);
      expect(sessions).toHaveLength(2);
    });

    it("getAllSessions returns only active sessions", () => {
      const s1 = db.addSession(projectId, "s1", "terminal", "t1");
      db.addSession(projectId, "s2", "claude", "t2");
      db.archiveSession(s1.id);
      expect(db.getAllSessions()).toHaveLength(1);
    });

    it("renames a session", () => {
      const s = db.addSession(projectId, "old", "terminal", "t1");
      expect(db.renameSession(s.id, "new-name")).toBe(true);
      expect(db.getSession(s.id)!.name).toBe("new-name");
    });

    it("archives a session", () => {
      const s = db.addSession(projectId, "live", "terminal", "t1");
      db.archiveSession(s.id);

      expect(db.getSessionsByProject(projectId)).toHaveLength(0);
      const archived = db.getArchivedSessionsByProject(projectId);
      expect(archived).toHaveLength(1);
      expect(archived[0].status).toBe("archived");
    });

    it("unarchives a session", () => {
      const s = db.addSession(projectId, "restore", "terminal", "t1");
      db.archiveSession(s.id);
      db.unarchiveSession(s.id);

      expect(db.getSessionsByProject(projectId)).toHaveLength(1);
      expect(db.getArchivedSessionsByProject(projectId)).toHaveLength(0);
    });

    it("removes a session permanently", () => {
      const s = db.addSession(projectId, "gone", "terminal", "t1");
      expect(db.removeSession(s.id)).toBe(true);
      expect(db.getSession(s.id)).toBeNull();
    });

    it("updates MR URLs", () => {
      const s = db.addSession(projectId, "mr-test", "claude", "t1");
      const urls = ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"];
      db.updateSessionMrUrls(s.id, urls);

      const updated = db.getSession(s.id)!;
      expect(updated.mr_urls).toEqual(urls);
    });

    it("clears MR URLs with empty array", () => {
      const s = db.addSession(projectId, "mr-test", "claude", "t1");
      db.updateSessionMrUrls(s.id, ["https://example.com"]);
      db.updateSessionMrUrls(s.id, []);
      expect(db.getSession(s.id)!.mr_urls).toEqual([]);
    });

    it("updates browser state", () => {
      const s = db.addSession(projectId, "br", "terminal", "t1");
      db.updateSessionBrowserState(s.id, true, "mobile");

      const updated = db.getSession(s.id)!;
      expect(updated.browser_open).toBe(true);
      expect(updated.view_mode).toBe("mobile");
    });

    it("updates agent session ID", () => {
      const s = db.addSession(projectId, "agent", "claude", "t1");
      db.updateSessionAgentId(s.id, "uuid-abc");
      expect(db.getSession(s.id)!.agent_session_id).toBe("uuid-abc");
    });

    it("updates tmux name", () => {
      const s = db.addSession(projectId, "tmux", "terminal", "t1");
      db.updateSessionTmuxName(s.id, "t1_new");
      expect(db.getSession(s.id)!.tmux_name).toBe("t1_new");
    });

    it("reorders sessions within a project", () => {
      const s1 = db.addSession(projectId, "s1", "terminal", "t1");
      const s2 = db.addSession(projectId, "s2", "terminal", "t2");
      const s3 = db.addSession(projectId, "s3", "terminal", "t3");

      db.reorderSessions(projectId, [s3.id, s1.id, s2.id]);
      const ordered = db.getSessionsByProject(projectId);
      expect(ordered.map((s) => s.id)).toEqual([s3.id, s1.id, s2.id]);
    });

    it("supports all session types", () => {
      const types = ["terminal", "claude", "pi", "codex"] as const;
      types.forEach((t, i) => {
        const s = db.addSession(projectId, `s-${t}`, t, `tmux_${i}`);
        expect(s.type).toBe(t);
      });
    });
  });
});
