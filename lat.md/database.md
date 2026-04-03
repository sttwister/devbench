# Database

SQLite database using better-sqlite3 with WAL mode, migrations, and prepared statements. Managed by [[server/db.ts]].

## Schema

The database has five tables:

### Projects

Stores registered projects with name, filesystem path, optional browser URL, default view mode, and sort order. Path is unique.

### Sessions

Stores active and archived sessions. Key columns:

- `type` — constrained to `terminal`, `claude`, `pi`, `codex`
- `status` — `active` or `archived`
- `tmux_name` — unique identifier for the tmux session
- `mr_url` — JSON array of detected MR/PR URLs
- `mr_statuses` — JSON object mapping MR URLs to their [[shared/types.ts#MrStatus]] data
- `source_url` / `source_type` — link to the originating issue/ticket
- `agent_session_id` — stored for [[sessions#Agent Session Tracking]] to enable conversation resume
- `git_branch` — the feature branch name associated with this session
- `browser_open` / `view_mode` — browser pane state persisted per session

Foreign key to `projects` with `ON DELETE CASCADE`.

### Settings

Key-value store for integration tokens and configuration.

Used for `gitlab_token`, `github_token`, `linear_token`, `jira_token`, `jira_base_url`, and other settings. Managed via the settings API in [[server/routes/settings.ts]].

### Merge Requests

First-class MR/PR entities with full status fields, linked to sessions only.

Each row has a unique `url`, `provider` (gitlab/github/bitbucket), and optional `session_id` (SET NULL on delete). Status fields: state, draft, approved, changes_requested, pipeline_status, auto_merge. No `project_id` — project attribution is implicit from GitButler branch review URLs. Migration v14 creates the table and migrates existing MR data from the sessions `mr_url`/`mr_statuses` JSON columns.

### GitButler Cache

Stores per-project [[gitbutler#Dashboard Cache]] data as JSON with a `last_refreshed` timestamp. Foreign key to `projects`.

## Database Factory

The [[server/db.ts#createDatabase]] function creates and initializes a database instance. It:

1. Opens the SQLite database with WAL mode and foreign keys enabled
2. Creates base tables if they don't exist (idempotent)
3. Runs pending migrations
4. Prepares all SQL statements
5. Returns a public API object with all database operations

In test mode (`VITEST` env var), an in-memory database is used to avoid parallel test workers hitting the same file.

## Migrations

Migrations are defined as an array in [[server/db.ts]] with version numbers, descriptions, and `up` functions. A `schema_version` table tracks applied migrations. The migration runner:

- Finds pending migrations (version > current)
- Runs them in a transaction
- Tolerates "duplicate column" errors for databases partially migrated before version tracking was introduced

Current migrations (v1–v14) cover: type constraint updates, adding columns (`mr_url`, `browser_url`, `agent_session_id`, `source_url`, `git_branch`, etc.), adding tables (`settings`, `gitbutler_cache`, `merge_requests`), adding sort order columns, and migrating MR data from session JSON columns to the `merge_requests` table.

## Row Parsing

The [[server/db.ts#parseSession]] function converts raw database rows into typed `Session` objects. It handles JSON parsing of `mr_url` (array), `mr_statuses` (object), and boolean conversion of `browser_open`.

The [[server/db.ts#parseMergeRequest]] function converts raw `merge_requests` rows into typed `MergeRequest` objects with boolean conversion of integer flags.

## Prepared Statements

All SQL queries use prepared statements for performance and safety.

The statements are created once at database initialization and reused for all operations. Key operations include CRUD for projects, sessions, and merge requests, sort order updates, settings management, and cache operations.
