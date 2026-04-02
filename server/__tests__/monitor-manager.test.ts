// @lat: [[tests#Monitoring#Monitor Manager Wiring]]
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Monitor-manager dismiss/add integration ─────────────────────────

// These tests verify the monitor-manager wiring with mocked dependencies.
vi.mock("../tmux-utils.ts", () => ({
  capturePane: vi.fn(() => ""),
  tmuxSessionExists: vi.fn(() => true),
}));
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
  startGlobalPolling: vi.fn(),
  stopGlobalPolling: vi.fn(),
  pollUrls: vi.fn(),
  fetchAndUpdateStatuses: vi.fn(),
  onTokenChanged: vi.fn(),
  detectProvider: vi.fn(),
  isPolling: vi.fn(),
  validateUrl: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("../db.ts", () => ({
  createDatabase: vi.fn(),
  getSession: vi.fn(),
  updateSessionMrUrls: vi.fn(),
  getAllSessions: vi.fn(() => []),
  getSetting: vi.fn(() => null),
  updateSessionMrStatuses: vi.fn(),
  addMergeRequest: vi.fn(),
  getMergeRequestByUrl: vi.fn(),
  removeMergeRequestByUrl: vi.fn(),
}));

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

    expect(db.removeMergeRequestByUrl).toHaveBeenCalledWith("https://github.com/o/r/pull/1");
    expect(db.updateSessionMrUrls).toHaveBeenCalledWith(1, [
      "https://github.com/o/r/pull/2",
    ]);
    expect(terminal.broadcastControl).toHaveBeenCalledWith("tmux_1", {
      type: "mr-links-changed",
      urls: ["https://github.com/o/r/pull/2"],
    });
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

    expect(db.addMergeRequest).toHaveBeenCalledWith(
      "https://github.com/o/r/pull/2",
      "github",
      1,
    );
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

  it("triggers immediate poll for the new URL", () => {
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

    expect(mrStatus.pollUrls).toHaveBeenCalledWith(["https://github.com/o/r/pull/5"]);
  });

  it("handles nonexistent session gracefully", () => {
    (db.getSession as any).mockReturnValue(null);

    // Should not throw
    addMrUrl(999, "https://github.com/o/r/pull/1");

    expect(db.updateSessionMrUrls).not.toHaveBeenCalled();
    expect(terminal.broadcastControl).not.toHaveBeenCalled();
  });
});
