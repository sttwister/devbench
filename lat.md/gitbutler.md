# GitButler

GitButler dashboard integration — visual branch management with MR/PR status, pull, merge, and push actions.

## CLI Integration

The [[server/gitbutler.ts]] module wraps the `but` (GitButler CLI) command. It shells out to `but` with JSON output and returns typed results defined in [[shared/gitbutler-types.ts]].

Key operations:

- **Status** — `but status --json` returns stacks, branches, commits, and uncommitted changes
- **Diff** — `but diff [target] --no-tui --json` returns unified diffs for uncommitted changes, a commit, or a branch; `--no-tui` is required to prevent the interactive TUI from blocking in a non-terminal context; falls back to `git diff` when the GitButler daemon is unavailable
- **Pull** — `but pull` fetches and integrates upstream changes; parses output for conflict detection
- **Push** — `but push --stack <name>` pushes a stack's branches
- **Unapply** — `but branch unapply <name>` removes a branch from the workspace
- **Is GitButler repo** — attempts `but status` to detect if a project uses GitButler

### Dashboard Building

The [[server/gitbutler.ts]] module transforms raw `but status` output into [[shared/gitbutler-types.ts#DashboardStack]] and [[shared/gitbutler-types.ts#DashboardBranch]] structures for the frontend. This includes:

- Matching branches to active sessions via branch name or MR URL
- Resolving MR/PR statuses from session data
- Extracting review URLs from branch `reviewId` fields
- Each branch only shows MRs from its own GitButler review URLs (not the full session `mr_urls` which may span projects)

## Dashboard Cache

The [[server/gitbutler-cache.ts]] module provides a DB-backed cache for dashboard data with asynchronous background refresh. This ensures the dashboard loads instantly from cached data while refreshing in the background.

Key design:

- **Per-project independence** — each project refreshes independently so fast projects don't block slow ones
- **Cooldown** — minimum 8 seconds between refreshes per project to avoid hammering the CLI
- **Refreshing state** — tracked in memory (`refreshingProjects` Set) so the UI can show a loading indicator
- **Trigger refresh** — called when MR links change, sessions are created/archived, or the user explicitly requests a refresh
- **MR entity creation** — during refresh, branch review URLs are upserted as [[database#Schema#Merge Requests]] entities, linking them to the branch's session
- **Cross-project session linking** — MR entities from branch review URLs are used to discover sessions from other projects, enabling branches to link back to the originating session even when it lives in a different project

The cache stores the full [[shared/gitbutler-types.ts#ProjectDashboard]] as JSON in the `gitbutler_cache` database table.

## Dashboard UI

The [[client/src/components/GitButlerDashboard.tsx]] renders the branch dashboard. It can show a single project (`Ctrl+Shift+D`) or all projects (`Ctrl+Shift+F`).

Features:

- Stack and branch visualization with commit history and uncommitted changes
- MR/PR status badges on branches with linked reviews (using [[client/src/components/MrBadge.tsx]])
- Pull, push, merge, and unapply buttons per branch/project — push is shown when `branchStatus` is `completelyUnpushed`, `unpushedCommits`, or `unpushedCommitsRequiringForce` (force push); branches are color-coded accordingly
- Session linking — branches matched to sessions show a navigation link
- Cross-project session connectors — when multiple projects are shown side-by-side, dashed SVG bezier lines connect branches linked to the same session across project columns
- Merge with optional auto-pull after successful merge
- In-app diff viewer for unstaged changes, commits, and branches (see [[gitbutler#Diff Viewer]])
- `q` keyboard shortcut to close the dashboard (same as the X button); disabled while the diff viewer is open

## Diff Viewer

The [[client/src/components/DiffViewer.tsx]] component displays unified diffs inline in the dashboard. Accessed by clicking commits or branches, or via the always-visible "Diff" button on the unstaged changes card header.

The diff data is fetched via `GET /api/projects/:id/diff?target=<cliId|branchName>` which calls [[server/gitbutler.ts#getDiff]]. When `but diff` fails (e.g. daemon unavailable), it falls back to parsing `git diff` output. Diff types ([[shared/gitbutler-types.ts#DiffResult]], [[shared/gitbutler-types.ts#DiffChange]], [[shared/gitbutler-types.ts#DiffHunk]]) are defined in shared.

Features:

- File list sidebar with A/M/D status indicators and +/- stats
- Unified diff view with line numbers, colored additions/deletions
- Hunk separators: between non-adjacent code regions, a subtle dashed-line divider with `···` dots replaces the raw `@@` hunk header text; the first hunk in a file has no separator
- Collapsible file sections with sticky headers
- Mobile-optimized: file list as a slide-out drawer, smaller line numbers, touch targets, zoom in/out buttons (50%–200%) scaling code and line numbers; on mobile the file-list hamburger button is on the left and the close (X) button is on the right (swapped from desktop layout via CSS `order`)
- Line wrapping toggle: a wrap-text icon button in the header, on by default; when active, diff lines wrap instead of scrolling horizontally
- Vim keybindings: `j`/`k` scroll vertically, `d`/`u` half-page scroll, `h`/`l` jump between files, `q` closes the diff viewer; keys are ignored when an input element is focused
- Binary file detection with placeholder message
- Duplicate file deduplication: multiple changes for the same file path are merged by combining their hunks into a single entry

## Merge and Pull

Merge operations use [[server/mr-merge.ts]] which shells out to `glab merge` (GitLab) or `gh pr merge` (GitHub) CLIs. Pull operations use `but pull` via [[server/gitbutler.ts]]. Both are exposed through the GitButler routes in [[server/routes/gitbutler.ts]].

## Prepare Commit Push

Resolves the correct branch name for a session before committing.

The `POST /api/sessions/:id/prepare-commit-push` endpoint in [[server/routes/sessions.ts]] checks GitButler workspace status, matches branches by MR URL, detects stale (merged) branches, and falls back to generating a `feature/` branch name from the session's work name via [[server/session-naming.ts#toFeatureBranchName]].
