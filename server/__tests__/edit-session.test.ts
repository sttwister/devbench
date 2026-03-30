import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ── mr-links dismiss/add tests ──────────────────────────────────────

// We need to test the dismiss/add functionality without running real timers.
// Import the module after mocking tmux-utils.
vi.mock("../tmux-utils.ts", () => ({
  capturePane: vi.fn(() => ""),
  tmuxSessionExists: vi.fn(() => true),
}));

import {
  extractMrUrls,
  startMonitoring,
  stopMonitoring,
  dismissUrl,
  addManualUrl,
} from "../mr-links.ts";

describe("mr-links dismiss/add", () => {
  afterEach(() => {
    // Stop any monitoring to clean up timers
    stopMonitoring(9001);
    stopMonitoring(9002);
    vi.restoreAllMocks();
  });

  it("dismissUrl on an active monitor does not throw", () => {
    const onChanged = vi.fn();
    startMonitoring(9001, "tmux_test", ["https://github.com/o/r/pull/1"], onChanged);

    // Dismiss a URL that is in the known set
    dismissUrl(9001, "https://github.com/o/r/pull/1");

    // And dismiss one that isn't
    dismissUrl(9001, "https://github.com/o/r/pull/99");

    stopMonitoring(9001);
  });

  it("dismissUrl removes URL from known set", () => {
    const onChanged = vi.fn();
    const initialUrls = ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"];

    startMonitoring(9001, "tmux_test", initialUrls, onChanged);
    dismissUrl(9001, "https://github.com/o/r/pull/2");

    // The dismissed URL should not cause errors
    stopMonitoring(9001);
  });

  it("addManualUrl adds to known set and clears from dismissed", () => {
    const onChanged = vi.fn();
    startMonitoring(9001, "tmux_test", [], onChanged);

    // Dismiss a URL, then re-add it
    dismissUrl(9001, "https://github.com/o/r/pull/5");
    addManualUrl(9001, "https://github.com/o/r/pull/5");

    // Should not throw
    stopMonitoring(9001);
  });

  it("dismissUrl is a no-op for non-monitored sessions", () => {
    // Should not throw
    dismissUrl(9999, "https://github.com/o/r/pull/1");
  });

  it("addManualUrl is a no-op for non-monitored sessions", () => {
    // Should not throw
    addManualUrl(9999, "https://github.com/o/r/pull/1");
  });

  it("stopMonitoring cleans up state", () => {
    const onChanged = vi.fn();
    startMonitoring(9001, "tmux_test", ["https://github.com/o/r/pull/1"], onChanged);
    stopMonitoring(9001);

    // After stopping, dismiss/add should be no-ops (no crash)
    dismissUrl(9001, "https://github.com/o/r/pull/1");
    addManualUrl(9001, "https://github.com/o/r/pull/2");
  });

  it("startMonitoring is idempotent (second call is no-op)", () => {
    const onChanged1 = vi.fn();
    const onChanged2 = vi.fn();

    startMonitoring(9001, "tmux_test", [], onChanged1);
    startMonitoring(9001, "tmux_test", [], onChanged2);

    // Should be fine, second call is ignored
    stopMonitoring(9001);
  });
});

// ── DB updateSessionSource tests ────────────────────────────────────

import { createDatabase } from "../db.ts";

describe("db.updateSessionSource", () => {
  let db: ReturnType<typeof createDatabase>;
  let projectId: number;

  beforeEach(() => {
    db = createDatabase(":memory:");
    projectId = db.addProject("proj", "/tmp/proj").id;
  });

  it("sets source_url and source_type on a session", () => {
    const s = db.addSession(projectId, "s1", "claude", "t1");
    expect(s.source_url).toBeNull();
    expect(s.source_type).toBeNull();

    db.updateSessionSource(s.id, "https://myco.atlassian.net/browse/PROJ-123", "jira");
    const updated = db.getSession(s.id)!;
    expect(updated.source_url).toBe("https://myco.atlassian.net/browse/PROJ-123");
    expect(updated.source_type).toBe("jira");
  });

  it("clears source_url and source_type with null", () => {
    const s = db.addSession(projectId, "s1", "claude", "t1");
    db.updateSessionSource(s.id, "https://linear.app/team/issue/LIN-45/title", "linear");
    db.updateSessionSource(s.id, null, null);

    const updated = db.getSession(s.id)!;
    expect(updated.source_url).toBeNull();
    expect(updated.source_type).toBeNull();
  });

  it("overwrites existing source URL", () => {
    const s = db.addSession(projectId, "s1", "claude", "t1");
    db.updateSessionSource(s.id, "https://old.example.com", "jira");
    db.updateSessionSource(s.id, "https://new.example.com", "linear");

    const updated = db.getSession(s.id)!;
    expect(updated.source_url).toBe("https://new.example.com");
    expect(updated.source_type).toBe("linear");
  });

  it("returns false for nonexistent session", () => {
    expect(db.updateSessionSource(999, "https://example.com", "jira")).toBe(false);
  });

  it("does not affect other session fields", () => {
    const s = db.addSession(projectId, "s1", "claude", "t1");
    db.updateSessionMrUrls(s.id, ["https://github.com/o/r/pull/1"]);
    db.updateSessionBrowserState(s.id, true, "mobile");

    db.updateSessionSource(s.id, "https://example.com", "jira");

    const updated = db.getSession(s.id)!;
    expect(updated.name).toBe("s1");
    expect(updated.mr_urls).toEqual(["https://github.com/o/r/pull/1"]);
    expect(updated.browser_open).toBe(true);
    expect(updated.view_mode).toBe("mobile");
  });
});

describe("db.addSession with source URL", () => {
  let db: ReturnType<typeof createDatabase>;
  let projectId: number;

  beforeEach(() => {
    db = createDatabase(":memory:");
    projectId = db.addProject("proj", "/tmp/proj").id;
  });

  it("stores source_url and source_type on creation", () => {
    const s = db.addSession(
      projectId, "s1", "claude", "t1",
      "https://myco.atlassian.net/browse/PROJ-123", "jira"
    );
    expect(s.source_url).toBe("https://myco.atlassian.net/browse/PROJ-123");
    expect(s.source_type).toBe("jira");
  });

  it("defaults source_url and source_type to null", () => {
    const s = db.addSession(projectId, "s1", "claude", "t1");
    expect(s.source_url).toBeNull();
    expect(s.source_type).toBeNull();
  });
});

// ── Monitor-manager dismiss/add integration ─────────────────────────

// These tests verify the monitor-manager wiring with mocked dependencies.
vi.mock("../agent-status.ts", () => ({
  startMonitoring: vi.fn(),
  stopMonitoring: vi.fn(),
}));
vi.mock("../auto-rename.ts", () => ({
  startAutoRename: vi.fn(),
  tryRenameNow: vi.fn(),
  stopAutoRename: vi.fn(),
}));
vi.mock("../terminal.ts", () => ({
  broadcastControl: vi.fn(),
  tmuxSessionExists: vi.fn(),
  destroyTmuxSession: vi.fn(),
}));
vi.mock("../mr-status.ts", () => ({
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  detectProvider: vi.fn(),
}));
vi.mock("../db.ts", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    // Override functions that dismissMrUrl/addMrUrl call
    getSession: vi.fn(),
    updateSessionMrUrls: vi.fn(),
    getAllSessions: vi.fn(() => []),
    getSetting: vi.fn(() => null),
    updateSessionMrStatuses: vi.fn(),
  };
});

import { dismissMrUrl, addMrUrl } from "../monitor-manager.ts";
import * as db from "../db.ts";
import * as terminal from "../terminal.ts";
import * as mrStatus from "../mr-status.ts";

describe("monitor-manager dismissMrUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes URL from DB and broadcasts change", () => {
    const mockSession = {
      id: 1,
      project_id: 10,
      name: "test",
      type: "claude" as const,
      tmux_name: "tmux_1",
      status: "active",
      mr_urls: ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"],
      mr_statuses: {},
      source_url: null,
      source_type: null,
      agent_session_id: null,
      browser_open: false,
      view_mode: null,
      created_at: "2026-01-01",
    };
    (db.getSession as any).mockReturnValue(mockSession);

    dismissMrUrl(1, "https://github.com/o/r/pull/1");

    expect(db.updateSessionMrUrls).toHaveBeenCalledWith(1, [
      "https://github.com/o/r/pull/2",
    ]);
    expect(terminal.broadcastControl).toHaveBeenCalledWith("tmux_1", {
      type: "mr-links-changed",
      urls: ["https://github.com/o/r/pull/2"],
    });
  });

  it("stops and restarts MR status polling without dismissed URL", () => {
    const mockSession = {
      id: 1,
      project_id: 10,
      name: "test",
      type: "claude" as const,
      tmux_name: "tmux_1",
      status: "active",
      mr_urls: ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"],
      mr_statuses: {},
      source_url: null,
      source_type: null,
      agent_session_id: null,
      browser_open: false,
      view_mode: null,
      created_at: "2026-01-01",
    };
    (db.getSession as any).mockReturnValue(mockSession);

    dismissMrUrl(1, "https://github.com/o/r/pull/1");

    expect(mrStatus.stopPolling).toHaveBeenCalledWith(1);
    expect(mrStatus.startPolling).toHaveBeenCalledWith(
      1,
      ["https://github.com/o/r/pull/2"],
      expect.any(Function)
    );
  });

  it("stops polling entirely when last URL is dismissed", () => {
    const mockSession = {
      id: 1,
      project_id: 10,
      name: "test",
      type: "claude" as const,
      tmux_name: "tmux_1",
      status: "active",
      mr_urls: ["https://github.com/o/r/pull/1"],
      mr_statuses: {},
      source_url: null,
      source_type: null,
      agent_session_id: null,
      browser_open: false,
      view_mode: null,
      created_at: "2026-01-01",
    };
    (db.getSession as any).mockReturnValue(mockSession);

    dismissMrUrl(1, "https://github.com/o/r/pull/1");

    expect(mrStatus.stopPolling).toHaveBeenCalledWith(1);
    // startPolling should NOT be called when no URLs remain
    expect(mrStatus.startPolling).not.toHaveBeenCalled();
  });

  it("handles nonexistent session gracefully", () => {
    (db.getSession as any).mockReturnValue(null);

    // Should not throw
    dismissMrUrl(999, "https://github.com/o/r/pull/1");

    expect(db.updateSessionMrUrls).not.toHaveBeenCalled();
    expect(terminal.broadcastControl).not.toHaveBeenCalled();
  });
});

describe("monitor-manager addMrUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds URL to DB and broadcasts change", () => {
    const mockSession = {
      id: 1,
      project_id: 10,
      name: "test",
      type: "claude" as const,
      tmux_name: "tmux_1",
      status: "active",
      mr_urls: ["https://github.com/o/r/pull/1"],
      mr_statuses: {},
      source_url: null,
      source_type: null,
      agent_session_id: null,
      browser_open: false,
      view_mode: null,
      created_at: "2026-01-01",
    };
    (db.getSession as any).mockReturnValue(mockSession);

    addMrUrl(1, "https://github.com/o/r/pull/2");

    expect(db.updateSessionMrUrls).toHaveBeenCalledWith(1, [
      "https://github.com/o/r/pull/1",
      "https://github.com/o/r/pull/2",
    ]);
    expect(terminal.broadcastControl).toHaveBeenCalledWith("tmux_1", {
      type: "mr-links-changed",
      urls: ["https://github.com/o/r/pull/1", "https://github.com/o/r/pull/2"],
    });
  });

  it("does not duplicate existing URL", () => {
    const mockSession = {
      id: 1,
      project_id: 10,
      name: "test",
      type: "claude" as const,
      tmux_name: "tmux_1",
      status: "active",
      mr_urls: ["https://github.com/o/r/pull/1"],
      mr_statuses: {},
      source_url: null,
      source_type: null,
      agent_session_id: null,
      browser_open: false,
      view_mode: null,
      created_at: "2026-01-01",
    };
    (db.getSession as any).mockReturnValue(mockSession);

    addMrUrl(1, "https://github.com/o/r/pull/1");

    expect(db.updateSessionMrUrls).toHaveBeenCalledWith(1, [
      "https://github.com/o/r/pull/1",
    ]);
  });

  it("starts MR status polling for the new URL set", () => {
    const mockSession = {
      id: 1,
      project_id: 10,
      name: "test",
      type: "claude" as const,
      tmux_name: "tmux_1",
      status: "active",
      mr_urls: [],
      mr_statuses: {},
      source_url: null,
      source_type: null,
      agent_session_id: null,
      browser_open: false,
      view_mode: null,
      created_at: "2026-01-01",
    };
    (db.getSession as any).mockReturnValue(mockSession);

    addMrUrl(1, "https://github.com/o/r/pull/5");

    expect(mrStatus.startPolling).toHaveBeenCalledWith(
      1,
      ["https://github.com/o/r/pull/5"],
      expect.any(Function)
    );
  });

  it("handles nonexistent session gracefully", () => {
    (db.getSession as any).mockReturnValue(null);

    // Should not throw
    addMrUrl(999, "https://github.com/o/r/pull/1");

    expect(db.updateSessionMrUrls).not.toHaveBeenCalled();
    expect(terminal.broadcastControl).not.toHaveBeenCalled();
  });
});
