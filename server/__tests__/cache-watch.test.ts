import { describe, it, expect } from "vitest";
import {
  parseTranscriptTail,
  inputIsEmpty,
  nextAction,
  compactBlocker,
  toCacheState,
  MIN_CONTEXT_TOKENS,
  type TranscriptCache,
} from "../cache-watch.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** A transcript line in Claude Code's JSONL shape (only the fields we read). */
function assistant(ts: string, opts: { id?: string; stop?: string | null; ttl?: "1h" | "5m"; sidechain?: boolean; read?: number } = {}) {
  const created = 2_000;
  return JSON.stringify({
    type: "assistant",
    timestamp: ts,
    isSidechain: opts.sidechain ?? false,
    message: {
      id: opts.id ?? "msg_1",
      model: "claude-opus-5-5",
      stop_reason: opts.stop === undefined ? "end_turn" : opts.stop,
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: opts.read ?? 300_000,
        cache_creation_input_tokens: created,
        cache_creation: opts.ttl === "5m"
          ? { ephemeral_5m_input_tokens: created, ephemeral_1h_input_tokens: 0 }
          : { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: created },
      },
    },
  });
}
const user = (ts: string) => JSON.stringify({ type: "user", timestamp: ts, message: { role: "user", content: "hi" } });
const boundary = (ts: string, postTokens: number) =>
  JSON.stringify({ type: "system", subtype: "compact_boundary", timestamp: ts, compactMetadata: { preTokens: 300_000, postTokens } });

describe("parseTranscriptTail", () => {
  it("dates the request from the entry that triggered the response", () => {
    const c = parseTranscriptTail([
      user("2026-09-29T10:00:00.000Z"),
      assistant("2026-09-29T10:03:00.000Z", { stop: "end_turn" }),
      assistant("2026-09-29T10:04:00.000Z", { stop: "end_turn" }),
    ])!;
    expect(c.lastRequestAt).toBe(Date.parse("2026-09-29T10:00:00.000Z"));
    expect(c.ttlMs).toBe(HOUR);
    expect(c.contextTokens).toBe(302_002);
    expect(c.turnEnded).toBe(true);
    expect(c.compactedTokens).toBeNull();
  });

  it("reads a 5-minute TTL when the request wrote only 5m cache", () => {
    const c = parseTranscriptTail([user("2026-09-29T10:00:00Z"), assistant("2026-09-29T10:00:05Z", { ttl: "5m" })])!;
    expect(c.ttlMs).toBe(5 * MIN);
  });

  it("ignores subagent (sidechain) responses", () => {
    const c = parseTranscriptTail([
      user("2026-09-29T10:00:00Z"),
      assistant("2026-09-29T10:00:05Z", { id: "main" }),
      assistant("2026-09-29T10:30:00Z", { id: "sub", sidechain: true }),
    ])!;
    expect(c.lastRequestAt).toBe(Date.parse("2026-09-29T10:00:00Z"));
  });

  it("flags a pending tool_use as an unfinished turn", () => {
    const c = parseTranscriptTail([user("2026-09-29T10:00:00Z"), assistant("2026-09-29T10:00:05Z", { stop: "tool_use" })])!;
    expect(c.turnEnded).toBe(false);
  });

  it("detects a compaction after the last request", () => {
    const c = parseTranscriptTail([
      user("2026-09-29T10:00:00Z"),
      assistant("2026-09-29T10:00:05Z"),
      boundary("2026-09-29T10:55:00Z", 11_250),
      user("2026-09-29T10:55:00Z"),
    ])!;
    expect(c.compactedTokens).toBe(11_250);
    expect(toCacheState(c, Date.parse("2026-09-29T10:56:00Z"))).toMatchObject({ compacted: true, contextTokens: 11_250 });
  });

  it("ignores compactions older than the last request", () => {
    const c = parseTranscriptTail([
      boundary("2026-09-29T09:00:00Z", 11_250),
      user("2026-09-29T10:00:00Z"),
      assistant("2026-09-29T10:00:05Z"),
    ])!;
    expect(c.compactedTokens).toBeNull();
  });

  it("skips unparseable lines and returns null without a response", () => {
    expect(parseTranscriptTail(['{"type":"assist', user("2026-09-29T10:00:00Z")])).toBeNull();
  });
});

describe("inputIsEmpty", () => {
  const sep = "─".repeat(40);
  const pane = (input: string) => ["❯ earlier prompt shown in history", "output", sep, input, sep, "  status line"].join("\n");

  it("is true for an empty prompt (with the nbsp Claude Code renders)", () => {
    expect(inputIsEmpty(pane("❯ "))).toBe(true);
  });

  it("is false when a draft is typed", () => {
    expect(inputIsEmpty(pane("❯ half a thought"))).toBe(false);
  });

  it("is false for a multi-line draft whose first line is empty", () => {
    expect(inputIsEmpty([sep, "❯ ", "second line", sep].join("\n"))).toBe(false);
  });

  it("is false when no input box is visible", () => {
    expect(inputIsEmpty("Do you want to proceed?\n 1. Yes\n 2. No")).toBe(false);
  });
});

describe("nextAction", () => {
  const t0 = Date.parse("2026-09-29T10:00:00Z");
  const cache = (over: Partial<TranscriptCache> = {}): TranscriptCache => ({
    lastRequestAt: t0, ttlMs: HOUR, contextTokens: 300_000, turnEnded: true, compactedTokens: null, ...over,
  });
  const flags = { autoCompact: false, warned: false, compactSent: false };
  const at = (min: number) => t0 + min * MIN;

  it("stays quiet while the cache has more than 15 minutes left", () => {
    expect(nextAction(cache(), at(44), flags)).toBeNull();
  });

  it("warns at T−15, once", () => {
    expect(nextAction(cache(), at(45), flags)).toBe("warn");
    expect(nextAction(cache(), at(46), { ...flags, warned: true })).toBeNull();
  });

  it("compacts at T−5 when auto-compact is on, once", () => {
    const on = { ...flags, autoCompact: true, warned: true };
    expect(nextAction(cache(), at(54), on)).toBeNull();
    expect(nextAction(cache(), at(55), on)).toBe("compact");
    expect(nextAction(cache(), at(56), { ...on, compactSent: true })).toBeNull();
  });

  it("never compacts when auto-compact is off", () => {
    expect(nextAction(cache(), at(56), { ...flags, warned: true })).toBeNull();
  });

  it("does nothing for small, compacted or expired sessions", () => {
    const on = { ...flags, autoCompact: true };
    expect(nextAction(cache({ contextTokens: MIN_CONTEXT_TOKENS - 1 }), at(56), on)).toBeNull();
    expect(nextAction(cache({ compactedTokens: 11_000 }), at(56), on)).toBeNull();
    expect(nextAction(cache(), at(61), on)).toBeNull();
  });
});

describe("compactBlocker", () => {
  const c: TranscriptCache = { lastRequestAt: 0, ttlMs: HOUR, contextTokens: 300_000, turnEnded: true, compactedTokens: null };
  const empty = "─────\n❯ \n─────";

  it("allows compaction for an idle session at an empty prompt", () => {
    expect(compactBlocker(c, true, empty)).toBeNull();
  });

  it("blocks when busy, mid-turn or with a draft", () => {
    expect(compactBlocker(c, false, empty)).toMatch(/busy/);
    expect(compactBlocker({ ...c, turnEnded: false }, true, empty)).toMatch(/unfinished/);
    expect(compactBlocker(c, true, "─────\n❯ draft\n─────")).toMatch(/draft/);
  });
});
