// @lat: [[gitbutler#CLI Integration]]
/**
 * Server-side GitButler CLI integration.
 *
 * Runs `but` commands in project directories and returns typed results.
 * Also handles branch↔session matching for the dashboard.
 */

import { execFile } from "child_process";
import type {
  ButStatus, ButPullCheck, DashboardStack, DashboardBranch,
  Session, ButBranch, ButStack, DiffResult,
} from "@devbench/shared";

// ── CLI execution helpers ───────────────────────────────────────

function runBut(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("but", args, { cwd, timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || err.message;
        return reject(new Error(msg));
      }
      resolve(stdout);
    });
  });
}

export async function isGitButlerRepo(projectPath: string): Promise<boolean> {
  try {
    await getButStatus(projectPath);
    return true;
  } catch {
    return false;
  }
}

/** Run `but status --json` in a project directory. */
export async function getButStatus(projectPath: string): Promise<ButStatus> {
  const raw = await runBut(["status", "--json"], projectPath);
  return JSON.parse(raw);
}

/** Run `but diff [target] --no-tui --json` to get unified diff. Falls back to `git diff` if `but` fails. */
export async function getDiff(projectPath: string, target?: string): Promise<DiffResult> {
  try {
    const args = target
      ? ["diff", target, "--no-tui", "--json"]
      : ["diff", "--no-tui", "--json"];
    const raw = await runBut(args, projectPath);
    return JSON.parse(raw);
  } catch {
    // Fallback to git diff (works even when the GitButler daemon is down)
    return getGitDiff(projectPath, target);
  }
}

/** Git diff fallback — parses raw unified diff into DiffResult. */
function getGitDiff(cwd: string, target?: string): Promise<DiffResult> {
  // For no target: unstaged changes = `git diff`
  // For a commit SHA (7+ hex chars): `git diff <sha>~1 <sha>` (single commit diff)
  // For a branch name: `git diff HEAD...<branch>` (merge-base diff)
  const args = buildGitDiffArgs(target);
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: 15_000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(new Error(err.message));
      resolve(parseUnifiedDiff(stdout ?? ""));
    });
  });
}

function buildGitDiffArgs(target?: string): string[] {
  if (!target) return ["diff"];
  // Looks like a commit SHA (hex, 7-40 chars)
  if (/^[0-9a-f]{7,40}$/i.test(target)) return ["diff", `${target}~1`, target];
  // Otherwise treat as a branch name or ref: diff against merge-base with the default branch
  return ["diff", `HEAD...${target}`, "--"];
}

function parseUnifiedDiff(raw: string): DiffResult {
  const changes: DiffResult["changes"] = [];
  // Split into per-file diffs
  const fileDiffs = raw.split(/^diff --git /m).filter(Boolean);

  for (const fileDiff of fileDiffs) {
    const lines = fileDiff.split("\n");
    // Parse file path from "a/path b/path" header
    const headerMatch = lines[0]?.match(/a\/(.+?)\s+b\/(.+)/);
    const path = headerMatch ? headerMatch[2] : "unknown";

    // Detect status from diff header lines
    let status = "modified";
    for (const line of lines.slice(0, 6)) {
      if (line.startsWith("new file")) { status = "added"; break; }
      if (line.startsWith("deleted file")) { status = "deleted"; break; }
      if (line.startsWith("Binary files")) {
        changes.push({ path, status, diff: { type: "binary", hunks: [] } });
        break;
      }
    }
    if (changes.length > 0 && changes[changes.length - 1].path === path) continue;

    // Parse hunks
    const hunks: DiffResult["changes"][0]["diff"]["hunks"] = [];
    let currentHunk: { oldStart: number; oldLines: number; newStart: number; newLines: number; diffLines: string[] } | null = null;

    for (const line of lines) {
      const hunkMatch = line.match(/^@@\s+-([\d]+)(?:,([\d]+))?\s+\+([\d]+)(?:,([\d]+))?\s+@@(.*)/);
      if (hunkMatch) {
        if (currentHunk) {
          hunks.push({
            oldStart: currentHunk.oldStart,
            oldLines: currentHunk.oldLines,
            newStart: currentHunk.newStart,
            newLines: currentHunk.newLines,
            diff: currentHunk.diffLines.join("\n"),
          });
        }
        currentHunk = {
          oldStart: parseInt(hunkMatch[1]),
          oldLines: parseInt(hunkMatch[2] ?? "1"),
          newStart: parseInt(hunkMatch[3]),
          newLines: parseInt(hunkMatch[4] ?? "1"),
          diffLines: [`@@ -${hunkMatch[1]}${hunkMatch[2] ? `,${hunkMatch[2]}` : ""} +${hunkMatch[3]}${hunkMatch[4] ? `,${hunkMatch[4]}` : ""} @@${hunkMatch[5] ?? ""}`],
        };
      } else if (currentHunk && (line.startsWith("+") || line.startsWith("-") || line.startsWith(" ") || line === "\\ No newline at end of file")) {
        currentHunk.diffLines.push(line);
      }
    }
    if (currentHunk) {
      hunks.push({
        oldStart: currentHunk.oldStart,
        oldLines: currentHunk.oldLines,
        newStart: currentHunk.newStart,
        newLines: currentHunk.newLines,
        diff: currentHunk.diffLines.join("\n"),
      });
    }

    changes.push({ path, status, diff: { type: "patch", hunks } });
  }

  return { changes };
}

// ── Branch review info ──────────────────────────────────────────

export interface BranchReview {
  name: string;
  reviews: { number: number; url: string }[];
}

/** Run `but branch list --review --json` to get PR/MR URLs for branches. */
export async function getBranchReviews(projectPath: string): Promise<BranchReview[]> {
  try {
    const raw = await runBut(["branch", "list", "--review", "--json"], projectPath);
    const parsed = JSON.parse(raw);
    const results: BranchReview[] = [];
    // Applied stacks have heads[]
    for (const stack of parsed.appliedStacks ?? []) {
      for (const head of stack.heads ?? []) {
        results.push({ name: head.name, reviews: head.reviews ?? [] });
      }
    }
    // Unapplied branches
    for (const branch of parsed.branches ?? []) {
      results.push({ name: branch.name, reviews: branch.reviews ?? [] });
    }
    return results;
  } catch {
    return [];
  }
}

/** Push a single branch. Use --with-force for branches requiring force push. */
export async function doPush(
  projectPath: string,
  branchName: string,
  force: boolean = false,
): Promise<void> {
  const args = ["push", branchName];
  if (force) args.push("--with-force");
  await runBut(args, projectPath);
}

/** Run `but unapply --force <branchName>` to unapply a branch from the workspace. */
export async function doUnapply(
  projectPath: string,
  branchName: string,
): Promise<void> {
  await runBut(["unapply", "--force", branchName], projectPath);
}

/** Ensure a specific GitButler branch exists, creating it when missing. */
export async function ensureBranch(
  projectPath: string,
  branchName: string,
): Promise<{ branchName: string; created: boolean }> {
  const [status, branchReviews] = await Promise.all([
    getButStatus(projectPath),
    getBranchReviews(projectPath),
  ]);

  const existsInStacks = status.stacks.some((stack) =>
    stack.branches.some((branch) => branch.name === branchName)
  );
  const existsInBranchList = branchReviews.some((branch) => branch.name === branchName);

  if (existsInStacks || existsInBranchList) {
    return { branchName, created: false };
  }

  const raw = await runBut(["branch", "new", branchName, "--json", "--status-after"], projectPath);
  try {
    const parsed = JSON.parse(raw) as { branch?: string };
    return { branchName: parsed.branch || branchName, created: true };
  } catch {
    return { branchName, created: true };
  }
}

/** Run `but pull --check --json` to see if upstream has changes. */
export async function checkPull(projectPath: string): Promise<ButPullCheck> {
  const raw = await runBut(["pull", "--check", "--json"], projectPath);
  return JSON.parse(raw);
}

/** Run `but pull --json --status-after`. Returns the result. */
export async function doPull(projectPath: string): Promise<{ status: ButStatus | null; hasConflicts: boolean }> {
  try {
    const raw = await runBut(["pull", "--json", "--status-after"], projectPath);
    const parsed = JSON.parse(raw);
    // --status-after wraps result and status
    const status: ButStatus | null = parsed.status ?? null;
    const hasConflicts = status?.stacks?.some(
      (s: ButStack) => s.branches.some(
        (b: ButBranch) => b.commits.some((c) => c.conflicted)
      )
    ) ?? false;
    return { status, hasConflicts };
  } catch (e: any) {
    // Check if the error message indicates conflicts
    const hasConflicts = e.message?.includes("conflict") || false;
    return { status: null, hasConflicts };
  }
}

// ── Branch ↔ Session matching ───────────────────────────────────

/** Slugify a session name for matching against branch names. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Enrich GitButler stacks with linked session info and PR URLs.
 *
 * Session matching priority:
 * 1. Exact: session.git_branch === branch.name
 * 2. MR URL overlap: session.mr_urls ∩ branch review URLs
 * 3. Name similarity: slugified session name matches branch name
 *    (prefers exact slug match, then longest substring match)
 *
 * PR URLs come from `but branch list --review --json` (reviews[].url)
 * and are merged with the linked session's mr_urls/mr_statuses.
 */
export function enrichWithSessions(
  stacks: ButStack[],
  sessions: Session[],
  branchReviews: BranchReview[],
): DashboardStack[] {
  // Build review URL lookup: branch name → review URLs
  const reviewsByBranch = new Map<string, string[]>();
  for (const br of branchReviews) {
    if (br.reviews.length > 0) {
      reviewsByBranch.set(br.name, br.reviews.map((r) => r.url));
    }
  }

  // Build lookup maps for session matching
  const branchToSession = new Map<string, Session>();

  // Pass 1: exact git_branch match
  for (const session of sessions) {
    if (session.git_branch) {
      branchToSession.set(session.git_branch, session);
    }
  }

  // Prepare session slugs for name matching (sorted longest-first for best match)
  const sessionSlugs = sessions
    .map((s) => ({ session: s, slug: slugify(s.name) }))
    .filter((s) => s.slug.length >= 3)
    .sort((a, b) => b.slug.length - a.slug.length);

  // Build MR URL → session lookup for pass 2
  const mrUrlToSession = new Map<string, Session>();
  for (const session of sessions) {
    for (const url of session.mr_urls) {
      mrUrlToSession.set(url, session);
    }
  }

  return stacks.map((stack) => ({
    cliId: stack.cliId,
    assignedChanges: stack.assignedChanges,
    branches: stack.branches.map((branch): DashboardBranch => {
      const branchReviewUrls = reviewsByBranch.get(branch.name) ?? [];

      // Try exact git_branch match first
      let linked = branchToSession.get(branch.name) ?? null;

      // Try MR URL overlap: branch review URLs ∩ session mr_urls
      if (!linked) {
        for (const url of branchReviewUrls) {
          const session = mrUrlToSession.get(url);
          if (session) {
            linked = session;
            break;
          }
        }
      }

      // Try name similarity: prefer exact slug match, then longest substring
      if (!linked) {
        const branchSlug = slugify(branch.name.replace(/^feature\//, ""));
        // First pass: exact slug match
        for (const { session, slug } of sessionSlugs) {
          if (branchSlug === slug) {
            linked = session;
            break;
          }
        }
        // Second pass: substring match (longest slug wins since sorted)
        if (!linked) {
          for (const { session, slug } of sessionSlugs) {
            if (branchSlug.includes(slug)) {
              linked = session;
              break;
            }
          }
        }
      }

      // Merge PR URLs: branch review URLs + linked session's mr_urls (deduplicated)
      // Filter out creation links (/pull/new/, /merge_requests/new) — only show existing PRs/MRs
      const allMrUrls = [...new Set([...branchReviewUrls, ...(linked?.mr_urls ?? [])])]
        .filter((url) => !url.includes("/pull/new/") && !url.includes("/merge_requests/new"));

      return {
        ...branch,
        linkedSession: linked
          ? { id: linked.id, name: linked.name, type: linked.type }
          : null,
        reviewUrls: branchReviewUrls,
        linkedMrUrls: allMrUrls,
      };
    }),
  }));
}
