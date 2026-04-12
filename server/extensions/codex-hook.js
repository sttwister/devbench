#!/usr/bin/env node
// @lat: [[hooks#Codex Hook]]
// devbench-hook v1
//
// Codex hook bridge that forwards structured lifecycle events to devbench.
// Installed globally at ~/.codex/hooks/devbench-hook.js and referenced from
// ~/.codex/hooks.json.
//
// Environment variables (set by devbench via tmux set-environment):
//   DEVBENCH_PORT       — devbench server port (default 3001)
//   DEVBENCH_SESSION_ID — devbench session ID (numeric)

const http = require("http");

const event = process.argv[2]; // SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | Stop
const port = process.env.DEVBENCH_PORT;
const sessionId = process.env.DEVBENCH_SESSION_ID;

if (!port || !sessionId) process.exit(0);

const sid = parseInt(sessionId, 10);
if (isNaN(sid)) process.exit(0);

/** Fire-and-forget POST to devbench API. Does not block Codex. */
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
    () => {}
  );
  req.on("error", () => {});
  req.end(data);
}

/**
 * Extract MR/PR URLs from text.
 *
 * Matches direct URLs (GitLab merge_requests, GitHub pull) AND reconstructs
 * URLs from GitButler's structured JSON output (`but pr new --json`,
 * `but branch show --review --json`) where the URL is split across two
 * fields (`repositoryHttpsUrl` + `number`) and therefore never contains a
 * literal `.../pull/N` substring.
 *
 * Keep in sync with `server/mr-links.ts#extractMrUrls`,
 * `server/extensions/claude-hook.js#extractMrUrls`, and
 * `server/extensions/pi-extension.ts#extractMrUrls`.
 */
function extractMrUrls(text) {
  if (!text) return [];
  const urls = new Set();
  const patterns = [
    /https?:\/\/[^\s"'<>),;\]\`]+\/-\/merge_requests\/\d+/g,
    /https?:\/\/[^\s"'<>),;\]\`]+\/pull\/\d+/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      urls.add(match[0]);
    }
  }
  const jsonPairRe =
    /"repositoryHttpsUrl"\s*:\s*"([^"]+)"[\s\S]{0,10000}?"number"\s*:\s*(\d+)|"number"\s*:\s*(\d+)[\s\S]{0,10000}?"repositoryHttpsUrl"\s*:\s*"([^"]+)"/g;
  for (const m of text.matchAll(jsonPairRe)) {
    const rawRepo = m[1] || m[4];
    const number = m[2] || m[3];
    if (!rawRepo || !number) continue;
    const repo = rawRepo.replace(/\.git$/, "");
    if (/github\.com/i.test(repo)) {
      urls.add(`${repo}/pull/${number}`);
    } else if (/gitlab/i.test(repo)) {
      urls.add(`${repo}/-/merge_requests/${number}`);
    }
  }
  return [...urls];
}

function getBashOutputText(toolResponse) {
  if (toolResponse == null) return "";
  if (typeof toolResponse === "string") {
    try {
      return getBashOutputText(JSON.parse(toolResponse));
    } catch {
      return toolResponse;
    }
  }
  if (typeof toolResponse === "object") {
    const stdout = typeof toolResponse.stdout === "string" ? toolResponse.stdout : "";
    const stderr = typeof toolResponse.stderr === "string" ? toolResponse.stderr : "";
    const combined = [stdout, stderr].filter(Boolean).join("\n");
    return combined || JSON.stringify(toolResponse);
  }
  return String(toolResponse);
}

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
    case "SessionStart":
      if (typeof data.session_id === "string" && data.session_id) {
        post("/api/hooks/session-start", {
          sessionId: sid,
          agentSessionId: data.session_id,
        });
      }
      break;

    case "UserPromptSubmit":
      if (typeof data.prompt === "string" && data.prompt.trim()) {
        post("/api/hooks/prompt", { sessionId: sid, prompt: data.prompt });
      }
      break;

    case "PreToolUse":
      post("/api/hooks/working", { sessionId: sid });
      break;

    case "PostToolUse": {
      const command = data.tool_input?.command || "";
      if (/\b(git|but)\s+push\b/.test(command)) {
        post("/api/hooks/committed", { sessionId: sid });
      }
      const text = getBashOutputText(data.tool_response);
      if (text) {
        const urls = extractMrUrls(text);
        for (const url of urls) {
          post("/api/hooks/mr", { sessionId: sid, url });
        }
      }
      break;
    }

    case "Stop":
      post("/api/hooks/idle", { sessionId: sid });
      break;
  }
});
