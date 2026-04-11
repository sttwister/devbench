This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

**Devbench** is a development workbench for managing multiple AI coding agent and terminal sessions across projects, backed by tmux for persistence. It provides a web-based dashboard with project management, live terminal emulation, MR/PR tracking, and a GitButler branch dashboard.

- [[architecture]] — System architecture, tech stack, workspace layout, and startup flow
- [[sessions]] — Session lifecycle: creation, types, tmux management, revival, and archival
- [[monitoring]] — Per-session background monitors: auto-rename, agent status, MR detection
- [[hooks]] — Agent harness integration: Claude Code hooks, Pi extensions, hook API, extension manager
- [[integrations]] — External service integrations: Linear API, MR status polling, source URLs
- [[database]] — SQLite schema, migrations, prepared statements, and settings storage
- [[browser-pane]] — Browser panel: reverse proxy, Electron WebContentsView, iframe mode
- [[gitbutler]] — GitButler dashboard: CLI integration, DB cache, branch visualization
- [[client]] — React frontend: component hierarchy, hooks, contexts, and API client
- [[electron]] — Electron desktop wrapper: main process, view management, shortcuts
- [[orchestration]] — Autonomous job orchestration: engine, data model, API routes, kanban dashboard
- [[tests]] — Test specifications: database, sessions, monitoring, HTTP layer, shared, client
