import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// @lat: [[tests#Hook API#Codex Extension Manager]]

describe("Codex extension manager", () => {
  const originalHome = process.env.HOME;
  let tempHome: string;

  async function loadExtensionManager() {
    vi.resetModules();
    process.env.HOME = tempHome;
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
  });

  afterEach(() => {
    process.env.HOME = originalHome;
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
    expect(config).toContain("codex_hooks = true");

    const status = ext.getCodexStatus();
    expect(status.installed).toBe(true);
    expect(status.upToDate).toBe(true);
    expect(existsSync(join(tempHome, ".codex", "hooks", "devbench-hook.js"))).toBe(true);
    expect(existsSync(join(tempHome, ".codex", "skills", "git-commit-and-push", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(tempHome, ".codex", "skills", "git-commit-and-push", "SKILL.md"), "utf-8"))
      .toContain("name: git-commit-and-push");
    expect(existsSync(join(tempHome, ".codex", "skills", "custom-skill", "SKILL.md"))).toBe(true);
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
});
