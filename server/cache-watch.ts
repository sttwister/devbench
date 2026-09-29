/**
 * Prompt-cache watcher for Claude sessions.
 *
 * Anthropic's prompt cache expires a fixed TTL after the last request that
 * used it. On a long session, the first prompt after that pays to rewrite the
 * whole context. This module reads the tail of each Claude transcript to learn
 * when the last main-thread request happened, which TTL it wrote and how big
 * the context is. It then warns the user at T−15 minutes and, for sessions
 * with `auto_compact` on, types `/compact` at T−5 so the context is small
 * before the cache goes cold.
 */

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CacheState } from "@devbench/shared";
import * as db from "./db.ts";
import * as agentStatus from "./agent-status.ts";
import * as monitors from "./monitor-manager.ts";
import { capturePane, pasteAndSubmit } from "./tmux-utils.ts";
import { logger } from "./logger.ts";

export const WARN_LEAD_MS = 15 * 60_000;
export const COMPACT_LEAD_MS = 5 * 60_000;
export const MIN_CONTEXT_TOKENS = 100_000;
const COMPACT_TIMEOUT_MS = 10 * 60_000;
const TICK_MS = 30_000;
const TAIL_BYTES = 512 * 1024;
const HOUR_MS = 60 * 60_000;
const FIVE_MIN_MS = 5 * 60_000;
/** Dev/testing override for the cache TTL, e.g. DEVBENCH_CACHE_TTL_MS=720000. */
const TTL_OVERRIDE_MS = Number(process.env.DEVBENCH_CACHE_TTL_MS) || 0;
const PROJECTS_DIR = join(homedir(), ".claude", "projects");

// ── Transcript parsing (pure) ───────────────────────────────────────

export interface TranscriptCache {
  /** Epoch ms when the last main-thread request was sent. */
  lastRequestAt: number;
  ttlMs: number;
  contextTokens: number;
  /** The last response ended its turn — Claude is at the prompt, not blocked on a tool. */
  turnEnded: boolean;
  /** Post-compaction token count when a compaction happened after the last request. */
  compactedTokens: number | null;
}

/**
 * Derive cache facts from the last lines of a transcript (JSONL, oldest first).
 *
 * The request time is the timestamp of the entry that triggered the last
 * response (the prompt or tool result right before it), not the response's
 * own entries: those are written as blocks finish, which can be minutes after
 * the request started and refreshed the cache.
 */
export function parseTranscriptTail(lines: string[]): TranscriptCache | null {
  let compactedTokens: number | null = null;
  let last: any = null;
  let firstIdx = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const e = parseLine(lines[i]);
    if (!e) continue;
    if (last) {
      // Walk back to the first entry of the same response.
      if (e.type === "assistant" && e.message?.id === last.message.id) { firstIdx = i; continue; }
      break;
    }
    if (e.type === "system" && e.subtype === "compact_boundary" && compactedTokens === null) {
      compactedTokens = e.compactMetadata?.postTokens ?? 0;
      continue;
    }
    if (e.type === "assistant" && !e.isSidechain && e.message?.usage && e.message.model !== "<synthetic>") {
      last = e;
      firstIdx = i;
    }
  }
  if (!last) return null;

  let requestTs = Date.parse(parseLine(lines[firstIdx])?.timestamp);
  for (let i = firstIdx - 1; i >= 0; i--) {
    const ts = Date.parse(parseLine(lines[i])?.timestamp);
    if (!Number.isNaN(ts)) { requestTs = Math.min(requestTs, ts); break; }
  }
  if (Number.isNaN(requestTs)) return null;

  const u = last.message.usage;
  const cc = u.cache_creation ?? {};
  const fiveMinOnly = (cc.ephemeral_5m_input_tokens ?? 0) > 0 && !(cc.ephemeral_1h_input_tokens > 0);
  return {
    lastRequestAt: requestTs,
    ttlMs: TTL_OVERRIDE_MS || (fiveMinOnly ? FIVE_MIN_MS : HOUR_MS),
    contextTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    turnEnded: !!last.message.stop_reason && last.message.stop_reason !== "tool_use",
    compactedTokens,
  };
}

function parseLine(line: string | undefined): any {
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null; // partial or non-JSON line
  }
}

/**
 * True when Claude Code's input box is empty. The box is the last line
 * starting with ❯, plus any continuation lines up to the ─── separator.
 * Returns false when no input box is visible, so callers fail safe.
 */
export function inputIsEmpty(pane: string): boolean {
  const lines = pane.split("\n");
  let i = lines.length - 1;
  while (i >= 0 && !lines[i].trimStart().startsWith("❯")) i--;
  if (i < 0) return false;
  let text = lines[i].trimStart().slice(1);
  for (let j = i + 1; j < lines.length && !/^─{3,}/.test(lines[j].trim()); j++) text += lines[j];
  return text.replace(/\s/g, "") === "";
}

// ── Decisions (pure) ────────────────────────────────────────────────

export interface WatchFlags {
  autoCompact: boolean;
  warned: boolean;
  compactSent: boolean;
}

/** What the watcher should do for one session right now. */
export function nextAction(c: TranscriptCache, now: number, f: WatchFlags): "warn" | "compact" | null {
  const left = c.lastRequestAt + c.ttlMs - now;
  if (left <= 0 || c.compactedTokens !== null || c.contextTokens < MIN_CONTEXT_TOKENS) return null;
  if (f.autoCompact && !f.compactSent && left <= COMPACT_LEAD_MS) return "compact";
  if (!f.warned && left <= WARN_LEAD_MS) return "warn";
  return null;
}

/** Why typing /compact now would be unsafe, or null when it is safe. */
export function compactBlocker(c: TranscriptCache, agentWaiting: boolean, pane: string): string | null {
  if (!agentWaiting) return "Claude is busy";
  if (!c.turnEnded) return "Claude's turn is unfinished (a question, approval or tool)";
  if (!inputIsEmpty(pane)) return "unsent draft in the input";
  return null;
}

export function toCacheState(c: TranscriptCache, now: number): CacheState {
  return {
    expiresInMs: c.lastRequestAt + c.ttlMs - now,
    contextTokens: c.compactedTokens ?? c.contextTokens,
    compacted: c.compactedTokens !== null,
  };
}

// ── Watch loop ──────────────────────────────────────────────────────

interface Watch {
  path: string | null;
  mtimeMs: number;
  cache: TranscriptCache | null;
  /** lastRequestAt of the idle stretch already warned / compacted, so each fires once per stretch. */
  warnedFor: number;
  compactFor: number;
  compactSentAt: number;
}

const watches = new Map<number, Watch>();

function findTranscript(agentSessionId: string): string | null {
  if (!existsSync(PROJECTS_DIR)) return null;
  for (const dir of readdirSync(PROJECTS_DIR)) {
    const p = join(PROJECTS_DIR, dir, `${agentSessionId}.jsonl`);
    if (existsSync(p)) return p;
  }
  return null;
}

function readTail(path: string, size: number): string[] {
  const start = Math.max(0, size - TAIL_BYTES);
  const buf = Buffer.alloc(size - start);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, buf.length, start);
  } finally {
    closeSync(fd);
  }
  const lines = buf.toString("utf8").split("\n");
  return start > 0 ? lines.slice(1) : lines; // drop the cut-off first line
}

function fmtTokens(n: number): string {
  return `${Math.round(n / 1000)}k tokens`;
}

function fmtLeft(ms: number): string {
  return `${Math.max(1, Math.round(ms / 60_000))} min`;
}

/** Re-read a session's transcript if it changed since the last tick. */
function refresh(w: Watch, agentSessionId: string): void {
  if (!w.path || !existsSync(w.path)) w.path = findTranscript(agentSessionId);
  if (!w.path) { w.cache = null; return; }
  const st = statSync(w.path);
  if (st.mtimeMs === w.mtimeMs) return;
  w.mtimeMs = st.mtimeMs;
  w.cache = parseTranscriptTail(readTail(w.path, st.size));
}

export function tick(now = Date.now()): void {
  const sessions = db.getAllSessions().filter(
    (s) => s.type === "claude" && s.agent_session_id && !monitors.isOrphaned(s.id)
  );
  const live = new Set(sessions.map((s) => s.id));
  for (const id of watches.keys()) if (!live.has(id)) watches.delete(id);

  for (const s of sessions) {
    let w = watches.get(s.id);
    if (!w) {
      w = { path: null, mtimeMs: 0, cache: null, warnedFor: 0, compactFor: 0, compactSentAt: 0 };
      watches.set(s.id, w);
    }
    try {
      refresh(w, s.agent_session_id!);
    } catch (e: any) {
      if (!e?.code) throw e; // only fs errors (file rotated or deleted mid-read) are expected
      w.path = null;
      w.cache = null;
    }
    const c = w.cache;
    if (!c) continue;

    // Auto-compact sent but no compact boundary appeared: tell the user once.
    if (w.compactFor === c.lastRequestAt && w.compactSentAt && c.compactedTokens === null
        && now - w.compactSentAt > COMPACT_TIMEOUT_MS) {
      w.compactSentAt = 0;
      monitors.notifySession(s.id, "auto-compact did not finish; check the session");
    }

    const action = nextAction(c, now, {
      autoCompact: s.auto_compact,
      warned: w.warnedFor === c.lastRequestAt,
      compactSent: w.compactFor === c.lastRequestAt,
    });
    if (!action) continue;
    const left = c.lastRequestAt + c.ttlMs - now;

    if (action === "warn") {
      w.warnedFor = c.lastRequestAt;
      logger.info("cache-watch", "warning", { sessionId: s.id, left, tokens: c.contextTokens });
      // Auto-compact sessions look after themselves: glow only, no sound at night.
      monitors.notifySession(s.id, `cache expires in ${fmtLeft(left)} · ${fmtTokens(c.contextTokens)}`, !s.auto_compact);
      continue;
    }

    w.compactFor = c.lastRequestAt;
    w.warnedFor = c.lastRequestAt;
    const blocker = compactBlocker(c, agentStatus.getStatus(s.id) === "waiting", capturePane(s.tmux_name));
    if (blocker) {
      logger.info("cache-watch", "auto-compact skipped", { sessionId: s.id, blocker });
      monitors.notifySession(s.id, `auto-compact skipped: ${blocker} · cache expires in ${fmtLeft(left)}`);
      continue;
    }
    console.log(`[cache-watch] Session ${s.id}: auto-compacting ${fmtTokens(c.contextTokens)}, ${fmtLeft(left)} before expiry`);
    logger.info("cache-watch", "auto-compact", { sessionId: s.id, left, tokens: c.contextTokens });
    w.compactSentAt = now;
    monitors.suppressIdleNotifications(s.id, COMPACT_TIMEOUT_MS);
    pasteAndSubmit(s.tmux_name, "/compact");
  }
}

/** Cache state of every watched session worth showing (big, or just compacted). */
export function getCacheStates(now = Date.now()): Record<number, CacheState> {
  const out: Record<number, CacheState> = {};
  for (const [id, w] of watches) {
    const c = w.cache;
    if (c && (c.compactedTokens !== null || c.contextTokens >= MIN_CONTEXT_TOKENS)) {
      out[id] = toCacheState(c, now);
    }
  }
  return out;
}

export function start(): void {
  tick();
  setInterval(tick, TICK_MS);
}
