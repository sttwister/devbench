/**
 * MR/PR merge via forge CLIs (glab, gh).
 *
 * Detects the forge from the URL and calls the appropriate CLI with
 * auto-merge semantics: merges immediately if ready, or enables
 * "merge when pipeline succeeds" if CI is still running.
 */

import { execFile } from "child_process";
import { detectProvider } from "./mr-status.ts";

export interface MergeResult {
  url: string;
  /** "merged" = merged immediately, "auto-merge" = will merge when CI passes, "error" = failed */
  outcome: "merged" | "auto-merge" | "error";
  message: string;
}

function runCli(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 30_000 }, (err, stdout, stderr) => {
      const code = err && "code" in err ? (err as any).code ?? 1 : err ? 1 : 0;
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "", code });
    });
  });
}

// ── GitLab merge via glab ───────────────────────────────────────

async function mergeGitLab(url: string): Promise<MergeResult> {
  // Parse: https://gitlab.com/group/subgroup/project/-/merge_requests/42
  const match = url.match(/^https?:\/\/[^/]+\/(.+)\/-\/merge_requests\/(\d+)/);
  if (!match) return { url, outcome: "error", message: "Could not parse GitLab MR URL" };

  const [, projectPath, mrIid] = match;

  // Note: no --remove-source-branch — stacked MRs break if intermediate branches are deleted
  const { stdout, stderr, code } = await runCli("glab", [
    "mr", "merge", mrIid,
    "--auto-merge",
    "--squash",
    "--yes",
    "-R", projectPath,
  ]);

  const output = (stdout + "\n" + stderr).toLowerCase();

  if (code === 0) {
    // glab prints "Merging…" or "auto merge enabled" style messages
    if (output.includes("auto") || output.includes("when pipeline succeeds") || output.includes("set to be merged")) {
      return { url, outcome: "auto-merge", message: "Auto-merge enabled — will merge when pipeline succeeds" };
    }
    return { url, outcome: "merged", message: "Merged successfully" };
  }

  // Check for common recoverable messages
  if (output.includes("already merged")) {
    return { url, outcome: "merged", message: "Already merged" };
  }

  return { url, outcome: "error", message: (stderr || stdout).trim().slice(0, 200) };
}

// ── GitHub merge via gh ─────────────────────────────────────────

async function mergeGitHub(url: string): Promise<MergeResult> {
  // Step 1: try direct merge (works when checks have passed or aren't required)
  // Note: no --delete-branch — stacked PRs break if intermediate branches are deleted
  const direct = await runCli("gh", [
    "pr", "merge", url,
    "--squash",
  ]);

  const directOut = (direct.stdout + "\n" + direct.stderr).toLowerCase();

  if (direct.code === 0) {
    return { url, outcome: "merged", message: "Merged successfully" };
  }

  if (directOut.includes("already merged") || directOut.includes("was already merged")) {
    return { url, outcome: "merged", message: "Already merged" };
  }

  // Step 2: direct merge failed — try enabling auto-merge
  // (requires branch protection rules; may fail on unprotected repos)
  const auto = await runCli("gh", [
    "pr", "merge", url,
    "--auto",
    "--squash",
  ]);

  const autoOut = (auto.stdout + "\n" + auto.stderr).toLowerCase();

  if (auto.code === 0) {
    if (autoOut.includes("auto-merge") || autoOut.includes("will be merged")) {
      return { url, outcome: "auto-merge", message: "Auto-merge enabled — will merge when checks pass" };
    }
    return { url, outcome: "merged", message: "Merged successfully" };
  }

  // Both attempts failed — report the more useful error.
  // If auto-merge failed due to branch protection, report the direct merge error instead.
  const autoFailed = autoOut.includes("branch protection") || autoOut.includes("not configured");
  const errorMsg = autoFailed
    ? (direct.stderr || direct.stdout).trim().slice(0, 200)
    : (auto.stderr || auto.stdout).trim().slice(0, 200);

  return { url, outcome: "error", message: errorMsg || "Merge failed" };
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Merge a single MR/PR by URL.
 * Detects the forge and calls the appropriate CLI.
 */
export async function mergeMr(url: string): Promise<MergeResult> {
  const provider = detectProvider(url);
  if (!provider) {
    return { url, outcome: "error", message: "Unknown forge — cannot determine if GitHub or GitLab" };
  }

  try {
    if (provider === "gitlab") return await mergeGitLab(url);
    if (provider === "github") return await mergeGitHub(url);
    return { url, outcome: "error", message: `Unsupported provider: ${provider}` };
  } catch (e: any) {
    return { url, outcome: "error", message: e.message || "Merge failed" };
  }
}

/**
 * Merge multiple MR/PR URLs. Runs sequentially to avoid rate limits.
 */
export async function mergeMrs(urls: string[]): Promise<MergeResult[]> {
  const results: MergeResult[] = [];
  for (const url of urls) {
    results.push(await mergeMr(url));
  }
  return results;
}
