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

### 💻 Session Types
- **Terminal** — plain shell session
- **Claude Code** — launches `claude --dangerously-skip-permissions`
- **Pi** — launches the `pi` coding agent
- **Codex** — launches `codex`

Each session runs inside a detached **tmux** session, so they survive page reloads, reconnects, and server restarts.

### 🔌 Live Terminal
- Full terminal emulation in the browser via [xterm.js](https://xtermjs.org/)
- WebSocket connection streams I/O between the browser and tmux (via `node-pty`)
- Resize support — terminal dimensions sync automatically
- Sessions that exit from inside (e.g. `exit`, `Ctrl+D`) are detected and archived

### 🤖 Auto-Rename
Sessions start with a generic name like *"Claude Code 1"*. Once meaningful activity is detected in the terminal, Devbench uses **Claude Haiku** to generate a short, descriptive kebab-case name based on the terminal content — so your sidebar stays readable even with many sessions.

### 🔗 MR/PR Link Detection
Terminal output is periodically scanned for merge request and pull request URLs from:
- **GitLab** — `/-/merge_requests/<id>` and `/merge_requests/new`
- **GitHub** — `/pull/<id>` and `/pull/new/`
- **Bitbucket** — `/pull-requests/<id>`

Detected links appear as badges on sessions in the sidebar and can be opened directly.

### 🌐 Browser Pane
- Side-by-side browser panel for previewing your web app alongside the terminal
- **Electron mode**: native `WebContentsView` with a real browser toolbar, tab bar (project URL + MR tabs), and URL navigation
- **Web mode**: inline `<iframe>` with address bar, back/forward, reload, and a draggable split resizer

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+J` | Next session |
| `Ctrl+Shift+K` | Previous session |
| `Ctrl+Shift+N` | New session |
| `Ctrl+Shift+R` | Rename session |
| `Ctrl+Shift+X` | Kill session |
| `Ctrl+Shift+B` | Toggle browser pane |
| `Ctrl+Shift+?` | Show shortcuts help |

### 🛡️ Health & Cleanup
- On startup, stale sessions (tmux died while server was down) are auto-archived
- A periodic health check (every 10s) archives any sessions whose tmux process has disappeared
- Auto-rename and MR monitoring are restarted for surviving sessions on server boot

---

## Architecture

```
devbench/
├── shared/          # TypeScript types shared between client & server
├── server/          # Node.js backend (HTTP + WebSocket)
│   ├── index.ts     # HTTP API, WebSocket upgrade, startup routines
│   ├── db.ts        # SQLite database (better-sqlite3)
│   ├── terminal.ts  # tmux + node-pty session management
│   ├── auto-rename.ts   # LLM-powered session naming
│   └── mr-links.ts      # MR/PR URL extraction from terminal output
├── client/          # React + Vite frontend
│   └── src/
│       ├── App.tsx          # Main app shell
│       ├── api.ts           # REST API client
│       └── components/      # Sidebar, TerminalPane, BrowserPane, popups
├── electron/        # Optional Electron desktop wrapper
│   ├── main.ts      # Electron main process (BrowserView, IPC)
│   └── preload.ts   # Context bridge for renderer
└── package.json     # Workspace root
```

**Tech stack**: Node.js · TypeScript (native `--experimental-strip-types`) · React 18 · Vite · xterm.js · WebSocket (ws) · better-sqlite3 · node-pty · tmux · Electron (optional)

---

## Prerequisites

- **Node.js** ≥ 22.6 (for native TypeScript stripping)
- **tmux** installed and on `PATH`
- **claude** CLI on `PATH` (for Claude Code sessions and auto-rename)
- **pi** CLI on `PATH` (for Pi sessions, optional)
- **codex** CLI on `PATH` (for Codex sessions, optional)

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
2. **Create a session** — Expand a project and click the `+` icon, or press `Ctrl+Shift+N`. Pick Terminal, Claude Code, Pi, or Codex.
3. **Switch sessions** — Click in the sidebar or use `Ctrl+Shift+J` / `Ctrl+Shift+K`.
4. **Browser pane** — If a project has a browser URL configured, press `Ctrl+Shift+B` to open a side-by-side browser.
5. **MR links** — When a `git push` prints a merge request URL, it appears as a clickable badge on the session.

---

## License

Private — not yet published.
