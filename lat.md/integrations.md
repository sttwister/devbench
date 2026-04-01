# Integrations

External service integrations for source URL detection, Linear API, and MR/PR status tracking.

## Source URL Detection

Sessions can be linked to an origin (Jira, Linear, Sentry, Slack, GitHub/GitLab issue) via a source URL. The [[shared/source-utils.ts]] module provides pure functions for detection and labeling:

- [[shared/source-utils.ts#detectSourceType]] — matches URL patterns to determine the source type
- [[shared/source-utils.ts#getSourceLabel]] — extracts a short display label (e.g. "PROJ-123" for Jira, "#89" for GitHub issues)
- [[shared/source-utils.ts#getSourceIcon]] — returns the icon name for a source type badge

Source types are defined as a union type in [[shared/source-utils.ts]]: `jira`, `linear`, `sentry`, `github_issue`, `gitlab_issue`, `slack`.

## Linear API

The [[server/linear.ts]] module provides full Linear API integration via GraphQL. It requires a Linear API token stored in [[database#Schema#Settings]] under the `linear_token` key.

### Issue Fetching

Functions to retrieve Linear issue data by identifier or URL.

- [[server/linear.ts#fetchIssue]] — fetches a Linear issue by identifier (e.g. "ENG-123"), including its state, team, and available workflow states
- [[server/linear.ts#fetchIssueFromUrl]] — extracts the identifier from a Linear URL and fetches the issue
- [[server/linear.ts#parseLinearIssueId]] — extracts the issue identifier from a Linear URL pattern

### State Transitions

Functions to move Linear issues through workflow states.

- [[server/linear.ts#markIssueInProgress]] — transitions an issue to the first "started" state in its team. Called when a session is created with a Linear source URL.
- [[server/linear.ts#markIssueDone]] — transitions an issue to the first "completed" state. Called when a session is closed via the close endpoint.

### Session Integration

When creating a session with a Linear source URL:

1. The issue is fetched and a prompt is generated via [[server/linear.ts#promptFromIssue]] containing the title, description, and reference URL
2. The session is named from the issue title via [[server/linear.ts#sessionNameFromIssue]] (kebab-case slug)
3. The prompt is pasted into the agent terminal after boot delay (not passed as initial prompt, to avoid shell escaping issues with long descriptions)
4. The issue is marked "In Progress" (fire-and-forget)

### Token Validation

[[server/linear.ts#validateToken]] verifies a Linear API token by fetching the current user, used by the settings UI to provide immediate feedback.

## MR/PR Status Tracking

MR/PR status is tracked through two complementary systems:

- **Detection** — [[monitoring#MR Link Detection]] scans terminal output for MR/PR URLs
- **Polling** — [[monitoring#MR Status Polling]] fetches live status from GitLab/GitHub APIs

The status data flows through [[server/monitor-manager.ts]] callbacks which update the database, broadcast to WebSocket clients, and refresh the [[gitbutler#Dashboard Cache]].

## MR/PR Merging

The [[server/mr-merge.ts]] module merges MR/PRs by shelling out to `glab` (GitLab) or `gh` (GitHub) CLIs. It detects the provider from the URL, constructs the appropriate CLI command, and runs it. Used by the [[sessions#Close Session]] flow and the [[gitbutler]] dashboard merge action.

## MR Badge Display

The [[shared/mr-labels.ts]] module provides display utilities for MR status badges: label text, CSS class, and tooltip. Badges are color-coded by state (green = approved, purple = merged, red = failed pipeline, etc.).
