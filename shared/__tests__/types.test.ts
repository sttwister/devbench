// @lat: [[tests#Shared#Type Contracts]]
import { describe, it, expect } from "vitest";
import type { AgentStatus, RawSessionRow, Session, SessionType } from "../types.ts";

describe("shared types", () => {
  it("AgentStatus accepts valid values", () => {
    const working: AgentStatus = "working";
    const waiting: AgentStatus = "waiting";
    expect(working).toBe("working");
    expect(waiting).toBe("waiting");
  });

  it("SessionType accepts all valid types", () => {
    const types: SessionType[] = ["terminal", "claude", "pi", "codex"];
    expect(types).toHaveLength(4);
  });

  it("RawSessionRow has the correct shape", () => {
    const raw: RawSessionRow = {
      id: 1,
      project_id: 10,
      name: "test",
      type: "claude",
      tmux_name: "devbench_1_123",
      status: "active",
      mr_url: null,
      agent_session_id: null,
      browser_open: 0,
      view_mode: null,
      created_at: "2026-01-01",
      sort_order: 0,
    };
    expect(raw.id).toBe(1);
    expect(raw.browser_open).toBe(0); // raw DB integer, not boolean
    expect(raw.mr_url).toBeNull(); // raw TEXT, not parsed array
  });

  it("Session has parsed mr_urls as string array", () => {
    const session: Session = {
      id: 1,
      project_id: 10,
      name: "test",
      type: "claude",
      tmux_name: "devbench_1_123",
      status: "active",
      mr_urls: ["https://github.com/pull/1"],
      agent_session_id: null,
      browser_open: true, // boolean, not integer
      view_mode: null,
      created_at: "2026-01-01",
    };
    expect(session.mr_urls).toBeInstanceOf(Array);
    expect(session.browser_open).toBe(true);
  });
});
