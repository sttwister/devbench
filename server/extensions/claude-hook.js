#!/usr/bin/env node
// devbench-hook v1
//
// Claude Code hook that pushes events to the devbench server.
// Installed globally at ~/.claude/hooks/devbench-hook.js
// Configured in ~/.claude/settings.json under hooks.
//
// Environment variables (set by devbench via tmux set-environment):
//   DEVBENCH_PORT       — devbench server port (default 3001)
//   DEVBENCH_SESSION_ID — devbench session ID (numeric)

const http = require("http");

const event = process.argv[2]; // UserPromptSubmit | Stop | PostToolUse
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

    case "PostToolUse":
      // Track file writes/edits
      if (data.tool_name === "Write" || data.tool_name === "Edit") {
        post("/api/hooks/changes", { sessionId: sid });
      }
      // Scan bash output for MR/PR URLs
      if (data.tool_name === "Bash" && data.tool_result) {
        const urls = extractMrUrls(
          typeof data.tool_result === "string" ? data.tool_result : JSON.stringify(data.tool_result)
        );
        for (const url of urls) {
          post("/api/hooks/mr", { sessionId: sid, url });
        }
      }
      break;
  }
});
