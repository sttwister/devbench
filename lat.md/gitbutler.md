# GitButler

GitButler dashboard integration — visual branch management with MR/PR status, pull, merge, and push actions.

## CLI Integration

The [[server/gitbutler.ts]] module wraps the `but` (GitButler CLI) command. It shells out to `but` with JSON output and returns typed results defined in [[shared/gitbutler-types.ts]].

Key operations:

- **Status** — `but status --json` returns stacks, branches, commits, and uncommitted changes
- **Pull** — `but pull` fetches and integrates upstream changes; parses output for conflict detection
- **Push** — `but push --stack <name>` pushes a stack's branches
- **Unapply** — `but branch unapply <name>` removes a branch from the workspace
- **Is GitButler repo** — attempts `but status` to detect if a project uses GitButler

### Dashboard Building

The [[server/gitbutler.ts]] module transforms raw `but status` output into [[shared/gitbutler-types.ts#DashboardStack]] and [[shared/gitbutler-types.ts#DashboardBranch]] structures for the frontend. This includes:

- Matching branches to active sessions via branch name or MR URL
- Resolving MR/PR statuses from session data
- Extracting review URLs from branch `reviewId` fields

## Dashboard Cache

The [[server/gitbutler-cache.ts]] module provides a DB-backed cache for dashboard data with asynchronous background refresh. This ensures the dashboard loads instantly from cached data while refreshing in the background.

Key design:

- **Per-project independence** — each project refreshes independently so fast projects don't block slow ones
- **Cooldown** — minimum 8 seconds between refreshes per project to avoid hammering the CLI
- **Refreshing state** — tracked in memory (`refreshingProjects` Set) so the UI can show a loading indicator
- **Trigger refresh** — called when MR links change, sessions are created/archived, or the user explicitly requests a refresh

The cache stores the full [[shared/gitbutler-types.ts#ProjectDashboard]] as JSON in the `gitbutler_cache` database table.

## Dashboard UI

The [[client/src/components/GitButlerDashboard.tsx]] renders the branch dashboard. It can show a single project (`Ctrl+Shift+D`) or all projects (`Ctrl+Shift+F`).

Features:

- Stack and branch visualization with commit history and uncommitted changes
- MR/PR status badges on branches with linked reviews (using [[client/src/components/MrBadge.tsx]])
- Pull, push, merge, and unapply buttons per branch/project
- Session linking — branches matched to sessions show a navigation link
- Merge with optional auto-pull after successful merge

## Merge and Pull

Merge operations use [[server/mr-merge.ts]] which shells out to `glab merge` (GitLab) or `gh pr merge` (GitHub) CLIs. Pull operations use `but pull` via [[server/gitbutler.ts]]. Both are exposed through the GitButler routes in [[server/routes/gitbutler.ts]].

## Prepare Commit Push

Resolves the correct branch name for a session before committing.

The `POST /api/sessions/:id/prepare-commit-push` endpoint in [[server/routes/sessions.ts]] checks GitButler workspace status, matches branches by MR URL, detects stale (merged) branches, and falls back to generating a `feature/` branch name from the session's work name via [[server/session-naming.ts#toFeatureBranchName]].
