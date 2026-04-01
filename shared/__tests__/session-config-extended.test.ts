// @lat: [[tests#Shared#Session Config Extended]]
import { describe, it, expect } from "vitest";
import {
  SESSION_TYPE_CONFIGS,
  SESSION_TYPES_LIST,
  getSessionIcon,
  getSessionLabel,
} from "../session-config.ts";
import type { SessionType } from "../types.ts";

describe("SESSION_TYPE_CONFIGS", () => {
  it("has entries for all session types", () => {
    const types: SessionType[] = ["terminal", "claude", "pi", "codex"];
    for (const t of types) {
      expect(SESSION_TYPE_CONFIGS[t]).toBeDefined();
      expect(SESSION_TYPE_CONFIGS[t].type).toBe(t);
      expect(SESSION_TYPE_CONFIGS[t].label).toBeTruthy();
      expect(SESSION_TYPE_CONFIGS[t].icon).toBeTruthy();
      expect(SESSION_TYPE_CONFIGS[t].shortcutKey).toBeTruthy();
    }
  });

  it("has unique shortcut keys", () => {
    const keys = Object.values(SESSION_TYPE_CONFIGS).map((c) => c.shortcutKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has unique icons", () => {
    const icons = Object.values(SESSION_TYPE_CONFIGS).map((c) => c.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("SESSION_TYPES_LIST", () => {
  it("contains all session types", () => {
    expect(SESSION_TYPES_LIST).toHaveLength(4);
    const types = SESSION_TYPES_LIST.map((s) => s.type);
    expect(types).toContain("terminal");
    expect(types).toContain("claude");
    expect(types).toContain("codex");
    expect(types).toContain("pi");
  });

  it("has terminal first", () => {
    expect(SESSION_TYPES_LIST[0].type).toBe("terminal");
  });
});

describe("getSessionIcon", () => {
  it("returns the correct icon for each type", () => {
    expect(getSessionIcon("terminal")).toBe("terminal");
    expect(getSessionIcon("claude")).toBe("bot");
    expect(getSessionIcon("codex")).toBe("sparkles");
    expect(getSessionIcon("pi")).toBe("pi");
  });

  it("returns fallback icon for unknown type", () => {
    expect(getSessionIcon("unknown" as SessionType)).toBe("terminal");
  });
});

describe("getSessionLabel", () => {
  it("returns the correct label for each type", () => {
    expect(getSessionLabel("terminal")).toBe("Terminal");
    expect(getSessionLabel("claude")).toBe("Claude Code");
    expect(getSessionLabel("codex")).toBe("Codex");
    expect(getSessionLabel("pi")).toBe("Pi");
  });

  it("returns fallback label for unknown type", () => {
    expect(getSessionLabel("unknown" as SessionType)).toBe("Terminal");
  });
});
