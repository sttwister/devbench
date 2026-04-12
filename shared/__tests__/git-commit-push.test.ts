// @lat: [[tests#Shared#Git Commit Push Commands]]
import { describe, expect, it } from "vitest";

import { buildGitCommitPushCommandInput, getGitCommitPushCommand, usesGitCommitPushSkill } from "../git-commit-push.ts";

describe("git commit push commands", () => {
  it("routes Pi and Codex through the skill command and keeps Claude on the slash command", () => {
    expect(usesGitCommitPushSkill("claude")).toBe(false);
    expect(usesGitCommitPushSkill("pi")).toBe(true);
    expect(usesGitCommitPushSkill("codex")).toBe(true);

    expect(getGitCommitPushCommand("claude")).toBe("/git-commit-and-push");
    expect(getGitCommitPushCommand("pi")).toBe("/skill:git-commit-and-push");
    expect(getGitCommitPushCommand("codex")).toBe("$git-commit-and-push");

    expect(buildGitCommitPushCommandInput("codex", { branchName: "feature/add-login-page" }))
      .toBe("$git-commit-and-push use branch name feature/add-login-page");
    expect(buildGitCommitPushCommandInput("pi", {
      fallbackBranchName: "feature/add-login-page",
      staleBranch: "feature/base-work",
    })).toBe("/skill:git-commit-and-push use branch name feature/add-login-page stacked on feature/base-work");
    expect(buildGitCommitPushCommandInput("claude")).toBe("/git-commit-and-push");
  });
});
