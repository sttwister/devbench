import { describe, it, expect } from "vitest";
import { parseSession } from "../db.ts";
import type { RawSessionRow } from "@devbench/shared";

/**
 * Tests for parseSession with the typed RawSessionRow interface.
 * Ensures the raw DB row → Session conversion handles all edge cases.
 */
describe("parseSession with RawSessionRow", () => {
  const baseRow: RawSessionRow = {
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
    sort_order: 0,
  };

  it("maps all RawSessionRow fields to Session correctly", () => {
    const session = parseSession(baseRow);
    expect(session).toEqual({
      id: 1,
      project_id: 10,
      name: "test-session",
      type: "claude",
      tmux_name: "devbench_10_123",
      status: "active",
      mr_urls: [],
      agent_session_id: null,
      browser_open: false,
      view_mode: null,
      created_at: "2026-01-01 00:00:00",
    });
  });

  it("does NOT include sort_order in the Session output", () => {
    const session = parseSession(baseRow);
    expect(session).not.toHaveProperty("sort_order");
    expect(session).not.toHaveProperty("mr_url");
  });

  it("converts browser_open integer to boolean", () => {
    expect(parseSession({ ...baseRow, browser_open: 0 }).browser_open).toBe(false);
    expect(parseSession({ ...baseRow, browser_open: 1 }).browser_open).toBe(true);
  });

  it("parses JSON array mr_url into mr_urls", () => {
    const urls = ["https://gitlab.com/g/-/merge_requests/42"];
    const row: RawSessionRow = { ...baseRow, mr_url: JSON.stringify(urls) };
    expect(parseSession(row).mr_urls).toEqual(urls);
  });

  it("wraps JSON string mr_url into single-element array", () => {
    const row: RawSessionRow = {
      ...baseRow,
      mr_url: JSON.stringify("https://github.com/pull/5"),
    };
    expect(parseSession(row).mr_urls).toEqual(["https://github.com/pull/5"]);
  });

  it("handles legacy non-JSON plain URL string", () => {
    const row: RawSessionRow = {
      ...baseRow,
      mr_url: "https://github.com/pull/5",
    };
    expect(parseSession(row).mr_urls).toEqual(["https://github.com/pull/5"]);
  });

  it("handles all session types", () => {
    const types = ["terminal", "claude", "pi", "codex"] as const;
    for (const t of types) {
      const row: RawSessionRow = { ...baseRow, type: t };
      expect(parseSession(row).type).toBe(t);
    }
  });

  it("preserves view_mode when set", () => {
    expect(parseSession({ ...baseRow, view_mode: "mobile" }).view_mode).toBe("mobile");
    expect(parseSession({ ...baseRow, view_mode: "desktop" }).view_mode).toBe("desktop");
  });

  it("preserves agent_session_id when set", () => {
    const row: RawSessionRow = { ...baseRow, agent_session_id: "session-uuid-123" };
    expect(parseSession(row).agent_session_id).toBe("session-uuid-123");
  });
});
