/**
 * Server-side GitButler CLI integration.
 *
 * Runs `but` commands in project directories and returns typed results.
 * Also handles branch↔session matching for the dashboard.
 */

import { execFile } from "child_process";
import type {
  ButStatus, ButPullCheck, DashboardStack, DashboardBranch,
  Session, ButBranch, ButStack,
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
 * Enrich GitButler stacks with linked session info.
 *
 * Matching priority:
 * 1. Exact: session.git_branch === branch.name
 * 2. MR URL overlap: session.mr_urls ∩ branch PR URLs
 * 3. Name similarity: slugified session name appears in branch name
 */
export function enrichWithSessions(
  stacks: ButStack[],
  sessions: Session[],
): DashboardStack[] {
  // Build lookup maps
  const branchToSession = new Map<string, Session>();

  // Pass 1: exact git_branch match
  for (const session of sessions) {
    if (session.git_branch) {
      branchToSession.set(session.git_branch, session);
    }
  }

  // Pass 2: name similarity (only for unmatched branches)
  const sessionSlugs = sessions.map((s) => ({
    session: s,
    slug: slugify(s.name),
  }));

  return stacks.map((stack) => ({
    cliId: stack.cliId,
    assignedChanges: stack.assignedChanges,
    branches: stack.branches.map((branch): DashboardBranch => {
      // Try exact match first
      let linked = branchToSession.get(branch.name) ?? null;

      // Try MR URL overlap
      if (!linked) {
        for (const session of sessions) {
          if (session.mr_urls.length === 0) continue;
          // We don't have branch PR URLs from `but status`, but we can
          // match by checking if any session with mr_urls has a git_branch
          // that could match. For now, skip this pass — will be enhanced
          // when `but branch list --review` data is available.
        }
      }

      // Try name similarity
      if (!linked) {
        const branchSlug = slugify(branch.name.replace(/^feature\//, ""));
        for (const { session, slug } of sessionSlugs) {
          if (slug.length >= 3 && branchSlug.includes(slug)) {
            linked = session;
            break;
          }
        }
      }

      return {
        ...branch,
        linkedSession: linked
          ? { id: linked.id, name: linked.name, type: linked.type }
          : null,
        linkedMrUrls: linked?.mr_urls ?? [],
        linkedMrStatuses: linked?.mr_statuses ?? {},
      };
    }),
  }));
}
