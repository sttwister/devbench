# Devbench

A development workbench for managing multiple AI coding agent and terminal sessions across projects. Think of it as a dashboard that organizes your Claude Code, Pi, Codex, and plain terminal sessions — all backed by tmux for persistence.

![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=black)
![Electron](https://img.shields.io/badge/Electron-33-47848f?logo=electron&logoColor=white)

---

## Features

### 🗂️ Project Management
- Register projects by name and filesystem path
- Optional browser URL per project for live-previewing web apps
- Full CRUD — create, edit, and delete projects from the sidebar
- **Drag-and-drop reordering** for projects and sessions in the sidebar

### 💻 Session Types
- **Terminal** — plain shell session
- **Claude Code** — launches `claude --dangerously-skip-permissions`
- **Pi** — launches the `pi` coding agent
- **Codex** — launches `codex`

Each session runs inside a detached **tmux** session, so they survive page reloads, reconnects, and server restarts.

### 🎫 Source URL & Issue Tracking
- Attach a **source URL** when creating or editing a session (Jira ticket, Linear issue, Sentry error, GitHub/GitLab issue, Slack thread)
- Auto-detects source type and displays a labelled badge (e.g. `PROJ-123` for Jira)
- Issue and MR/PR links shown in the **terminal header** for quick access on any device
- **Edit session popup** (`Ctrl+Shift+E` or via session context menu) to update source URL and manage MR/PR links

### 🔌 Live Terminal
- Full terminal emulation in the browser via [xterm.js](https://xtermjs.org/)
- WebSocket connection streams I/O between the browser and tmux (via `node-pty`)
- Resize support — terminal dimensions sync automatically
- Sessions that exit from inside (e.g. `exit`, `Ctrl+D`) are detected and archived

### 🤖 Auto-Rename
Sessions start with a generic name like *"Claude Code 1"*. Once meaningful activity is detected in the terminal, Devbench uses **Claude Haiku** to generate a short, descriptive kebab-case name based on the terminal content — so your sidebar stays readable even with many sessions.

### 🟢 Agent Status Tracking
- Agent sessions (Claude Code, Pi, Codex) are monitored for activity
- Status shows **working** (spinner) or **waiting** (idle) based on terminal content changes
- Only the conversation/output area is tracked — input area keystrokes are ignored to avoid false positives

### 🔗 MR/PR Link Detection & Status
Terminal output is periodically scanned for merge request and pull request URLs from:
- **GitLab** — `/-/merge_requests/<id>` and `/merge_requests/new`
- **GitHub** — `/pull/<id>` and `/pull/new/`
- **Bitbucket** — `/pull-requests/<id>`

Detected links appear as **rich status badges** on sessions in the sidebar:
- **API polling** fetches live status from GitLab/GitHub (open, merged, closed, draft, approved, changes requested, pipeline status)
- Badges are color-coded by state (green = approved, purple = merged, red = failed pipeline, etc.)
- Configure API tokens in **Settings** (`⚙️` button) to enable status polling

### 🌐 Browser Pane
- Side-by-side browser panel for previewing your web app alongside the terminal
- **Electron mode**: native `WebContentsView` with a real browser toolbar, tab bar (project URL + MR tabs), and URL navigation
- **Web mode**: inline `<iframe>` with address bar, back/forward, reload, and a draggable split resizer
- **Reverse proxy** — proxies HTTP dev server targets through the Devbench server to fix HTTPS mixed-content issues

### 🌿 GitButler Dashboard
- Visual **branch dashboard** showing stacks, branches, commits, and uncommitted changes per project
- **MR/PR status** badges on branches with linked reviews
- **Pull** from upstream with one click (per-project or all projects at once)
- **Merge** MRs/PRs directly from the dashboard via `glab` / `gh` CLIs with auto-merge support
- **Session linking** — branches are matched to active sessions, with quick navigation
- **DB-backed cache** with per-project background refresh for instant load times
- Open per-project (`Ctrl+Shift+D`) or across all projects (`Ctrl+Shift+F`)

### 🤖 Orchestration
- **Autonomous job execution** — define a backlog of work items and let Devbench run coding agents, code review, and testing cycles automatically
- **Kanban dashboard** — six-column board (Todo, Working, Waiting, Review, Finished, Rejected) toggled with `Ctrl+Shift+I`
- **Implementation → Review → Testing pipeline** — each job progresses through phases, launching agent sessions for each step
- **Loop-based review & testing** — if a reviewer or tester makes changes, the phase re-runs automatically (up to configurable max loops)
- **Configurable agents** — choose which agent type (Claude Code, Pi, Codex) to use for each role (implement, review, test)
- **Job event log** — persistent, structured event log per job with color-coded entries (info, phase, error, session, output)
- **Detail panel** — click a job card to see full info, linked sessions, actions, and a live-updating event log
- **Start/Stop controls** — start the engine to process the backlog, or start a specific job immediately
- **Source URL linking** — attach a Linear issue, Jira ticket, or other URL to a job for context

### 📱 Mobile & PWA
- **Installable as a PWA** — add to home screen on mobile for a native app experience
- **Mobile keyboard bar** with Esc, Tab, Ctrl, Alt, arrow keys, and a git-commit-and-push button
- **Swipe gestures** — swipe left/right to navigate between sessions
- **Touch scrolling** for terminal content
- **Long-press to rename** sessions on touch devices
- Sidebar auto-closes on session creation for more screen space
- Optimized terminal font size for mobile viewports
- Native input with dictation and autofill support

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+J` | Next session |
| `Ctrl+Shift+K` | Previous session |
| `Ctrl+Shift+N` | New session |
| `Ctrl+Shift+R` | Rename session |
| `Ctrl+Shift+X` | Kill session |
| `Ctrl+Shift+A` | Archived sessions |
| `Ctrl+Shift+B` | Toggle browser pane |
| `Ctrl+Shift+T` | Toggle terminal session |
| `Ctrl+Shift+G` | Git commit & push |
| `Ctrl+Shift+D` | GitButler dashboard (project) |
| `Ctrl+Shift+F` | GitButler dashboard (all projects) |
| `Ctrl+Shift+L` | GitButler pull (in dashboard) |
| `Ctrl+Shift+I` | Orchestration dashboard |
| `Ctrl+Shift+?` | Show shortcuts help |

### 🔄 Session Revival & Crash Recovery
- **Orphaned session detection** — If the server restarts after a crash or power failure, sessions whose tmux died are marked *orphaned* (not archived), preserving them for revival
- **Agent session tracking** — Claude Code and Pi sessions store their agent session IDs so conversations can be resumed after a crash
  - Claude: launched with `--session-id <uuid>` for deterministic resume
  - Pi: launched with `--session <path>` to persist conversation state
- **Revive orphaned sessions** — Orphaned sessions appear dimmed in the sidebar with a 🔄 button; reviving creates a new tmux and resumes the agent conversation
- **Revive archived sessions** — Open the archived sessions popup (`Ctrl+Shift+A` or the 🗄 button on a project header) to browse and revive previously closed sessions
- **Keyboard navigation** — The archived sessions popup supports `j`/`k` to navigate, `Enter` to revive, `Esc` to close
- **Archive on kill** — Killing a session archives it instead of deleting, so it can be recovered later; permanent delete is only available from the archived list

### 🔄 WebSocket Auto-Reconnect
- Terminal WebSocket connections automatically reconnect on disconnect
- Active session is **persisted in the URL**, so refreshes and server restarts return you to the same session

### 🛡️ Health & Cleanup
- On startup, sessions whose tmux died are kept as *orphaned* (revivable), not silently discarded
- A periodic health check (every 10s) archives any sessions whose tmux process has disappeared (skips orphaned sessions)
- Auto-rename and MR monitoring are restarted for surviving sessions on server boot

---

## Architecture

```
devbench/
├── shared/              # TypeScript types shared between client & server
│   ├── types.ts             # Core types (Session, Project, MrStatus, AgentStatus)
│   ├── session-config.ts    # Session type definitions & icons
│   ├── gitbutler-types.ts   # GitButler CLI output types & dashboard models
│   ├── mr-labels.ts         # MR badge status labels & formatting
│   └── source-utils.ts      # Source URL detection (Jira, Linear, Sentry, etc.)
├── server/              # Node.js backend (HTTP + WebSocket)
│   ├── index.ts             # Entry point & startup routines
│   ├── server.ts            # HTTP server factory
│   ├── router.ts            # Lightweight HTTP router
│   ├── websocket.ts         # WebSocket terminal I/O
│   ├── db.ts                # SQLite database (better-sqlite3) with migrations
│   ├── terminal.ts          # tmux + node-pty session management
│   ├── auto-rename.ts       # LLM-powered session naming
│   ├── agent-status.ts      # Agent working/waiting status monitor
│   ├── mr-links.ts          # MR/PR URL extraction from terminal output
│   ├── mr-status.ts         # MR/PR API status polling (GitLab, GitHub)
│   ├── mr-merge.ts          # MR/PR merge via glab/gh CLIs
│   ├── proxy.ts             # Reverse proxy for browser-pane HTTP targets
│   ├── gitbutler.ts         # GitButler CLI integration
│   ├── gitbutler-cache.ts   # DB-backed dashboard cache with background refresh
│   ├── monitor-manager.ts   # Centralized session monitor lifecycle
│   ├── agent-session-tracker.ts  # Agent session ID generation & resume
│   ├── orchestration.ts     # Autonomous job execution engine
│   └── routes/
│       └── orchestration.ts # Orchestration REST API endpoints
├── client/              # React + Vite frontend
│   └── src/
│       ├── App.tsx              # Main app shell
│       ├── api.ts               # REST API client
│       └── components/          # UI components
│           ├── Sidebar.tsx          # Project & session sidebar
│           ├── TerminalPane.tsx     # xterm.js terminal emulator
│           ├── BrowserPane.tsx      # Side-by-side browser panel
│           ├── GitButlerDashboard.tsx  # Branch visualization dashboard
│           ├── MobileKeyboardBar.tsx   # Touch keyboard bar
│           ├── EditSessionPopup.tsx    # Source URL & MR link editor
│           ├── SettingsModal.tsx       # API token configuration
│           ├── OrchestrationDashboard.tsx  # Orchestration kanban board
│           └── ...                    # Popups, modals, shared components
├── electron/            # Optional Electron desktop wrapper
│   ├── main.ts              # Electron main process
│   ├── view-manager.ts      # WebContentsView management
│   ├── layout.ts            # Window layout & resizing
│   ├── shortcuts.ts         # Electron keyboard shortcuts
│   └── preload.ts           # Context bridge for renderer
└── package.json         # Workspace root
```

**Tech stack**: Node.js · TypeScript (native `--experimental-strip-types`) · React 18 · Vite · xterm.js · WebSocket (ws) · better-sqlite3 · node-pty · tmux · Electron (optional) · Vitest

---

## Prerequisites

- **Node.js** ≥ 22.6 (for native TypeScript stripping)
- **tmux** installed and on `PATH`
- **claude** CLI on `PATH` (for Claude Code sessions and auto-rename)
- **pi** CLI on `PATH` (for Pi sessions, optional)
- **codex** CLI on `PATH` (for Codex sessions, optional)
- **but** (GitButler CLI) on `PATH` (for GitButler dashboard, optional)
- **glab** / **gh** on `PATH` (for MR/PR merging from the dashboard, optional)

---

## Getting Started

### Install dependencies

```bash
npm install
```

This installs all three workspaces (`shared`, `server`, `client`) via npm workspaces.

### Development mode

```bash
npm run dev
```

This runs **concurrently**:
- The server on `http://localhost:3001` (with `--watch` for auto-reload)
- The Vite dev server on `http://localhost:5173` (with HMR)

Open `http://localhost:5173` in your browser.

### Network access (optional)

If you access Devbench over the network (e.g. via a Tailscale hostname), Vite blocks requests from unrecognized hosts by default. To allow your hostname, create `client/.env.local`:

```bash
VITE_ALLOWED_HOSTS=myhost,myhost.my-tailnet.ts.net
```

Comma-separated list of hostnames. This file is gitignored since it's machine-specific.

### Production build

```bash
# Build the client
npm run build

# Start the production server (serves the built client)
npm start
```

The production server runs on port `3001` by default. Override with the `PORT` environment variable:

```bash
PORT=8080 npm start
```

### Electron (optional)

To run as a native desktop app:

```bash
# From the repo root — start the backend first
npm run dev:server

# In another terminal — build and launch Electron
cd electron
npm install
npm run dev
```

For standalone Electron (connecting to a running server):

```bash
cd electron
npm run start
```

Set `DEVBOX_URL` to point at a remote server if needed:

```bash
DEVBOX_URL=http://my-server:3001 npm run start
```

---

## Usage

1. **Add a project** — Click the `+` button in the sidebar. Enter a name, the absolute filesystem path, and optionally a browser URL.
2. **Create a session** — Expand a project and click the `+` icon, or press `Ctrl+Shift+N`. Pick Terminal, Claude Code, Pi, or Codex. Optionally attach a source URL (Jira, Linear, etc.).
3. **Switch sessions** — Click in the sidebar, use `Ctrl+Shift+J` / `Ctrl+Shift+K`, or swipe left/right on mobile.
4. **Browser pane** — If a project has a browser URL configured, press `Ctrl+Shift+B` to open a side-by-side browser.
5. **MR links** — When a `git push` prints a merge request URL, it appears as a status badge on the session. Configure GitLab/GitHub tokens in Settings to enable live status polling.
6. **GitButler dashboard** — Press `Ctrl+Shift+D` for the current project or `Ctrl+Shift+F` for all projects. View branches, pull upstream changes, and merge MRs/PRs.
7. **Git commit & push** — Press `Ctrl+Shift+G` to send `/git-commit-and-push` to an agent session.
8. **Orchestration** — Press `Ctrl+Shift+I` to open the orchestration dashboard. Add jobs with a title, description, and optional source URL. Start the engine to process jobs automatically through implementation, review, and testing phases.
9. **Revive sessions** — Press `Ctrl+Shift+A` to open the archived sessions list for the current project. Use `j`/`k` to browse, `Enter` to revive. Orphaned sessions (from a crash) also show a revive button directly in the sidebar.
10. **Mobile** — Install as a PWA from your browser. Use the floating keyboard bar for special keys, swipe to switch sessions, and long-press to rename.

---

## Orchestration

The orchestration system lets you define a backlog of work items and have Devbench autonomously execute them through a multi-phase pipeline using coding agents. Open the dashboard with `Ctrl+Shift+I`.

### How It Works

Each job progresses through the following phases:

1. **Implementation** — an agent session writes the code based on the job description
2. **Code Review** — a separate agent reviews the implementation and fixes issues
3. **Testing** — an agent runs tests and fixes any failures
4. **Commit & Push** — a final agent commits via GitButler and creates a PR/MR
5. **Manual Review** — the job moves to `review` status for human approval

No phase commits or pushes except the final commit phase — each phase's prompt explicitly forbids `git commit` / `git push` so agents only do the work assigned to them.

### Job Lifecycle

Jobs progress through a state machine:

| Status | Meaning |
|---|---|
| `todo` | Queued for processing |
| `working` | Orchestrator agent is running (covers implementation, review, and testing phases) |
| `waiting_input` | Blocked — needs user clarification or timed out |
| `review` | Awaiting manual review |
| `finished` | Approved and complete |
| `rejected` | Declined during review |

If any phase times out or fails, the job moves to `waiting_input` and the engine proceeds to the next job.

### Review & Test Loops

After each review or test pass, the engine checks whether the agent made file changes. If changes were detected, it indicates issues were found and fixed, so another pass runs automatically. Loops continue up to the configured maximum (default 3 for both review and test). If no changes were made, the code is considered clean and the loop exits.

### Configurable Agents

Each job can specify which agent type to use for each role:
- **Implement** — the agent that writes code (Claude Code, Pi, or Codex)
- **Review** — the agent that reviews and fixes issues
- **Test** — the agent that runs and fixes tests

Agent types and max loop counts are configurable per job.

### Dashboard

The orchestration dashboard (`Ctrl+Shift+I`) provides:

- **Kanban board** — seven columns showing jobs grouped by status
- **Job cards** — title, project name, source link, error display, and hover quick-actions
- **Detail panel** — click a card to see full info, linked sessions, actions, and a live-updating event log
- **Add Job form** — project selector, title, description, source URL, and agent type configuration
- **Start/Stop controls** — start the engine to process the backlog, or start a specific job immediately
- **Manual status override** — force-transition stuck jobs to any other status
- **Session navigation** — click session links to jump to the terminal view for that session

### API

Orchestration exposes REST endpoints for programmatic access:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/orchestration/jobs` | List all jobs (filter by `project_id`) |
| `GET` | `/api/orchestration/jobs/:id` | Single job with linked sessions |
| `GET` | `/api/orchestration/jobs/:id/events` | Job event log (supports `?after_id=N` for incremental polling) |
| `POST` | `/api/orchestration/jobs` | Create a job |
| `PATCH` | `/api/orchestration/jobs/:id` | Update job fields or status |
| `DELETE` | `/api/orchestration/jobs/:id` | Remove a job (blocked while active) |
| `GET` | `/api/orchestration/status` | Engine state (running/stopped, current job) |
| `POST` | `/api/orchestration/start` | Start the engine |
| `POST` | `/api/orchestration/stop` | Stop the engine |
| `POST` | `/api/orchestration/jobs/:id/start` | Start a specific job immediately |

---

## License

Private — not yet published.
