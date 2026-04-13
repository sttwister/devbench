# Integrations

External service integrations for source URL detection, Linear API, JIRA API, Slack API, and MR/PR status tracking.

## Source URL Detection

Sessions can be linked to an origin (Jira, Linear, Sentry, Slack, GitHub/GitLab issue) via a source URL. The [[shared/source-utils.ts]] module provides pure functions for detection and labeling:

- [[shared/source-utils.ts#detectSourceType]] — matches URL patterns to determine the source type
- [[shared/source-utils.ts#getSourceLabel]] — extracts a short display label (e.g. "PROJ-123" for Jira, "#89" for GitHub issues)
- [[shared/source-utils.ts#getSourceIcon]] — returns the icon name for a source type badge

Source types are defined as a union type in [[shared/source-utils.ts]]: `jira`, `linear`, `sentry`, `github_issue`, `gitlab_issue`, `slack`.

Source link badge colors are defined as CSS custom properties (`--source`, `--source-hover`, `--source-bg`, `--source-bg-hover`) in `client/src/styles/base.css` and used by all source link styles across sidebar, terminal header, and popups.

### Issue Preview

The [[client/src/components/NewSessionPopup.tsx]] previews Linear/JIRA issue details inline when a source URL is entered or auto-pasted.

Fetches start immediately on clipboard auto-paste, or after a 300ms debounce when typing. The issue title is shown next to the source label (e.g. "F-42: Preview issue name"), and the full description is available as a native tooltip on hover. Uses [[client/src/api.ts#fetchLinearIssue]] and [[client/src/api.ts#fetchJiraIssue]] which call the `/api/linear/issue` and `/api/jira/issue` server endpoints.

On touch devices, the URL input is shown by default (since the `u` shortcut requires a hardware keyboard), and the blur-to-close behavior is disabled to prevent paste context menus from dismissing the popup. The same mobile adaptations apply to [[client/src/components/NewJobPopup.tsx]].

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
2. The session is named using [[monitoring#Auto-Rename#Source Content Naming]] from the issue title and description; falls back to [[server/linear.ts#sessionNameFromIssue]] (kebab-case slug) if the LLM call fails
3. The prompt is pasted into the agent terminal after boot delay (not passed as initial prompt, to avoid shell escaping issues with long descriptions)
4. The issue is marked "In Progress" (fire-and-forget)

### Projects and Project Issues

Functions to list Linear projects and fetch their backlog/todo issues, used by the [[orchestration#Dashboard UI#Pull from Linear]] flow.

- [[server/linear.ts#fetchLinearProjects]] — lists all Linear projects accessible to the configured token
- [[server/linear.ts#fetchProjectIssues]] — fetches issues for a Linear project whose workflow state type is `backlog` or `unstarted`, sorted by priority (Urgent → Low, then "No priority" last)

### Token Validation

[[server/linear.ts#validateToken]] verifies a Linear API token by fetching the current user, used by the settings UI to provide immediate feedback.

## JIRA API

The [[server/jira.ts]] module provides JIRA REST API integration. It requires a JIRA API token stored in [[database#Schema#Settings]] under `jira_token`, and the JIRA instance base URL under `jira_base_url`. Supports both Cloud (email:token Basic auth) and Data Center (Bearer PAT).

### Issue Fetching

Functions to retrieve JIRA issue data by key or URL, including image attachments and comments.

- [[server/jira.ts#fetchIssue]] — fetches a JIRA issue by key (e.g. "PROJ-123"), including status, status category, available transitions, image attachments, and all comments (`fields=summary,description,status,attachment,comment`)
- [[server/jira.ts#fetchIssueFromUrl]] — extracts the issue key from a JIRA URL and fetches the issue
- [[server/jira.ts#parseJiraIssueKey]] — extracts the issue key from a JIRA URL pattern (`/browse/PROJ-123`)

Comments are returned inline on the issue (`comments: [{ id, author, body, created }]`) and are included in the prompt generated by [[server/jira.ts#promptFromIssue]] under a `## Comments (N)` section, so the agent sees the full discussion context, not just the description.

### State Transitions

Functions to move JIRA issues through workflow states using the transitions API.

- [[server/jira.ts#markIssueInProgress]] — transitions an issue to the first "indeterminate" (in-progress) category state. Called when a session is created with a JIRA source URL.
- [[server/jira.ts#markIssueNeedsTesting]] — transitions an issue to a "Needs Testing" status (matched case-insensitively by target status name, then by transition name, with `includes` fallbacks). Called when a session is closed via the close endpoint, so finished work is handed off to QA rather than marked fully "Done".

### Image Support

JIRA descriptions and comments can contain inline images (`!filename|params!`). Images are downloaded to tmp files and their paths replace the wiki markup inline, preserving text-image order.

- [[server/jira.ts#parseImageReferences]] — extracts filenames from `!filename!` and `!filename|params!` patterns in JIRA wiki markup
- [[server/jira.ts#downloadIssueImages]] — scans the description **and every comment body** for image references and downloads the matching attachments; returns a filename → local path map
- [[server/jira.ts#replaceImageReferences]] — replaces wiki-markup image references with local file paths; unresolved images are removed
- [[server/jira.ts#buildPromptWithImages]] — downloads images and returns the full prompt (including comments) with image paths inlined; runs concurrently during the agent boot delay

Only attachments with `image/*` MIME types that are actually referenced in the description or comments are downloaded. The same tmp directory (`devbench-uploads`) is used as the drag-and-drop file upload feature.

### Session Integration

When creating a session with a JIRA (or Linear/Slack) source URL, the terminal opens immediately and all issue processing happens in the background after a 3-second boot delay.

1. The session is created immediately with the default name (e.g. "Claude Code 1")
2. After the boot delay, [[server/routes/sessions.ts#processJiraSource]] (or [[server/routes/sessions.ts#processLinearSource]], [[server/routes/sessions.ts#processSlackSource]]) runs in the background:
   - Fetches issue details, renames the session via LLM from issue content (with slugify fallback), broadcasts `session-renamed`
   - For JIRA: downloads images via [[server/jira.ts#buildPromptWithImages]], pastes the prompt with image paths
   - Marks the issue "In Progress" (fire-and-forget)
3. While processing, the session ID is tracked in [[server/routes/sessions.ts#getProcessingSourceSessionIds]] and reported via `/api/poll`
4. The sidebar shows a spinner on sessions that are still processing their source issue

### Token Validation

[[server/jira.ts#validateToken]] verifies a JIRA API token by fetching `/rest/api/2/myself`, used by the settings UI to provide immediate feedback. Requires the base URL to be configured first.

## Slack API

The [[server/slack.ts]] module provides Slack Web API integration via REST. It requires a Slack Bot Token stored in [[database#Schema#Settings]] under the `slack_token` key. The token needs `channels:history`, `channels:read`, and `files:read` scopes.

### URL Parsing

Slack message URLs encode the timestamp as `p<digits>` where the digits represent the ts with the dot removed.

- [[server/slack.ts#parseSlackUrl]] — extracts channel ID, message timestamp, and optional `thread_ts` from a Slack URL (e.g. `https://team.slack.com/archives/C01234/p1234567890123456`)

### Message Fetching

Functions to retrieve Slack message data by channel and timestamp.

- [[server/slack.ts#fetchMessage]] — fetches a single message using `conversations.history` with `inclusive=true` and `limit=1`
- [[server/slack.ts#fetchMessageFromUrl]] — parses a Slack URL and fetches the message, plus thread replies if present
- [[server/slack.ts#fetchThread]] — fetches all messages in a thread using `conversations.replies`

### Media Support

Slack messages can have attached files. Image files (`image/*` MIME type) and video files (`video/*` MIME type) are downloaded to the same tmp directory (`devbench-uploads`) as JIRA images.

- [[server/slack.ts#downloadMessageMedia]] — downloads all image and video attachments from a list of messages, returns local file paths

### Session Integration

When creating a session with a Slack source URL, the same background processing pattern as JIRA/Linear is used:

1. The session is created immediately with the default name
2. After the boot delay, [[server/routes/sessions.ts#processSlackSource]] runs in the background:
   - Fetches the message (and full thread if the message has replies or a `thread_ts`)
   - Renames the session via LLM from message content (with [[server/slack.ts#sessionNameFromMessage]] as fallback)
   - Downloads image and video attachments and pastes the prompt with their local paths via [[server/slack.ts#promptFromMessage]]
3. No state transitions (unlike JIRA/Linear, Slack messages have no workflow states)

### Token Validation

[[server/slack.ts#validateToken]] verifies a Slack API token by calling `auth.test`, used by the settings UI to provide immediate feedback.

## MR/PR Status Tracking

MR/PR status is tracked through [[database#Schema#Merge Requests]] entities and two complementary systems:

- **Detection** — [[monitoring#MR Link Detection]] scans terminal output for MR/PR URLs and creates MR entities
- **Polling** — [[monitoring#MR Status Polling]] fetches live status from GitLab/GitHub APIs and updates MR entities

The status data flows through [[server/monitor-manager.ts]] callbacks which update MR entities in the database, sync to legacy session columns for backward compatibility, broadcast to WebSocket clients, and refresh the [[gitbutler#Dashboard Cache]]. Archived session MR statuses are refreshed on-demand when the archived sessions popup is opened.

## MR/PR Merging

The [[server/mr-merge.ts]] module merges MR/PRs by shelling out to `glab` (GitLab) or `gh` (GitHub) CLIs. It detects the provider from the URL, constructs the appropriate CLI command, and runs it. Used by the [[sessions#Close Session]] flow and the [[gitbutler]] dashboard merge action.

## MR Badge Display

The [[shared/mr-labels.ts]] module provides display utilities for MR status badges: label text, CSS class, and tooltip. Badges are color-coded by state (green = approved, purple = merged, red = failed pipeline, etc.).
