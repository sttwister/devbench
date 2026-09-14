import { describe, it, expect, beforeEach, vi } from "vitest";

// @lat: [[tests#Hook API#Agent Session Id Drift]]

vi.mock("../tmux-utils.ts", () => ({
  capturePane: () => "mock content",
  tmuxSessionExists: () => true,
  paneDimensions: () => "200x50",
}));

vi.mock("../auto-rename.ts", () => ({
  nameFromPrompt: () => {},
}));

import { handleHookPrompt } from "../monitor-manager.ts";
import * as db from "../db.ts";

function makeSession(type: "claude" | "codex" | "pi") {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = db.addProject(`proj-${suffix}`, `/tmp/proj-${suffix}`);
  return db.addSession(project.id, `${type}-session`, type, `devbench_${suffix}`);
}

describe("agent session id drift", () => {
  let sessionId: number;

  beforeEach(() => {
    const session = makeSession("claude");
    db.updateSessionAgentId(session.id, "launch-uuid");
    sessionId = session.id;
  });

  it("adopts the rotated Claude session id reported with a prompt", () => {
    handleHookPrompt(sessionId, "do the thing", "rotated-uuid");

    expect(db.getSession(sessionId)!.agent_session_id).toBe("rotated-uuid");
  });

  it("keeps the stored id when the hook reports nothing", () => {
    handleHookPrompt(sessionId, "do the thing", null);

    expect(db.getSession(sessionId)!.agent_session_id).toBe("launch-uuid");
  });

  it("ignores ids reported for non-Claude sessions", () => {
    // Codex reports its thread id via session-start; Pi resumes by file path.
    const codex = makeSession("codex");
    db.updateSessionAgentId(codex.id, "codex-thread");

    handleHookPrompt(codex.id, "do the thing", "some-other-id");

    expect(db.getSession(codex.id)!.agent_session_id).toBe("codex-thread");
  });

  it("no-ops for inactive sessions", () => {
    db.archiveSession(sessionId);

    handleHookPrompt(sessionId, "do the thing", "rotated-uuid");

    expect(db.getSession(sessionId)!.agent_session_id).toBe("launch-uuid");
  });
});
