/**
 * Server-side GitButler CLI integration.
 *
 * Runs `but` commands in project directories and returns typed results.
 * Also handles branch↔session matching for the dashboard.
 */

import { execFile } from "child_process";
import type {
  ButStatus, ButPullCheck, DashboardStack, DashboardBranch,
  Session, ButBranch, ButStack, MrStatus,
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

/** Run `but status --json` in a project directory. */
export async function getButStatus(projectPath: string): Promise<ButStatus> {
  const raw = await runBut(["status", "--json"], projectPath);
  return JSON.parse(raw);
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
        linkedMrStatuses: {},
      };
    }),
  }));
}

/**
 * Resolve MR statuses for dashboard branches from live session data.
 *
 * This is the single source of truth for MR status data in the dashboard.
 * Called both when building the cache and when reading from it, ensuring
 * statuses are always current regardless of cache age.
 */
export function resolveMrStatuses(
  stacks: DashboardStack[],
  sessions: Session[],
): void {
  // Build session lookup by ID
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  // Build global MR status lookup from ALL sessions (fallback for review URLs
  // that don't belong to the linked session — e.g. closed/merged PRs)
  const globalStatuses = new Map<string, MrStatus>();
  for (const s of sessions) {
    for (const [url, status] of Object.entries(s.mr_statuses)) {
      const existing = globalStatuses.get(url);
      if (!existing || (status.last_checked && (!existing.last_checked || status.last_checked > existing.last_checked))) {
        globalStatuses.set(url, status);
      }
    }
  }

  for (const stack of stacks) {
    for (const branch of stack.branches) {
      const linked = branch.linkedSession
        ? sessionById.get(branch.linkedSession.id)
        : null;

      // Linked session's statuses take priority, then fall back to
      // global statuses from any session
      const statuses: Record<string, MrStatus> = {};
      for (const url of branch.linkedMrUrls) {
        const fromLinked = linked?.mr_statuses?.[url];
        if (fromLinked) {
          statuses[url] = fromLinked;
        } else {
          const fromGlobal = globalStatuses.get(url);
          if (fromGlobal) statuses[url] = fromGlobal;
        }
      }
      branch.linkedMrStatuses = statuses;
    }
  }
}
