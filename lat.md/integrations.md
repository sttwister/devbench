# Integrations

External service integrations for source URL detection, Linear API, JIRA API, and MR/PR status tracking.

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

## JIRA API

The [[server/jira.ts]] module provides JIRA REST API integration. It requires a JIRA API token stored in [[database#Schema#Settings]] under `jira_token`, and the JIRA instance base URL under `jira_base_url`. Supports both Cloud (email:token Basic auth) and Data Center (Bearer PAT).

### Issue Fetching

Functions to retrieve JIRA issue data by key or URL.

- [[server/jira.ts#fetchIssue]] — fetches a JIRA issue by key (e.g. "PROJ-123"), including status, status category, and available transitions
- [[server/jira.ts#fetchIssueFromUrl]] — extracts the issue key from a JIRA URL and fetches the issue
- [[server/jira.ts#parseJiraIssueKey]] — extracts the issue key from a JIRA URL pattern (`/browse/PROJ-123`)

### State Transitions

Functions to move JIRA issues through workflow states using the transitions API.

- [[server/jira.ts#markIssueInProgress]] — transitions an issue to the first "indeterminate" (in-progress) category state. Called when a session is created with a JIRA source URL.
- [[server/jira.ts#markIssueDone]] — transitions an issue to the first "done" category state. Called when a session is closed via the close endpoint.

### Session Integration

When creating a session with a JIRA source URL:

1. The issue is fetched and a prompt is generated via [[server/jira.ts#promptFromIssue]] containing the title, description, and reference URL
2. The session is named from the issue title via [[server/jira.ts#sessionNameFromIssue]] (kebab-case slug)
3. The prompt is pasted into the agent terminal after boot delay
4. The issue is marked "In Progress" (fire-and-forget)

### Token Validation

[[server/jira.ts#validateToken]] verifies a JIRA API token by fetching `/rest/api/2/myself`, used by the settings UI to provide immediate feedback. Requires the base URL to be configured first.

## MR/PR Status Tracking

MR/PR status is tracked through [[database#Schema#Merge Requests]] entities and two complementary systems:

- **Detection** — [[monitoring#MR Link Detection]] scans terminal output for MR/PR URLs and creates MR entities
- **Polling** — [[monitoring#MR Status Polling]] fetches live status from GitLab/GitHub APIs and updates MR entities

The status data flows through [[server/monitor-manager.ts]] callbacks which update MR entities in the database, sync to legacy session columns for backward compatibility, broadcast to WebSocket clients, and refresh the [[gitbutler#Dashboard Cache]]. Archived session MR statuses are refreshed on-demand when the archived sessions popup is opened.

## MR/PR Merging

The [[server/mr-merge.ts]] module merges MR/PRs by shelling out to `glab` (GitLab) or `gh` (GitHub) CLIs. It detects the provider from the URL, constructs the appropriate CLI command, and runs it. Used by the [[sessions#Close Session]] flow and the [[gitbutler]] dashboard merge action.

## MR Badge Display

The [[shared/mr-labels.ts]] module provides display utilities for MR status badges: label text, CSS class, and tooltip. Badges are color-coded by state (green = approved, purple = merged, red = failed pipeline, etc.).
