#!/usr/bin/env node
// devbench-hook v5
//
// Claude Code hook that pushes events to the devbench server.
// Installed globally at ~/.claude/hooks/devbench-hook.js
// Configured in ~/.claude/settings.json under hooks.
//
// Environment variables (set by devbench via tmux set-environment):
//   DEVBENCH_PORT       — devbench server port (default 3001)
//   DEVBENCH_SESSION_ID — devbench session ID (numeric)

const http = require("http");

const event = process.argv[2]; // UserPromptSubmit | Stop | Notification | PreToolUse | PostToolUse
const port = process.env.DEVBENCH_PORT;
const sessionId = process.env.DEVBENCH_SESSION_ID;

// Not running inside devbench — exit silently
if (!port || !sessionId) process.exit(0);

const sid = parseInt(sessionId, 10);
if (isNaN(sid)) process.exit(0);

/** Fire-and-forget POST to devbench API. Does not block the agent. */
function post(path, body) {
  const data = JSON.stringify(body);
  const req = http.request(
    {
      hostname: "127.0.0.1",
      port: parseInt(port, 10),
      path,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 3000,
    },
    () => {} // ignore response
  );
  req.on("error", () => {}); // ignore errors
  req.end(data);
}

/**
 * Extract MR/PR URLs from text (matches GitLab merge_requests and GitHub pull URLs).
 */
function extractMrUrls(text) {
  if (!text) return [];
  const urls = new Set();
  const patterns = [
    /https?:\/\/[^\s"'<>),;\]\`]+\/-\/merge_requests\/\d+/g, // GitLab
    /https?:\/\/[^\s"'<>),;\]\`]+\/pull\/\d+/g, // GitHub
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      urls.add(match[0]);
    }
  }
  return [...urls];
}

// Read JSON from stdin
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  switch (event) {
    case "UserPromptSubmit":
      if (data.prompt) {
        post("/api/hooks/prompt", { sessionId: sid, prompt: data.prompt });
      }
      break;

    case "Stop":
      post("/api/hooks/idle", { sessionId: sid });
      break;

    case "Notification":
      // Fires when Claude Code needs user input — permission prompts,
      // plan-mode approval (ExitPlanMode), idle-timeout. In all these
      // cases the agent is blocked waiting for the user, so flip the
      // status indicator to "waiting".
      post("/api/hooks/idle", { sessionId: sid });
      break;

    case "PreToolUse":
      // Fires before every tool invocation. Any tool call is proof the
      // agent is actively working, so use this as a recovery signal to
      // transition out of "waiting". Critical for plan-mode refinement:
      // when the user types a refinement, Claude Code routes it into the
      // ExitPlanMode tool without firing UserPromptSubmit, so this is the
      // only reliable way to detect the resumed work.
      post("/api/hooks/working", { sessionId: sid });
      break;

    case "PostToolUse":
      // Track file writes/edits. Covers Write, Edit, MultiEdit, NotebookEdit.
      // We forward the resolved file path and cwd so the server can scope the
      // has_changes flag to files inside the project — plan mode writes the
      // plan to ~/.claude/plans/ by default, which must NOT trigger the
      // unsaved-changes indicator.
      if (
        data.tool_name === "Write" ||
        data.tool_name === "Edit" ||
        data.tool_name === "MultiEdit" ||
        data.tool_name === "NotebookEdit"
      ) {
        const filePath =
          (data.tool_response && typeof data.tool_response === "object"
            ? data.tool_response.filePath
            : null) ||
          (data.tool_input && typeof data.tool_input === "object"
            ? data.tool_input.file_path || data.tool_input.filePath
            : null);
        // Only post when we actually have a resolved file path — absence
        // indicates an error/blocked/permission-denied response shape.
        if (typeof filePath === "string" && filePath) {
          post("/api/hooks/changes", {
            sessionId: sid,
            filePath,
            cwd: typeof data.cwd === "string" ? data.cwd : undefined,
          });
        }
      }
      // Scan bash output for MR/PR URLs and detect git push
      if (data.tool_name === "Bash") {
        // Detect git push in the command — clears uncommitted changes flag
        const command = data.tool_input?.command || "";
        if (/\b(git|but)\s+push\b/.test(command)) {
          post("/api/hooks/committed", { sessionId: sid });
        }
        // Claude Code sends { tool_response: { stdout, stderr, ... } }
        const response = data.tool_response;
        const text = typeof response === "string" ? response
          : response?.stdout || "";
        if (text) {
          const urls = extractMrUrls(text);
          for (const url of urls) {
            post("/api/hooks/mr", { sessionId: sid, url });
          }
        }
      }
      break;
  }
});
