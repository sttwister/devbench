import { describe, it, expect } from "vitest";
import {
  getSessionIcon,
  getSessionLabel,
  SESSION_TYPE_CONFIGS,
  SESSION_TYPES_LIST,
} from "../session-config.ts";
import type { SessionType } from "../types.ts";

describe("getSessionIcon", () => {
  it("returns correct icon for each known type", () => {
    expect(getSessionIcon("terminal")).toBe("🖥");
    expect(getSessionIcon("claude")).toBe("🤖");
    expect(getSessionIcon("codex")).toBe("🧬");
    expect(getSessionIcon("pi")).toBe("🥧");
  });

  it('falls back to terminal icon for unknown type', () => {
    expect(getSessionIcon("unknown" as SessionType)).toBe("🖥");
  });
});

describe("getSessionLabel", () => {
  it("returns correct label for each known type", () => {
    expect(getSessionLabel("terminal")).toBe("Terminal");
    expect(getSessionLabel("claude")).toBe("Claude Code");
    expect(getSessionLabel("codex")).toBe("Codex");
    expect(getSessionLabel("pi")).toBe("Pi");
  });

  it('falls back to "Terminal" for unknown type', () => {
    expect(getSessionLabel("unknown" as SessionType)).toBe("Terminal");
  });
});

describe("SESSION_TYPE_CONFIGS", () => {
  it("has entries for all four session types", () => {
    expect(Object.keys(SESSION_TYPE_CONFIGS)).toEqual(
      expect.arrayContaining(["terminal", "claude", "codex", "pi"])
    );
    expect(Object.keys(SESSION_TYPE_CONFIGS)).toHaveLength(4);
  });

  it("each config has type, label, icon, and shortcutKey", () => {
    for (const config of Object.values(SESSION_TYPE_CONFIGS)) {
      expect(config).toHaveProperty("type");
      expect(config).toHaveProperty("label");
      expect(config).toHaveProperty("icon");
      expect(config).toHaveProperty("shortcutKey");
    }
  });
});

describe("SESSION_TYPES_LIST", () => {
  it("has 4 entries in correct order", () => {
    expect(SESSION_TYPES_LIST).toHaveLength(4);
    expect(SESSION_TYPES_LIST.map((c) => c.type)).toEqual([
      "terminal",
      "claude",
      "codex",
      "pi",
    ]);
  });
});
