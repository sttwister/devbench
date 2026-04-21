# Database

SQLite database using better-sqlite3 with WAL mode, migrations, and prepared statements. Managed by [[server/db.ts]].

## Schema

The database has eight tables:

### Projects

Stores registered projects with name, path, browser URL, view mode, sort order, and active flag. Path is unique.

The `active` column (INTEGER, default 1) controls whether a project appears in the main sidebar, participates in keyboard navigation, and is included in the GitButler dashboard (both single and all-project views). The `getActiveProjects()` DB function filters to only active projects and is used by the GitButler cache and bulk operations (push-all, pull-all).

The `linear_project_id` column (TEXT, nullable) stores the Linear project UUID associated with this devbench project. It is set automatically on the orchestration dashboard by matching devbench and Linear project names (case-insensitive), and is used by [[orchestration#Dashboard UI#Pull from Linear]] to fetch backlog/todo issues. Managed via `setProjectLinearId` in [[server/db.ts]].

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
- `notified_at` — ISO timestamp of last working→waiting notification, NULL when read (see [[monitoring#Notifications]])
- `has_changes` — boolean flag set by [[hooks]] when the agent writes/edits files, cleared after commit
- `builtin_command` — optional shell command auto-run on creation/revival for terminal sessions (see [[sessions#Builtin Command]])

Foreign key to `projects` with `ON DELETE CASCADE`.

### Settings

Key-value store for integration tokens and configuration.

Used for `gitlab_token`, `github_token`, `linear_token`, `jira_token`, `jira_base_url`, `slack_token`, `claude_plan_mode`, and other settings. Managed via the settings API in [[server/routes/settings.ts]].

### Merge Requests

First-class MR/PR entities with full status fields, linked to sessions only.

Each row has a unique `url`, `provider` (gitlab/github/bitbucket), and optional `session_id` (SET NULL on delete). Status fields: state, draft, approved, changes_requested, pipeline_status, auto_merge. No `project_id` — project attribution is implicit from GitButler branch review URLs. Migration v14 creates the table and migrates existing MR data from the sessions `mr_url`/`mr_statuses` JSON columns.

### GitButler Cache

Stores per-project [[gitbutler#Dashboard Cache]] data as JSON with a `last_refreshed` timestamp. Foreign key to `projects`.

### Orchestration Jobs

Stores autonomous job definitions for the [[orchestration]] system. Key columns: `project_id`, `title`, `description`, `source_url`, `status`, agent type per role, loop counters, and error tracking.

Foreign key to `projects` with CASCADE. Status values: todo, working, waiting_input, review, finished, rejected.

### Orchestration Job Sessions

Join table linking [[orchestration]] jobs to the devbench sessions spawned for each phase. Columns: `job_id`, `session_id`, `role` (orchestrator/implement/review/test). Foreign keys to both `orchestration_jobs` and `sessions` with CASCADE.

### Orchestration Job Events

Persistent event log for [[orchestration]] jobs. Columns: `job_id`, `timestamp`, `type` (info/phase/error/session/output), `message`. Foreign key to `orchestration_jobs` with CASCADE.

All events are retained; cleaned up via CASCADE when the parent job is deleted. Supports incremental polling via auto-increment `id`.

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

Current migrations (v1–v24) cover: type constraint updates, adding columns (`mr_url`, `browser_url`, `agent_session_id`, `source_url`, `git_branch`, `active`, `builtin_command`, etc.), adding tables (`settings`, `gitbutler_cache`, `merge_requests`), adding sort order columns, migrating MR data from session JSON columns to the `merge_requests` table, orchestration tables, a repair migration (v22) to rebuild `orchestration_job_sessions` links lost when v21 dropped `orchestration_jobs` with `foreign_keys=ON` (CASCADE wiped the join table), v23 adds `linear_project_id` to projects, and v24 adds `builtin_command` to sessions.

**CAUTION:** When recreating a table that other tables reference via `FOREIGN KEY ... ON DELETE CASCADE`, the `DROP TABLE` will cascade-delete rows in the referencing tables. SQLite does not allow disabling `foreign_keys` inside a transaction. To safely recreate such tables, either (1) save and restore the referencing table's data in the same migration, or (2) use the rename-old/create-new/copy/drop-old pattern instead of create-new/copy/drop-old.

## Row Parsing

The [[server/db.ts#parseSession]] function converts raw database rows into typed `Session` objects. It handles JSON parsing of `mr_url` (array), `mr_statuses` (object), and boolean conversion of `browser_open`.

The [[server/db.ts#parseMergeRequest]] function converts raw `merge_requests` rows into typed `MergeRequest` objects with boolean conversion of integer flags.

## Prepared Statements

All SQL queries use prepared statements for performance and safety.

The statements are created once at database initialization and reused for all operations. Key operations include CRUD for projects, sessions, and merge requests, sort order updates, settings management, and cache operations.
