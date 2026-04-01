// @lat: [[sessions#Session Types]]
import type { SessionType } from "./types.ts";
import type { IconName } from "./icon-names.ts";

export interface SessionTypeConfig {
  type: SessionType;
  label: string;
  icon: IconName;
  /** Keyboard shortcut key for the "new session" popup. */
  shortcutKey: string;
}

export const SESSION_TYPE_CONFIGS: Record<SessionType, SessionTypeConfig> = {
  terminal: { type: "terminal", label: "Terminal",    icon: "terminal",  shortcutKey: "t" },
  claude:   { type: "claude",   label: "Claude Code", icon: "bot",       shortcutKey: "c" },
  codex:    { type: "codex",    label: "Codex",       icon: "sparkles",  shortcutKey: "o" },
  pi:       { type: "pi",       label: "Pi",          icon: "pi",        shortcutKey: "p" },
};

/**
 * Ordered list of session types, used for the "new session" popup.
 * Order: terminal, claude, codex, pi (matches shortcut key layout).
 */
export const SESSION_TYPES_LIST: SessionTypeConfig[] = [
  SESSION_TYPE_CONFIGS.terminal,
  SESSION_TYPE_CONFIGS.claude,
  SESSION_TYPE_CONFIGS.codex,
  SESSION_TYPE_CONFIGS.pi,
];

export function getSessionIcon(type: SessionType): IconName {
  return SESSION_TYPE_CONFIGS[type]?.icon ?? "terminal";
}

export function getSessionLabel(type: SessionType): string {
  return SESSION_TYPE_CONFIGS[type]?.label ?? "Terminal";
}
