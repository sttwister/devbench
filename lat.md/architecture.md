# Architecture

System architecture for devbench — a web-based workbench for managing AI coding agent and terminal sessions across projects.

## Tech Stack

Node.js, TypeScript (native `--experimental-strip-types`), React 18, Vite, xterm.js, WebSocket (`ws`), better-sqlite3, node-pty, tmux, and optionally Electron.

TypeScript is executed directly via Node.js 22+ without a compilation step for the server. The client uses Vite for development and production builds. Tests use Vitest.

## Workspace Layout

The project uses npm workspaces with three packages: `shared`, `server`, and `client`. Electron lives outside the workspace as an optional wrapper.

- `shared/` — Pure TypeScript types and utilities shared between client and server. Imported as `@devbench/shared`. Contains [[shared/types.ts]], [[shared/session-config.ts]], [[shared/source-utils.ts]], [[shared/mr-labels.ts]], and [[shared/gitbutler-types.ts]].
- `server/` — Node.js backend providing HTTP REST API, WebSocket terminal I/O, and all background processing. Entry point: [[server/index.ts]].
- `client/` — React + Vite frontend. Entry point: [[client/src/App.tsx]]. Built to `client/dist/` for production.
- `electron/` — Optional Electron desktop app that wraps the web UI with native browser views. Entry point: [[electron/main.ts]].

## Server Architecture

The server is a plain Node.js HTTP server (no Express) with a custom lightweight [[server/router.ts#Router]] for API routing. Routes are organized into separate modules under `server/routes/`.

### HTTP Server

The [[server/server.ts#createServer]] factory wires together routes, static files, reverse proxy, and WebSocket. In production mode it serves the built client from `client/dist/`.

The server factory is separated from [[server/index.ts]] so it can be imported in tests without triggering startup side effects.

### Route Modules

API routes are split into focused modules registered on a shared [[server/router.ts#Router]] instance:

- [[server/routes/projects.ts]] — Project CRUD, reordering
- [[server/routes/sessions.ts]] — Session CRUD, revive, close, prepare-commit-push, Linear issue fetch
- [[server/routes/settings.ts]] — Integration token management (GitLab, GitHub, Linear)
- [[server/routes/status.ts]] — Polling endpoint for agent statuses and orphaned session IDs
- [[server/routes/gitbutler.ts]] — GitButler dashboard data, pull, merge, push, unapply
- [[server/routes/upload.ts]] — File upload for terminal paste

### WebSocket

Terminal I/O flows through a WebSocket connection at `/ws/terminal/:id`.

The [[server/websocket.ts#attachWebSocketServer]] function handles upgrades, attaches to tmux via node-pty, and routes resize and input messages. It also handles WebSocket proxy upgrades for the [[browser-pane#Reverse Proxy]].

## Startup Flow

The [[server/index.ts]] entry point performs startup in this order:

1. **Resume monitors** — iterates all active sessions from the DB. Sessions whose tmux died are marked orphaned (not archived). Surviving sessions get their [[monitoring]] restarted.
2. **Create server** — calls [[server/server.ts#createServer]] to wire up routes and WebSocket.
3. **Health check loop** — a 10-second interval archives sessions whose tmux process has disappeared (skips orphaned sessions).
4. **Listen** — binds to `0.0.0.0:PORT` (default 3001).

## Client-Server Communication

The client communicates with the server through two channels:

- **REST API** — standard HTTP endpoints under `/api/` for CRUD operations, managed by [[client/src/api.ts]]
- **WebSocket** — real-time terminal I/O and control messages. Control messages are prefixed with `\x01` followed by JSON (e.g. `session-renamed`, `mr-links-changed`, `mr-statuses-changed`, `session-ended`). See [[server/terminal.ts#broadcastControl]].
- **Polling** — the client polls `/api/status` every 3 seconds for agent statuses and orphaned session IDs, implemented in [[server/routes/status.ts]]
