#!/usr/bin/env node
// devbench-hook v3
//
// Codex hook bridge that forwards structured lifecycle events to devbench.
// Installed globally at ~/.codex/hooks/devbench-hook.js and referenced from
// ~/.codex/hooks.json.
//
// Environment variables (set by devbench via tmux set-environment):
//   DEVBENCH_PORT       — devbench server port (default 3001)
//   DEVBENCH_SESSION_ID — devbench session ID (numeric)

const http = require("http");
const fs = require("fs");

const event = process.argv[2];
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
      timeout: 2000,
    },
    (res) => res.resume()
  );
  req.on("timeout", () => req.destroy());
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

/** Scan only assistant messages in the transcript tail (best effort, unstable format). */
function scanTranscript(path) {
  if (typeof path !== "string" || !path) return;
  let fd;
  try {
    fd = fs.openSync(path, "r");
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 128 * 1024);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start) lines.shift(); // Discard an incomplete first record.
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "response_item" && entry.payload?.type === "message" &&
            entry.payload.role === "assistant") {
          reportUrls(entry.payload.content?.map((block) => block.text || "").join("\n"));
        }
      } catch { /* skip incomplete records */ }
    }
  } catch { /* transcript is optional */ }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function reportUrls(text) {
  for (const url of extractMrUrls(text)) post("/api/hooks/mr", { sessionId: sid, url });
}

/** Hook responses vary between strings, unified exec results, and MCP results. */
function succeeded(response) {
  if (response == null) return false;
  if (typeof response === "string") {
    try { return succeeded(JSON.parse(response)); } catch {
      const exit = response.match(/(?:Process exited with code|Exit code:)\s*(-?\d+)/i);
      return exit ? Number(exit[1]) === 0 : /^Success\b/.test(response);
    }
  }
  return response.isError !== true && response.success !== false &&
    (response.exit_code === 0 || response.exitCode === 0 || response.success === true);
}

function reportPatchChanges(patch, response, cwd) {
  if (typeof patch !== "string" || !succeeded(response)) return;
  const paths = new Set();
  for (const match of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) {
    paths.add(match[1].trim());
  }
  for (const filePath of paths) post("/api/hooks/changes", { sessionId: sid, filePath, cwd });
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data;
  try { data = JSON.parse(input); } catch { return; }
  if (!data || typeof data !== "object") return;

  switch (event || data.hook_event_name) {
    case "SessionStart":
      if (typeof data.session_id === "string" && data.session_id) {
        post("/api/hooks/session-start", { sessionId: sid, agentSessionId: data.session_id });
      }
      break;

    case "UserPromptSubmit":
      if (typeof data.prompt === "string" && data.prompt.trim()) {
        post("/api/hooks/prompt", { sessionId: sid, prompt: data.prompt });
      }
      break;

    case "PreToolUse":
      // Questions block the agent just as permission requests do.
      post(data.tool_name === "request_user_input"
        ? "/api/hooks/idle" : "/api/hooks/working", { sessionId: sid });
      break;

    case "PermissionRequest":
      post("/api/hooks/idle", { sessionId: sid });
      break;

    case "PostToolUse": {
      // Approval happens after PreToolUse; recover working as soon as it completes.
      post("/api/hooks/working", { sessionId: sid });
      const command = data.tool_input?.command;
      if (data.tool_name === "Bash" && typeof command === "string" &&
          /\b(git|but)\s+push\b/.test(command) && succeeded(data.tool_response)) {
        post("/api/hooks/committed", { sessionId: sid });
      }
      if (data.tool_name === "apply_patch") {
        reportPatchChanges(command, data.tool_response, data.cwd);
      }
      reportUrls(getBashOutputText(data.tool_response));
      break;
    }

    case "Stop":
    case "Interrupt":
    case "SessionEnd":
      post("/api/hooks/idle", { sessionId: sid });
      if (typeof data.last_assistant_message === "string") reportUrls(data.last_assistant_message);
      scanTranscript(data.transcript_path);
      break;
  }
});
