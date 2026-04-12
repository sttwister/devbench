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
- [[server/routes/merge-requests.ts]] — Merge request entities: list by session/project, on-demand status refresh
- [[server/routes/hooks.ts]] — Agent hook event endpoints (prompt, idle, MR, changes) for [[hooks]]
- [[server/routes/extensions.ts]] — Agent extension management (install, uninstall, status)
- [[server/routes/orchestration.ts]] — Autonomous job orchestration CRUD and engine control (see [[orchestration]])

### WebSocket

Terminal I/O flows through a WebSocket connection at `/ws/terminal/:id`.

The [[server/websocket.ts#attachWebSocketServer]] function handles upgrades, attaches to tmux via node-pty, and routes resize and input messages. It also handles WebSocket proxy upgrades for the [[browser-pane#Reverse Proxy]].

### Events WebSocket

A global push channel at `/ws/events` for app-wide real-time events, managed by [[server/events.ts]]. Unlike the terminal WebSocket (per-session), this is a single connection shared across all sessions.

The [[server/events.ts#broadcast]] function pushes JSON events to all connected clients. Current event types: `agent-status` (status transitions), `session-notified` (notification created), `notification-read` (notification cleared by another client). Designed to absorb more poll data over time.

## Dev Supervision

The `npm run dev` script in `package.json` runs the server and the Vite client together under `concurrently` with `-k --success first`. Both flags are load-bearing when devbench is managed by a supervisor such as systemd.

- `-k` (`--kill-others`) ensures that if either child dies, the other is killed too. Without it, `concurrently` happily keeps the survivor running and the parent process stays alive, so a supervisor sees the unit as healthy while half of devbench is dead (e.g. Vite gets SIGKILLed but the server keeps logging, leaving the browser UI unreachable).
- `--success first` propagates the first exiting child's exit code instead of always reporting success. Combined with `-k`, this guarantees `npm run dev` exits non-zero on any sub-process death, so `Restart=always` on the systemd unit actually triggers.

The reference unit (`~/.config/systemd/user/devbench.service`) wraps `npm run dev` with `Restart=always` / `RestartSec=5`. Supervision is deliberately at the `concurrently` parent level rather than split per process; the two flags above are what make that granularity correct.

## Startup Flow

The [[server/index.ts]] entry point performs startup in this order:

1. **Resume monitors** — iterates all active sessions from the DB. Sessions whose tmux died are marked orphaned (not archived). Surviving sessions get their [[monitoring]] restarted.
2. **Start MR polling** — starts the global MR status poller via [[server/monitor-manager.ts#startMrStatusPolling]].
3. **Create server** — calls [[server/server.ts#createServer]] to wire up routes and WebSocket.
4. **Health check loop** — a 10-second interval archives sessions whose tmux process has disappeared (skips orphaned sessions).
5. **Listen** — binds to `0.0.0.0:PORT` (default 3001).

## Client-Server Communication

The client communicates with the server through two channels:

- **REST API** — standard HTTP endpoints under `/api/` for CRUD operations, managed by [[client/src/api.ts]]
- **WebSocket** — real-time terminal I/O and control messages. Control messages are prefixed with `\x01` followed by JSON (e.g. `session-renamed`, `mr-links-changed`, `mr-statuses-changed`, `session-ended`). See [[server/terminal.ts#broadcastControl]].
- **Events WebSocket** — real-time push for [[monitoring#Notifications]] events and agent status changes via [[server/events.ts]]. Connected by [[client/src/hooks/useEventSocket.ts]]. Designed to absorb more poll data over time.
- **Polling** — the client polls `/api/poll` every 5 seconds for bulk state (agent statuses, orphaned session IDs, notification state), implemented in [[server/routes/status.ts]]. Provides baseline state; WebSocket pushes provide instant updates on top.
