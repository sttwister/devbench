---
lat:
  require-code-mention: true
---
# Tests

Test specifications for devbench, organized by subsystem. Uses Vitest with in-memory SQLite for database tests and mocked dependencies for integration tests.

## Database

Tests for the SQLite persistence layer: row parsing, schema integrity, and CRUD operations.

### Row Parsing

Validates [[server/db.ts#parseSession]] conversion from raw SQLite rows to typed `Session` objects — JSON array/string/legacy parsing for `mr_url`, integer-to-boolean for `browser_open`, null defaults, and field preservation.

### Row Parsing Typed

Validates [[server/db.ts#parseSession]] against the full [[shared/types.ts#RawSessionRow]] interface including `mr_statuses`, `source_url`, `source_type`, `git_branch`, and `sort_order` exclusion from output.

### Schema Integrity

Verifies that a fresh in-memory database has all expected columns on projects, sessions, and merge_requests, supports sort_order, browser state, agent session IDs, source URLs, and auto-incrementing sort order — without needing migrations.

### CRUD Operations

End-to-end tests for project and session CRUD via [[server/db.ts#createDatabase]] using an in-memory database.

Covers add/get/list/update/remove projects, unique path constraint, cascade delete to sessions, session lifecycle (add, rename, archive, unarchive, remove), MR URL updates, browser state, reordering, and all session types.

### Merge Requests CRUD

End-to-end tests for the [[database#Schema#Merge Requests]] table CRUD via [[server/db.ts#createDatabase]] using an in-memory database.

Covers add/get/list/update/remove merge requests, upsert on duplicate URL with session_id preservation, query by session and open-active, status updates, cascade behavior (session delete → SET NULL), multiple providers, and null session_id handling.

## Notifications

Tests for the server-side notification system that tracks when agent sessions need user input.

### Notification Lifecycle

Validates the full notification lifecycle: creating notifications, deduplication (no-op if already notified), clearing on read, re-notification after clear, filtering to active sessions only, and cleanup on session deletion.

## Sessions

Tests for session lifecycle management beyond the database layer.

### Agent Session Tracking

Validates [[server/agent-session-tracker.ts]] command generation for Claude (`--session-id`), Pi (`--session` path), and Codex (`resume`) — UUID generation, path encoding, launch vs resume commands, and the unified `getLaunchInfo` dispatcher.

### Session Naming

Tests for [[server/session-naming.ts]]: default name regex matching, `isDefaultSessionName` with whitespace trimming, `slugifySessionWorkName` normalization to kebab-case, and `toFeatureBranchName` prefix logic.

### Edit Session Source

Validates `updateSessionSource` in the database: setting, clearing, and overwriting `source_url`/`source_type`, nonexistent session handling, field isolation, and source URL storage at session creation time.

## Monitoring

Tests for the per-session background monitoring subsystem.

### Agent Status Detection

Validates [[server/agent-status.ts#hashContent]]: deterministic hashing, change detection in the upper terminal area, ignoring bottom input lines, whitespace normalization, and edge cases (empty content, short content).

### Auto-Rename Content Analysis

Tests for [[server/auto-rename.ts]] pure functions: `stripped` whitespace removal, `contentDifference` character-level diffing, and `normalizeContentForNaming` which strips agent boot noise (update notices, skill warnings, branding, tmux boilerplate).

### MR Link Extraction

Validates [[server/mr-links.ts#extractMrUrls]] pattern matching: GitLab MR and GitHub PR URL extraction; ignoring creation links; deduplication; and prefix filtering for tmux line-wrap artifacts.

### MR Link Dismiss and Add

Tests for MR link dismiss/add state management in `mr-links.ts`: dismiss removes from known set, manual add clears dismissed state, no-op behavior for non-monitored sessions, idempotent start, and cleanup on stop.

### MR Link Polling Cycle

Integration tests using fake timers to verify the MR link polling cycle: new URL detection, dismissed URLs suppressed across polls, re-added URLs after dismiss, manually added URLs persisting, and stop preventing further callbacks.

### Monitor Manager Wiring

Tests for [[server/monitor-manager.ts]] wiring with mocked dependencies: dismiss/add MR URLs, WebSocket broadcast, deduplication, and graceful handling of nonexistent sessions.

Also verifies that `resumeSessionMonitors` passes `resume: true` to agent-status monitoring while `startSessionMonitors` does not, preventing false notifications on server restart.

### Default Name Pattern

Validates the `DEFAULT_NAME_RE` regex exported from [[server/monitor-manager.ts]]: matches generated default names ("Terminal 1", "Claude Code 99") and rejects custom names, partial matches, and names with extra text.

## Hook API

Tests for the agent harness integration hook infrastructure.

### Has Changes Tracking

Validates `has_changes` database flag: defaults to false, set/clear lifecycle, and idempotent set behavior.

### Agent Status Hook

Validates [[server/agent-status.ts#setStatusFromHook]]: sets status to working/waiting on monitored sessions, no-op for unmonitored sessions, and no duplicate callback when status is already the same.

### Auto-Rename Hook

Validates [[server/auto-rename.ts#nameFromPrompt]]: skips short prompts, triggers LLM name generation for valid prompts, and calls the rename callback.

## HTTP Layer

Tests for the HTTP server infrastructure.

### Router

Validates the [[server/router.ts#Router]] class: method matching (GET/POST/PUT/PATCH/DELETE), path parameter extraction (single and multiple), query string stripping, 404 for non-matches, method mismatch, first-match-wins, partial path rejection, and undefined URL handling.

### HTTP Utilities

Tests for [[server/http-utils.ts]]: `sendJson` serialization with default/custom status codes, array and null handling; `readBody` JSON parsing, array support, and rejection of invalid/empty input.

### HTTP Utilities Typed

Additional tests for [[server/http-utils.ts#readBody]] return type behavior: `Record<string, unknown>` access patterns, `in` operator support, undefined for missing keys, and nested object handling.

### Server Factory

Validates [[server/server.ts#createServer]]: returns an `http.Server` instance, responds with 404 JSON for unknown API routes, and 404 for non-API routes in dev mode.

### Poll Endpoint

Integration test for `GET /api/poll`: verifies the response contains `agentStatuses` (object), `orphanedSessionIds` (array), and `notifiedSessionIds` (array) with correct types.

## GitButler

Tests for GitButler CLI integration and diff functionality.

### Git Diff Parser

Validates [[server/gitbutler.ts#parseUnifiedDiff]]: parses unified diff text into DiffResult structures. Tests modified/added/deleted files, binary file detection, multiple files, multiple hunks, hunk line numbers, and empty input.

## Shared

Tests for shared utility modules used by both server and client.

### MR Labels

Tests for [[shared/mr-labels.ts#getMrLabel]]: extracts `!<id>` for GitLab, `#<id>` for GitHub, falls back to "MR"/"PR" for creation links and unknown URLs, and handles self-hosted GitLab/GitHub Enterprise URLs.

### Session Config

Validates [[shared/session-config.ts]] exports: `getSessionIcon` and `getSessionLabel` return correct values for all types with fallbacks, `SESSION_TYPE_CONFIGS` has all four types with required fields, and `SESSION_TYPES_LIST` ordering.

### Session Config Extended

Extended validation of [[shared/session-config.ts]]: unique shortcut keys across types, unique icons, complete type coverage, and terminal-first ordering in `SESSION_TYPES_LIST`.

### Type Contracts

Compile-time and runtime validation of [[shared/types.ts]] interfaces: `AgentStatus` union values, `SessionType` variants, `RawSessionRow` shape with raw DB types (integer `browser_open`, nullable `mr_url`), and `Session` with parsed types (boolean, array).

## Client

Tests for client-side utility functions.

### Reorder

Tests for `computeReorder` in [[client/src/utils/reorder.ts]]: forward/backward moves, beginning/end placement, no-op for missing items or same position, single-item arrays, two-item swaps, and index clamping.

### Drag Core

Additional `computeReorder` tests exercised by the drag-and-drop core: beginning/end moves, no-op when item stays in place, and single-element edge case.

### Diff Parser

Validates `parseHunkLines` from [[client/src/components/DiffViewer.tsx]]: parses additions, deletions, context lines, hunk headers, mixed modifications, "no newline at end of file" markers, and empty hunks.

### Split Diff Pairing

Validates `pairLinesForSplit` from [[client/src/components/DiffViewer.tsx]]: pairs parsed hunk lines into side-by-side rows.

Tests context lines on both sides, consecutive del/add paired as modifications, uneven del/add counts, standalone additions and deletions, empty hunks, and mixed context/modifications/additions.

### File Tree

Validates `buildFileTree` from [[client/src/components/DiffViewer.tsx]]: builds a nested folder tree from flat file paths.

Tests folder grouping, single-child folder chain collapsing, root-level files, mixed files and directories with folders-first sorting, deeply nested paths, empty input, and `getTreeSortedPaths` extraction of flat sorted paths from the tree (including nested folders).
