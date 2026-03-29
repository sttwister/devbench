# Integrations Design: Source Model, Ingest API & MR Status Tracking

## Overview

Three new capabilities:
1. **Source model** — sessions can be linked to their origin (JIRA ticket, Sentry error, Slack thread, etc.)
2. **Ingest API** — a single endpoint that any integration (browser extension, Slack bot, CLI) can call to create a session with context
3. **MR status tracking** — poll GitLab/GitHub APIs to track merge request lifecycle

---

## 1. Source Model

### Database Changes

New columns on `sessions`:

```sql
ALTER TABLE sessions ADD COLUMN source_type TEXT DEFAULT NULL;
-- "jira" | "linear" | "sentry" | "slack" | "github_issue" | "gitlab_issue"

ALTER TABLE sessions ADD COLUMN source_url TEXT DEFAULT NULL;
-- The canonical URL of the source (clickable link back)

ALTER TABLE sessions ADD COLUMN source_json TEXT DEFAULT NULL;
-- JSON blob with source-specific metadata (title, body, images, etc.)

ALTER TABLE sessions ADD COLUMN initial_prompt TEXT DEFAULT NULL;
-- The prompt that was sent to the agent (stored for reference/retry)
```

New table for integration settings:

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Stores: gitlab_token, github_token, prompt templates, etc.
```

New columns for MR status tracking:

```sql
ALTER TABLE sessions ADD COLUMN mr_statuses TEXT DEFAULT NULL;
-- JSON: { "url": { state, approved, pipeline, ... }, ... }
```

### Shared Types

```typescript
// shared/types.ts additions

export type SourceType = "jira" | "linear" | "sentry" | "slack" | "github_issue" | "gitlab_issue";

export interface SessionSource {
  type: SourceType;
  url: string;
  title: string;
  body?: string;
  images?: string[];             // URLs or base64 data URIs
  meta?: Record<string, unknown>; // source-specific (JIRA: key, priority, labels; Sentry: stack trace, frequency; etc.)
}

export interface MrStatus {
  state: "open" | "merged" | "closed";
  draft: boolean;
  approved: boolean;
  changes_requested: boolean;
  pipeline_status: "success" | "failed" | "running" | "pending" | null;
  last_checked: string;          // ISO timestamp
}

// Updated Session interface
export interface Session {
  // ... existing fields ...
  source: SessionSource | null;  // parsed from source_type + source_url + source_json
  initial_prompt: string | null;
  mr_statuses: Record<string, MrStatus>; // keyed by URL
}
```

---

## 2. Ingest API

### Endpoint: `POST /api/ingest`

#### Request

```typescript
interface IngestRequest {
  // Required
  project_id: number;
  session_type: SessionType;          // "claude" | "pi" | "codex" | "terminal"

  // Source context
  source: {
    type: SourceType;
    url: string;
    title: string;
    body?: string;                    // description, error details, message thread
    images?: string[];                // base64 data URIs or public URLs
    meta?: Record<string, unknown>;   // anything source-specific
  };

  // Optional overrides
  initial_prompt?: string;            // custom prompt (skip auto-generation)
  session_name?: string;              // custom name (skip auto-naming from source)
}
```

#### Response

```typescript
// Returns the created Session (same shape as POST /api/projects/:id/sessions)
// 201 Created
{
  id: 42,
  project_id: 3,
  name: "PROJ-123-fix-login-timeout",
  type: "claude",
  source: { type: "jira", url: "...", title: "Fix login timeout", ... },
  initial_prompt: "Implement JIRA ticket PROJ-123: Fix login timeout\n\n...",
  // ... other session fields
}
```

#### Errors

| Status | Condition |
|--------|-----------|
| 400 | Missing required fields, invalid session type |
| 404 | Project not found |
| 500 | tmux/agent launch failure |

### Flow

```
POST /api/ingest
  │
  ├─ 1. Validate project exists
  ├─ 2. Generate session name from source (if not provided)
  │     e.g., "PROJ-123-fix-login-timeout" from JIRA
  ├─ 3. Generate initial prompt from source (if not provided)
  │     Uses prompt templates per source type
  ├─ 4. Write prompt to temp file: /tmp/devbench-prompt-<uuid>.md
  ├─ 5. Create tmux session
  ├─ 6. Launch agent with initial prompt:
  │     Claude: claude --session-id <id> --dangerously-skip-permissions -- "$(cat /tmp/...)"
  │     Pi:     pi --session <path> @/tmp/devbench-prompt-<uuid>.md
  │     Codex:  codex (then send-keys after delay)
  ├─ 7. Store session in DB with source metadata
  ├─ 8. Start monitors (auto-rename, MR links, agent status)
  └─ 9. Return session
```

### Prompt Templates

Default templates per source type. Can be customized via settings.

```typescript
const DEFAULT_TEMPLATES: Record<SourceType, (source: IngestSource) => string> = {

  jira: (s) => `Implement JIRA ticket ${s.meta?.key || ""}: ${s.title}

${s.body || ""}

${s.meta?.acceptance_criteria ? `Acceptance Criteria:\n${s.meta.acceptance_criteria}` : ""}

Reference: ${s.url}`.trim(),

  linear: (s) => `Implement Linear issue ${s.meta?.identifier || ""}: ${s.title}

${s.body || ""}

${s.meta?.priority ? `Priority: ${s.meta.priority}` : ""}

Reference: ${s.url}`.trim(),

  sentry: (s) => `Fix the following error from Sentry:

**${s.title}**

${s.meta?.stack_trace ? `Stack trace:\n\`\`\`\n${s.meta.stack_trace}\n\`\`\`` : ""}

${s.meta?.frequency ? `Frequency: ${s.meta.frequency} events` : ""}
${s.meta?.affected_users ? `Affected users: ${s.meta.affected_users}` : ""}

Reference: ${s.url}`.trim(),

  slack: (s) => `Implement the following request from a Slack conversation:

${s.body || s.title}

${s.meta?.thread_messages ? `Full thread:\n${(s.meta.thread_messages as string[]).map((m, i) => `> ${m}`).join("\n")}` : ""}

Reference: ${s.url}`.trim(),

  github_issue: (s) => `Implement GitHub issue #${s.meta?.number || ""}: ${s.title}

${s.body || ""}

${s.meta?.labels?.length ? `Labels: ${(s.meta.labels as string[]).join(", ")}` : ""}

Reference: ${s.url}`.trim(),

  gitlab_issue: (s) => `Implement GitLab issue #${s.meta?.iid || ""}: ${s.title}

${s.body || ""}

${s.meta?.labels?.length ? `Labels: ${(s.meta.labels as string[]).join(", ")}` : ""}

Reference: ${s.url}`.trim(),
};
```

### Session Naming

Auto-generate a kebab-case name from the source:

```typescript
function nameFromSource(source: IngestSource): string {
  // JIRA: "PROJ-123-fix-login-timeout"
  // Linear: "LIN-45-add-dark-mode"
  // Sentry: "sentry-TypeError-cannot-read-prop"
  // Slack: "slack-fix-the-deploy-script"
  const prefix = source.meta?.key || source.meta?.identifier || source.type;
  const slug = source.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${prefix}-${slug}`;
}
```

### Initial Prompt Injection

The prompt is written to a temp file and passed to the agent CLI:

```typescript
// server/ingest.ts

import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

function writePromptFile(prompt: string): string {
  const filename = `devbench-prompt-${randomUUID()}.md`;
  const filepath = join(tmpdir(), filename);
  writeFileSync(filepath, prompt, "utf-8");
  return filepath;
}

// Modified launch commands:

function claudeLaunchWithPrompt(sessionId: string, promptFile: string): string {
  // Shell substitution reads the file as the prompt argument
  return `claude --session-id ${sessionId} --dangerously-skip-permissions -- "$(cat ${promptFile})"`;
}

function piLaunchWithPrompt(sessionPath: string, promptFile: string): string {
  // Pi's @file syntax includes file content in the message
  return `pi --session ${sessionPath} @${promptFile}`;
}

function codexLaunchWithPrompt(promptFile: string): string {
  // Codex: launch, then send prompt after delay
  return `codex`;
  // Follow up with: tmux send-keys after 3s delay
}
```

Cleanup: temp files are deleted after 60 seconds (agent has read them by then).

---

## 3. MR Status Tracking

### Architecture

Extends existing `mr-links.ts`. When an MR URL is detected:

1. Determine provider (GitLab vs GitHub vs Bitbucket) from URL pattern
2. If a token is configured for that provider, start polling the API
3. Store status in `mr_statuses` JSON column
4. Broadcast status changes to connected WebSocket clients

### API Polling

```typescript
// server/mr-status.ts

interface MrStatusPoller {
  url: string;
  provider: "gitlab" | "github" | "bitbucket";
  timer: NodeJS.Timeout;
}

async function fetchGitLabMrStatus(url: string, token: string): Promise<MrStatus> {
  // Parse: https://gitlab.com/group/project/-/merge_requests/42
  // API:   https://gitlab.com/api/v4/projects/<encoded>/merge_requests/42
  const match = url.match(/^(https?:\/\/[^/]+)\/(.+)\/-\/merge_requests\/(\d+)/);
  if (!match) throw new Error("Invalid GitLab MR URL");
  const [, host, projectPath, mrIid] = match;
  const encoded = encodeURIComponent(projectPath);
  const apiUrl = `${host}/api/v4/projects/${encoded}/merge_requests/${mrIid}`;

  const res = await fetch(apiUrl, { headers: { "PRIVATE-TOKEN": token } });
  const data = await res.json();

  return {
    state: data.state === "merged" ? "merged" : data.state === "closed" ? "closed" : "open",
    draft: data.draft || data.work_in_progress || false,
    approved: (data.approved_by?.length || 0) > 0,
    changes_requested: false, // GitLab doesn't have this natively; check discussions
    pipeline_status: data.head_pipeline?.status || null,
    last_checked: new Date().toISOString(),
  };
}

async function fetchGitHubPrStatus(url: string, token: string): Promise<MrStatus> {
  // Parse: https://github.com/owner/repo/pull/18
  // API:   https://api.github.com/repos/owner/repo/pulls/18
  const match = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) throw new Error("Invalid GitHub PR URL");
  const [, repo, prNumber] = match;

  const prRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  const pr = await prRes.json();

  // Check reviews for changes_requested
  const reviewsRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/reviews`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  const reviews = await reviewsRes.json();
  const latestReviewByUser = new Map<string, string>();
  for (const r of reviews) {
    if (r.state !== "COMMENTED") latestReviewByUser.set(r.user.login, r.state);
  }

  return {
    state: pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open",
    draft: pr.draft || false,
    approved: [...latestReviewByUser.values()].some((s) => s === "APPROVED"),
    changes_requested: [...latestReviewByUser.values()].some((s) => s === "CHANGES_REQUESTED"),
    pipeline_status: null, // Would need separate check-runs API call
    last_checked: new Date().toISOString(),
  };
}
```

### Poll interval

- Active sessions: every 60 seconds
- Archived/background: every 5 minutes (or stop)

### Settings API

```
GET  /api/settings              → { gitlab_token: "glpat-...", github_token: "ghp_..." }
PUT  /api/settings              → { key: "gitlab_token", value: "glpat-..." }
```

Tokens stored in the `settings` table, never exposed to the client in full (masked).

---

## 4. Sidebar UI Changes

### Source Badge

Sessions with a source show a clickable badge below the name (similar to MR badges):

```
🤖 PROJ-123-fix-login-timeout
   🎫 PROJ-123   🟢 !42
```

- `🎫 PROJ-123` — source badge (click opens JIRA)
- `🟢 !42` — MR badge with status color

### Source badge icons per type

| Source | Icon | Example label |
|--------|------|---------------|
| JIRA | 🎫 | `PROJ-123` |
| Linear | 📐 | `LIN-45` |
| Sentry | 🐛 | `Sentry #4521` |
| Slack | 💬 | `#channel` |
| GitHub Issue | 📋 | `#89` |
| GitLab Issue | 📋 | `#12` |

### MR Status Colors

| State | Color | Visual |
|-------|-------|--------|
| Open (no reviews) | ⚪ | grey |
| Open (approved) | 🟢 | green |
| Changes requested | 🟠 | orange |
| Draft | ⚫ | dim/grey |
| Merged | 🟣 | purple |
| Closed | 🔴 | red |
| Pipeline failing | 🔴 | red border/glow |

---

## 5. Browser Extension (Phase 2 — design sketch)

### Architecture

```
Browser Extension
  ├── content-scripts/
  │   ├── jira.ts       — detects JIRA pages, scrapes issue data
  │   ├── linear.ts     — detects Linear pages
  │   ├── sentry.ts     — detects Sentry pages
  │   ├── slack.ts      — detects Slack web pages
  │   └── github.ts     — detects GitHub issue pages
  ├── popup/
  │   └── SendToDevbench.tsx  — project picker, session type, preview prompt
  └── background.ts     — calls devbench ingest API
```

Each content script:
1. Detects if it's on a relevant page (URL pattern matching)
2. Scrapes structured data from the DOM
3. Sends it to the popup/background script
4. Popup shows: project selector, session type, prompt preview, "Send" button

The extension only needs to know the devbench server URL (configured in extension settings).

### Manifest (Chrome MV3)

```json
{
  "manifest_version": 3,
  "name": "Devbench",
  "permissions": ["activeTab", "storage"],
  "host_permissions": ["http://localhost:3001/*"],
  "content_scripts": [
    {
      "matches": ["*://*.atlassian.net/*"],
      "js": ["content-scripts/jira.js"]
    },
    {
      "matches": ["*://linear.app/*"],
      "js": ["content-scripts/linear.js"]
    },
    {
      "matches": ["*://*.sentry.io/*"],
      "js": ["content-scripts/sentry.js"]
    }
  ],
  "action": {
    "default_popup": "popup/index.html"
  }
}
```

---

## 6. Implementation Plan

### Phase 1: Foundation (source model + ingest API)

Files to create/modify:

| File | Change |
|------|--------|
| `shared/types.ts` | Add `SourceType`, `SessionSource`, `MrStatus`, update `Session` |
| `server/db.ts` | Add migrations, add `settings` table, update `parseSession`, new CRUD functions |
| `server/ingest.ts` | **New** — prompt templates, prompt file writing, session creation with source |
| `server/index.ts` | Add `POST /api/ingest` route, settings routes |
| `server/terminal.ts` | Add `createTmuxSessionWithPrompt()` variant |
| `server/agent-session-tracker.ts` | Add `*LaunchWithPrompt()` functions |
| `client/src/api.ts` | Add `ingest()`, `fetchSettings()`, `updateSettings()` |
| `client/src/components/Sidebar.tsx` | Render source badges |

### Phase 2: MR status tracking

| File | Change |
|------|--------|
| `server/mr-status.ts` | **New** — GitLab/GitHub API polling |
| `server/mr-links.ts` | Trigger status polling when new URLs are detected |
| `server/index.ts` | Add `GET /api/settings`, `PUT /api/settings` |
| `client/src/components/Sidebar.tsx` | MR status colors |
| `client/src/components/SettingsModal.tsx` | **New** — token configuration |

### Phase 3: Browser extension

| File | Change |
|------|--------|
| `extension/` | **New directory** — Chrome extension |

---

## 7. Open Decisions

- [ ] **Prompt file cleanup**: delete after 60s? Or keep for debugging/retry?
- [ ] **Images in prompts**: For Slack screenshots / Sentry graphs — include as base64 in prompt? Or save to disk and reference with `@file`? Claude Code supports image paths.
- [ ] **Codex prompt injection**: Codex doesn't support initial prompt args — need `tmux send-keys` after a delay. What delay is safe? 3s? 5s?
- [ ] **Settings storage**: Plain text tokens in SQLite is simple but not encrypted. Good enough for a local dev tool? Or use OS keychain?
- [ ] **GitHub Enterprise / GitLab self-hosted**: MR status API needs configurable base URLs, not just `github.com` and `gitlab.com`. Derive from the MR URL itself?
- [ ] **Two-way sync**: Should merging an MR auto-archive the session? Detect via status polling.
