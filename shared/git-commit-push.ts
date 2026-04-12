import type { SessionType } from "./types.ts";

const GIT_COMMIT_PUSH_COMMAND = "/git-commit-and-push";
const PI_GIT_COMMIT_PUSH_SKILL_COMMAND = "/skill:git-commit-and-push";
const CODEX_GIT_COMMIT_PUSH_SKILL_COMMAND = "$git-commit-and-push";

export function usesGitCommitPushSkill(sessionType: SessionType | string | null | undefined): boolean {
  return sessionType === "pi" || sessionType === "codex";
}

export function getGitCommitPushCommand(sessionType: SessionType | string | null | undefined): string {
  if (sessionType === "pi") return PI_GIT_COMMIT_PUSH_SKILL_COMMAND;
  if (sessionType === "codex") return CODEX_GIT_COMMIT_PUSH_SKILL_COMMAND;
  return GIT_COMMIT_PUSH_COMMAND;
}

export function buildGitCommitPushCommandInput(
  sessionType: SessionType | string | null | undefined,
  opts: {
    branchName?: string | null;
    fallbackBranchName?: string | null;
    staleBranch?: string | null;
  } = {},
): string {
  const command = getGitCommitPushCommand(sessionType);
  const targetBranch = opts.branchName?.trim() || opts.fallbackBranchName?.trim() || "";
  let args = targetBranch ? ` use branch name ${targetBranch}` : "";
  if (targetBranch && opts.staleBranch?.trim()) {
    args += ` stacked on ${opts.staleBranch.trim()}`;
  }
  return `${command}${args}`;
}
