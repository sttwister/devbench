// @lat: [[hooks#Extension Manager]]
/**
 * Manages installation, uninstallation, and version checking of
 * devbench agent extensions (Claude Code hooks, Pi extensions, Codex hooks/skills).
 *
 * Extensions are bundled in server/extensions/ and copied to
 * global locations under each agent's config directory.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, copyFileSync, cpSync, rmSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Bundled extension paths ─────────────────────────────────────────

const BUNDLED_CLAUDE_HOOK = join(__dirname, "extensions", "claude-hook.js");
const BUNDLED_PI_EXTENSION = join(__dirname, "extensions", "pi-extension.ts");
const BUNDLED_CODEX_HOOK = join(__dirname, "extensions", "codex-hook.js");
const BUNDLED_CODEX_COMMIT_PUSH_SKILL_DIR = join(__dirname, "extensions", "codex-skills", "git-commit-and-push");

// ── Install locations ───────────────────────────────────────────────

const CLAUDE_HOOK_PATH = join(homedir(), ".claude", "hooks", "devbench-hook.js");
const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const PI_EXTENSION_PATH = join(homedir(), ".pi", "agent", "extensions", "devbench.ts");
const CODEX_HOOK_PATH = join(homedir(), ".codex", "hooks", "devbench-hook.js");
const CODEX_HOOKS_PATH = join(homedir(), ".codex", "hooks.json");
const CODEX_CONFIG_PATH = join(homedir(), ".codex", "config.toml");
const CODEX_COMMIT_PUSH_SKILL_DIR = join(homedir(), ".codex", "skills", "git-commit-and-push");
const CODEX_COMMIT_PUSH_SKILL_PATH = join(CODEX_COMMIT_PUSH_SKILL_DIR, "SKILL.md");

// ── Version extraction ──────────────────────────────────────────────

/** Extract version from the first comment line: "// devbench-hook v1" → "1" */
function extractVersion(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const match = content.match(/^\/\/\s*devbench-(?:hook|extension)\s+v(\S+)/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// ── Status ──────────────────────────────────────────────────────────

export interface ExtensionStatus {
  installed: boolean;
  version: string | null;
  latest: string | null;
  upToDate: boolean;
}

export function getClaudeStatus(): ExtensionStatus {
  const installed = existsSync(CLAUDE_HOOK_PATH);
  const version = installed ? extractVersion(CLAUDE_HOOK_PATH) : null;
  const latest = extractVersion(BUNDLED_CLAUDE_HOOK);
  return {
    installed,
    version,
    latest,
    upToDate: installed && version !== null && version === latest,
  };
}

export function getPiStatus(): ExtensionStatus {
  const installed = existsSync(PI_EXTENSION_PATH);
  const version = installed ? extractVersion(PI_EXTENSION_PATH) : null;
  const latest = extractVersion(BUNDLED_PI_EXTENSION);
  return {
    installed,
    version,
    latest,
    upToDate: installed && version !== null && version === latest,
  };
}

export function getCodexStatus(): ExtensionStatus {
  const scriptInstalled = existsSync(CODEX_HOOK_PATH);
  const version = scriptInstalled ? extractVersion(CODEX_HOOK_PATH) : null;
  const latest = extractVersion(BUNDLED_CODEX_HOOK);
  const installed =
    scriptInstalled &&
    existsSync(CODEX_COMMIT_PUSH_SKILL_PATH) &&
    hasDevbenchCodexHooks() &&
    isCodexHooksFeatureEnabled();
  return {
    installed,
    version,
    latest,
    upToDate: installed && version !== null && version === latest,
  };
}

export function getAllStatuses(): Record<string, ExtensionStatus> {
  return {
    claude: getClaudeStatus(),
    pi: getPiStatus(),
    codex: getCodexStatus(),
  };
}

// ── Claude Code: settings.json merging ──────────────────────────────

/** The hook entries devbench adds to Claude Code settings. */
const DEVBENCH_HOOK_COMMAND = `node "${CLAUDE_HOOK_PATH}"`;

function getDevbenchClaudeHooks(): Record<string, any[]> {
  return {
    UserPromptSubmit: [
      {
        hooks: [
          { type: "command", command: `${DEVBENCH_HOOK_COMMAND} UserPromptSubmit` },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          { type: "command", command: `${DEVBENCH_HOOK_COMMAND} Stop` },
        ],
      },
    ],
    Notification: [
      {
        hooks: [
          { type: "command", command: `${DEVBENCH_HOOK_COMMAND} Notification` },
        ],
      },
    ],
    PreToolUse: [
      {
        // No matcher — fires for every tool, giving us a reliable
        // "working" signal when UserPromptSubmit doesn't fire (plan-mode
        // refinement routes input to the ExitPlanMode tool continuation).
        hooks: [
          { type: "command", command: `${DEVBENCH_HOOK_COMMAND} PreToolUse` },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash",
        hooks: [
          { type: "command", command: `${DEVBENCH_HOOK_COMMAND} PostToolUse` },
        ],
      },
    ],
  };
}

/** Check if a hook entry is a devbench hook (by matching the command string). */
function isDevbenchHookEntry(entry: any): boolean {
  if (!entry?.hooks) return false;
  return entry.hooks.some((h: any) =>
    h.type === "command" && typeof h.command === "string" && h.command.includes("devbench-hook")
  );
}

/** Read Claude Code settings.json, returning parsed object and raw string. */
function readClaudeSettings(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

/** Write Claude Code settings.json. */
function writeClaudeSettings(settings: Record<string, any>): void {
  mkdirSync(dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

/** Add devbench hook entries to Claude Code settings (non-destructive merge). */
function addDevbenchHooksToSettings(): void {
  const settings = readClaudeSettings();
  if (!settings.hooks) settings.hooks = {};

  const devbenchHooks = getDevbenchClaudeHooks();

  for (const [eventName, entries] of Object.entries(devbenchHooks)) {
    if (!settings.hooks[eventName]) {
      settings.hooks[eventName] = [];
    }
    // Remove any existing devbench entries first (to avoid duplicates)
    settings.hooks[eventName] = settings.hooks[eventName].filter(
      (entry: any) => !isDevbenchHookEntry(entry)
    );
    // Add fresh entries
    settings.hooks[eventName].push(...entries);
  }

  writeClaudeSettings(settings);
}

/** Remove devbench hook entries from Claude Code settings. */
function removeDevbenchHooksFromSettings(): void {
  const settings = readClaudeSettings();
  if (!settings.hooks) return;

  for (const eventName of Object.keys(settings.hooks)) {
    settings.hooks[eventName] = settings.hooks[eventName].filter(
      (entry: any) => !isDevbenchHookEntry(entry)
    );
    // Clean up empty arrays
    if (settings.hooks[eventName].length === 0) {
      delete settings.hooks[eventName];
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeClaudeSettings(settings);
}

// ── Codex: hooks.json + config.toml merging ────────────────────────

const DEVBENCH_CODEX_HOOK_COMMAND = `node "${CODEX_HOOK_PATH}"`;

function getDevbenchCodexHooks(): Record<string, any[]> {
  return {
    SessionStart: [
      {
        matcher: "startup|resume",
        hooks: [
          { type: "command", command: `${DEVBENCH_CODEX_HOOK_COMMAND} SessionStart` },
        ],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          { type: "command", command: `${DEVBENCH_CODEX_HOOK_COMMAND} UserPromptSubmit` },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          { type: "command", command: `${DEVBENCH_CODEX_HOOK_COMMAND} PreToolUse` },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: "Bash",
        hooks: [
          { type: "command", command: `${DEVBENCH_CODEX_HOOK_COMMAND} PostToolUse` },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          { type: "command", command: `${DEVBENCH_CODEX_HOOK_COMMAND} Stop` },
        ],
      },
    ],
  };
}

function readCodexHooks(): Record<string, any> {
  try {
    return JSON.parse(readFileSync(CODEX_HOOKS_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeCodexHooks(config: Record<string, any>): void {
  mkdirSync(dirname(CODEX_HOOKS_PATH), { recursive: true });
  writeFileSync(CODEX_HOOKS_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

function hasDevbenchCodexHooks(): boolean {
  const config = readCodexHooks();
  if (!config.hooks || typeof config.hooks !== "object") return false;
  return Object.values(config.hooks).some((entries) =>
    Array.isArray(entries) && entries.some((entry) => isDevbenchHookEntry(entry))
  );
}

function addDevbenchHooksToCodexConfig(): void {
  const config = readCodexHooks();
  if (!config.hooks || typeof config.hooks !== "object") config.hooks = {};

  const devbenchHooks = getDevbenchCodexHooks();
  for (const [eventName, entries] of Object.entries(devbenchHooks)) {
    if (!Array.isArray(config.hooks[eventName])) {
      config.hooks[eventName] = [];
    }
    config.hooks[eventName] = config.hooks[eventName].filter(
      (entry: any) => !isDevbenchHookEntry(entry)
    );
    config.hooks[eventName].push(...entries);
  }

  writeCodexHooks(config);
}

function removeDevbenchHooksFromCodexConfig(): void {
  const config = readCodexHooks();
  if (!config.hooks || typeof config.hooks !== "object") return;

  for (const eventName of Object.keys(config.hooks)) {
    if (!Array.isArray(config.hooks[eventName])) {
      delete config.hooks[eventName];
      continue;
    }
    config.hooks[eventName] = config.hooks[eventName].filter(
      (entry: any) => !isDevbenchHookEntry(entry)
    );
    if (config.hooks[eventName].length === 0) {
      delete config.hooks[eventName];
    }
  }

  if (Object.keys(config.hooks).length === 0) {
    delete config.hooks;
  }

  if (Object.keys(config).length === 0) {
    if (existsSync(CODEX_HOOKS_PATH)) unlinkSync(CODEX_HOOKS_PATH);
    return;
  }

  writeCodexHooks(config);
}

function readCodexConfigText(): string {
  try {
    return readFileSync(CODEX_CONFIG_PATH, "utf-8");
  } catch {
    return "";
  }
}

function writeCodexConfigText(text: string): void {
  mkdirSync(dirname(CODEX_CONFIG_PATH), { recursive: true });
  writeFileSync(CODEX_CONFIG_PATH, text, "utf-8");
}

function isCodexHooksFeatureEnabled(): boolean {
  const text = readCodexConfigText();
  let inFeatures = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^\[.*\]$/.test(line)) {
      inFeatures = line === "[features]";
      continue;
    }
    if (!inFeatures) continue;
    const match = line.match(/^codex_hooks\s*=\s*(true|false)\s*$/i);
    if (match) return match[1].toLowerCase() === "true";
  }
  return false;
}

function enableCodexHooksFeature(): void {
  const original = readCodexConfigText();
  const lines = original ? original.split(/\r?\n/) : [];

  let inFeatures = false;
  let featuresSeen = false;
  let nextSectionStart = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^\[.*\]$/.test(line)) {
      if (inFeatures) {
        nextSectionStart = i;
        inFeatures = false;
      }
      if (line === "[features]") {
        inFeatures = true;
        featuresSeen = true;
        nextSectionStart = lines.length;
      }
      continue;
    }
    if (inFeatures && /^codex_hooks\s*=/.test(line)) {
      lines[i] = "codex_hooks = true";
      writeCodexConfigText(lines.join("\n").replace(/\n*$/, "\n"));
      return;
    }
  }

  if (featuresSeen) {
    lines.splice(nextSectionStart, 0, "codex_hooks = true");
  } else {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    lines.push("[features]");
    lines.push("codex_hooks = true");
  }

  writeCodexConfigText(lines.join("\n").replace(/\n*$/, "\n"));
}

function installCodexCommitPushSkill(): void {
  mkdirSync(dirname(CODEX_COMMIT_PUSH_SKILL_DIR), { recursive: true });
  if (existsSync(CODEX_COMMIT_PUSH_SKILL_DIR)) {
    rmSync(CODEX_COMMIT_PUSH_SKILL_DIR, { recursive: true, force: true });
  }
  cpSync(BUNDLED_CODEX_COMMIT_PUSH_SKILL_DIR, CODEX_COMMIT_PUSH_SKILL_DIR, { recursive: true });
}

function uninstallCodexCommitPushSkill(): void {
  if (existsSync(CODEX_COMMIT_PUSH_SKILL_DIR)) {
    rmSync(CODEX_COMMIT_PUSH_SKILL_DIR, { recursive: true, force: true });
  }
}

// ── Install / Uninstall ─────────────────────────────────────────────

export function installClaude(): { success: boolean; error?: string } {
  try {
    // Copy hook script
    mkdirSync(dirname(CLAUDE_HOOK_PATH), { recursive: true });
    copyFileSync(BUNDLED_CLAUDE_HOOK, CLAUDE_HOOK_PATH);

    // Merge hooks into settings.json
    addDevbenchHooksToSettings();

    console.log(`[extensions] Claude Code hook installed at ${CLAUDE_HOOK_PATH}`);
    return { success: true };
  } catch (e: any) {
    console.error(`[extensions] Failed to install Claude hook: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export function uninstallClaude(): { success: boolean; error?: string } {
  try {
    // Remove hook script
    if (existsSync(CLAUDE_HOOK_PATH)) {
      unlinkSync(CLAUDE_HOOK_PATH);
    }

    // Remove hooks from settings.json
    removeDevbenchHooksFromSettings();

    console.log(`[extensions] Claude Code hook uninstalled`);
    return { success: true };
  } catch (e: any) {
    console.error(`[extensions] Failed to uninstall Claude hook: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export function installPi(): { success: boolean; error?: string } {
  try {
    mkdirSync(dirname(PI_EXTENSION_PATH), { recursive: true });
    copyFileSync(BUNDLED_PI_EXTENSION, PI_EXTENSION_PATH);

    console.log(`[extensions] Pi extension installed at ${PI_EXTENSION_PATH}`);
    return { success: true };
  } catch (e: any) {
    console.error(`[extensions] Failed to install Pi extension: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export function uninstallPi(): { success: boolean; error?: string } {
  try {
    if (existsSync(PI_EXTENSION_PATH)) {
      unlinkSync(PI_EXTENSION_PATH);
    }

    console.log(`[extensions] Pi extension uninstalled`);
    return { success: true };
  } catch (e: any) {
    console.error(`[extensions] Failed to uninstall Pi extension: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export function installCodex(): { success: boolean; error?: string } {
  try {
    mkdirSync(dirname(CODEX_HOOK_PATH), { recursive: true });
    copyFileSync(BUNDLED_CODEX_HOOK, CODEX_HOOK_PATH);
    installCodexCommitPushSkill();
    addDevbenchHooksToCodexConfig();
    enableCodexHooksFeature();

    console.log(`[extensions] Codex hook installed at ${CODEX_HOOK_PATH}`);
    return { success: true };
  } catch (e: any) {
    console.error(`[extensions] Failed to install Codex hook: ${e.message}`);
    return { success: false, error: e.message };
  }
}

export function uninstallCodex(): { success: boolean; error?: string } {
  try {
    if (existsSync(CODEX_HOOK_PATH)) {
      unlinkSync(CODEX_HOOK_PATH);
    }
    uninstallCodexCommitPushSkill();
    removeDevbenchHooksFromCodexConfig();

    console.log("[extensions] Codex hook uninstalled");
    return { success: true };
  } catch (e: any) {
    console.error(`[extensions] Failed to uninstall Codex hook: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/** Install or update extensions for the specified agents. */
export function install(agents: string[]): Record<string, { success: boolean; error?: string }> {
  const results: Record<string, { success: boolean; error?: string }> = {};
  for (const agent of agents) {
    switch (agent) {
      case "claude":
        results.claude = installClaude();
        break;
      case "pi":
        results.pi = installPi();
        break;
      case "codex":
        results.codex = installCodex();
        break;
      default:
        results[agent] = { success: false, error: `Unknown agent: ${agent}` };
    }
  }
  return results;
}

/** Uninstall extensions for the specified agents. */
export function uninstall(agents: string[]): Record<string, { success: boolean; error?: string }> {
  const results: Record<string, { success: boolean; error?: string }> = {};
  for (const agent of agents) {
    switch (agent) {
      case "claude":
        results.claude = uninstallClaude();
        break;
      case "pi":
        results.pi = uninstallPi();
        break;
      case "codex":
        results.codex = uninstallCodex();
        break;
      default:
        results[agent] = { success: false, error: `Unknown agent: ${agent}` };
    }
  }
  return results;
}
