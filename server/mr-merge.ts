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

  const { stdout, stderr, code } = await runCli("glab", [
    "mr", "merge", mrIid,
    "--auto-merge",
    "--squash",
    "--remove-source-branch",
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
  const { stdout, stderr, code } = await runCli("gh", [
    "pr", "merge", url,
    "--auto",
    "--squash",
    "--delete-branch",
  ]);

  const output = (stdout + "\n" + stderr).toLowerCase();

  if (code === 0) {
    if (output.includes("auto-merge") || output.includes("will be merged")) {
      return { url, outcome: "auto-merge", message: "Auto-merge enabled — will merge when checks pass" };
    }
    return { url, outcome: "merged", message: "Merged successfully" };
  }

  if (output.includes("already merged") || output.includes("was already merged")) {
    return { url, outcome: "merged", message: "Already merged" };
  }

  return { url, outcome: "error", message: (stderr || stdout).trim().slice(0, 200) };
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
