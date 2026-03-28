# Devbench

A session-aware developer workbench — a single browser tab that replaces scattered terminal tabs, IDE windows, and browser contexts for agentic coding workflows.

## What it does

- Sidebar with projects (add by directory path)
- Sessions per project: regular terminal or Claude Code instance
- Sessions persist across page reloads (SQLite on the server)
- Claude Code launched with `--dangerously-skip-permissions` for unattended operation

## Stack

- **Frontend:** React + Vite + Tailwind
- **Backend:** Bun HTTP + WebSocket server
- **Terminal:** xterm.js + node-pty
- **Database:** SQLite (better-sqlite3)

## Getting started

```bash
bun install
bun run dev
```

Open http://localhost:3000
