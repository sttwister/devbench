// @lat: [[hooks#Extension Manager]]
/**
 * Manages installation, uninstallation, and version checking of
 * devbench agent extensions (Claude Code hooks and Pi extensions).
 *
 * Extensions are bundled in server/extensions/ and copied to
 * global locations (~/.claude/hooks/ and ~/.pi/agent/extensions/).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Bundled extension paths ─────────────────────────────────────────

const BUNDLED_CLAUDE_HOOK = join(__dirname, "extensions", "claude-hook.js");
const BUNDLED_PI_EXTENSION = join(__dirname, "extensions", "pi-extension.ts");

// ── Install locations ───────────────────────────────────────────────

const CLAUDE_HOOK_PATH = join(homedir(), ".claude", "hooks", "devbench-hook.js");
const CLAUDE_SETTINGS_PATH = join(homedir(), ".claude", "settings.json");
const PI_EXTENSION_PATH = join(homedir(), ".pi", "agent", "extensions", "devbench.ts");

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

export function getAllStatuses(): Record<string, ExtensionStatus> {
  return {
    claude: getClaudeStatus(),
    pi: getPiStatus(),
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
    PostToolUse: [
      {
        matcher: "Write|Edit|Bash",
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
      default:
        results[agent] = { success: false, error: `Unknown agent: ${agent}` };
    }
  }
  return results;
}
