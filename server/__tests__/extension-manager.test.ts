import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";


const home = vi.hoisted(() => ({ path: "" }));
vi.mock("os", async (importOriginal) => ({
  ...await importOriginal<typeof import("os")>(),
  homedir: () => home.path,
}));

describe("Extension manager", () => {
  let tempHome: string;

  async function loadExtensionManager() {
    vi.resetModules();
    home.path = tempHome;
    return import("../extension-manager.ts");
  }

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "devbench-ext-"));
    mkdirSync(join(tempHome, ".codex"), { recursive: true });
    mkdirSync(join(tempHome, ".codex", "skills", "custom-skill"), { recursive: true });
    writeFileSync(
      join(tempHome, ".codex", "skills", "custom-skill", "SKILL.md"),
      "---\nname: custom-skill\ndescription: test\n---\n",
      "utf-8"
    );
    mkdirSync(join(tempHome, ".claude"), { recursive: true });
    mkdirSync(join(tempHome, ".claude", "skills", "custom-skill"), { recursive: true });
    writeFileSync(
      join(tempHome, ".claude", "skills", "custom-skill", "SKILL.md"),
      "---\nname: custom-skill\ndescription: test\n---\n",
      "utf-8"
    );
  });

  afterEach(() => {

    vi.resetModules();
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("installs Codex hooks without clobbering unrelated hooks and enables the feature flag", async () => {
    writeFileSync(
      join(tempHome, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: "echo keep-me" },
              ],
            },
          ],
        },
      }, null, 2) + "\n",
      "utf-8"
    );
    writeFileSync(
      join(tempHome, ".codex", "config.toml"),
      'model = "gpt-5.4"\n\n[features]\nother = true\ncodex_hooks = false\n',
      "utf-8"
    );

    const ext = await loadExtensionManager();
    expect(ext.installCodex().success).toBe(true);

    const hooks = JSON.parse(readFileSync(join(tempHome, ".codex", "hooks.json"), "utf-8"));
    expect(
      hooks.hooks.Stop.some((entry: any) =>
        entry.hooks.some((hook: any) => hook.command === "echo keep-me")
      )
    ).toBe(true);
    expect(hooks.hooks.SessionStart).toBeDefined();
    expect(
      hooks.hooks.SessionStart.some((entry: any) =>
        entry.hooks.some((hook: any) => String(hook.command).includes("devbench-hook.js"))
      )
    ).toBe(true);

    const config = readFileSync(join(tempHome, ".codex", "config.toml"), "utf-8");
    expect(config).toContain('model = "gpt-5.4"');
    expect(config).toContain("other = true");
    expect(config).toContain("hooks = true");
    expect(config).not.toContain("codex_hooks");
    for (const event of ["PermissionRequest", "Interrupt", "SessionEnd", "PreToolUse", "PostToolUse"]) {
      expect(hooks.hooks[event][0].matcher).toBeUndefined();
      expect(hooks.hooks[event][0].hooks[0].timeout).toBe(3);
    }

    const status = ext.getCodexStatus();
    expect(status.installed).toBe(true);
    expect(status.upToDate).toBe(true);
    expect(existsSync(join(tempHome, ".codex", "hooks", "devbench-hook.js"))).toBe(true);
    expect(existsSync(join(tempHome, ".codex", "skills", "git-commit-and-push", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(tempHome, ".codex", "skills", "git-commit-and-push", "SKILL.md"), "utf-8"))
      .toContain("name: git-commit-and-push");
    expect(existsSync(join(tempHome, ".codex", "skills", "custom-skill", "SKILL.md"))).toBe(true);
  });

  it("updates disabled canonical hooks in a commented features table without duplicate keys", async () => {
    writeFileSync(join(tempHome, ".codex", "config.toml"),
      '[features] # flags\nhooks = false # disabled\ncodex_hooks = true\n[other]\nhooks = false\n');
    const ext = await loadExtensionManager();
    expect(ext.installCodex().success).toBe(true);
    const config = readFileSync(join(tempHome, ".codex", "config.toml"), "utf8");
    expect(config).toContain('[features] # flags\nhooks = true\n');
    expect(config).toContain('[other]\nhooks = false');
    expect(config).not.toContain("codex_hooks");
    expect(ext.getCodexStatus().upToDate).toBe(true);
    expect(ext.installCodex().success).toBe(true);
    expect(readFileSync(join(tempHome, ".codex", "config.toml"), "utf8")).toBe(config);
  });

  it("recognizes default-enabled hooks but detects missing lifecycle registrations", async () => {
    const ext = await loadExtensionManager();
    expect(ext.installCodex().success).toBe(true);
    writeFileSync(join(tempHome, ".codex", "config.toml"), 'model = "gpt-5.4"\n');
    expect(ext.getCodexStatus().upToDate).toBe(true);
    const path = join(tempHome, ".codex", "hooks.json");
    const hooks = JSON.parse(readFileSync(path, "utf8"));
    delete hooks.hooks.PermissionRequest;
    writeFileSync(path, JSON.stringify(hooks));
    expect(ext.getCodexStatus().installed).toBe(true);
    expect(ext.getCodexStatus().upToDate).toBe(false);
  });

  it("uninstalls only devbench Codex hooks and preserves unrelated global hooks", async () => {
    writeFileSync(
      join(tempHome, ".codex", "hooks.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            {
              hooks: [
                { type: "command", command: "echo keep-me" },
              ],
            },
          ],
        },
      }, null, 2) + "\n",
      "utf-8"
    );

    const ext = await loadExtensionManager();
    expect(ext.installCodex().success).toBe(true);
    expect(ext.uninstallCodex().success).toBe(true);

    const hooks = JSON.parse(readFileSync(join(tempHome, ".codex", "hooks.json"), "utf-8"));
    expect(
      hooks.hooks.Stop.some((entry: any) =>
        entry.hooks.some((hook: any) => hook.command === "echo keep-me")
      )
    ).toBe(true);
    expect(JSON.stringify(hooks)).not.toContain("devbench-hook.js");
    expect(existsSync(join(tempHome, ".codex", "hooks", "devbench-hook.js"))).toBe(false);
    expect(existsSync(join(tempHome, ".codex", "skills", "git-commit-and-push"))).toBe(false);
    expect(existsSync(join(tempHome, ".codex", "skills", "custom-skill", "SKILL.md"))).toBe(true);
    expect(ext.getCodexStatus().installed).toBe(false);
  });

  it("installs Claude hook and bundled skill", async () => {
    const ext = await loadExtensionManager();
    expect(ext.installClaude().success).toBe(true);

    expect(existsSync(join(tempHome, ".claude", "hooks", "devbench-hook.js"))).toBe(true);
    expect(existsSync(join(tempHome, ".claude", "skills", "git-commit-and-push", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(tempHome, ".claude", "skills", "git-commit-and-push", "SKILL.md"), "utf-8"))
      .toContain("name: git-commit-and-push");
    // Existing skills not clobbered
    expect(existsSync(join(tempHome, ".claude", "skills", "custom-skill", "SKILL.md"))).toBe(true);

    const status = ext.getClaudeStatus();
    expect(status.installed).toBe(true);
    expect(status.upToDate).toBe(true);
  });

  it("uninstalls Claude hook and bundled skill without clobbering other skills", async () => {
    const ext = await loadExtensionManager();
    expect(ext.installClaude().success).toBe(true);
    expect(ext.uninstallClaude().success).toBe(true);

    expect(existsSync(join(tempHome, ".claude", "hooks", "devbench-hook.js"))).toBe(false);
    expect(existsSync(join(tempHome, ".claude", "skills", "git-commit-and-push"))).toBe(false);
    expect(existsSync(join(tempHome, ".claude", "skills", "custom-skill", "SKILL.md"))).toBe(true);
    expect(ext.getClaudeStatus().installed).toBe(false);
  });
});
