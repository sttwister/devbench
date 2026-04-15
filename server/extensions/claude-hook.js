#!/usr/bin/env node
// devbench-hook v9
//
// Claude Code hook that pushes events to the devbench server.
// Installed globally at ~/.claude/hooks/devbench-hook.js
// Configured in ~/.claude/settings.json under hooks.
//
// Environment variables (set by devbench via tmux set-environment):
//   DEVBENCH_PORT       — devbench server port (default 3001)
//   DEVBENCH_SESSION_ID — devbench session ID (numeric)

const http = require("http");
const fs = require("fs");

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
 * Extract MR/PR URLs from text.
 *
 * Matches direct URLs (GitLab merge_requests, GitHub pull) AND reconstructs
 * URLs from GitButler's structured JSON output (`but pr new --json`,
 * `but branch show --review --json`) where the URL is split across two
 * fields (`repositoryHttpsUrl` + `number`) and therefore never contains a
 * literal `.../pull/N` substring.
 *
 * Keep in sync with `server/mr-links.ts#extractMrUrls` and
 * `server/extensions/pi-extension.ts#extractMrUrls` — all three duplicate
 * the same logic because this file ships as a self-contained script copied
 * to `~/.claude/hooks/` at install time.
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
  // GitButler JSON fallback: `"repositoryHttpsUrl":"..."` + `"number":N` pair.
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
    // Unknown forge — skip to avoid poisoning the session's MR list.
  }
  return [...urls];
}

/**
 * Scan the conversation transcript for MR/PR URLs in the last assistant
 * message. This catches URLs that the agent mentions in its text output
 * but that never appeared in a Bash tool_response — e.g. when
 * `but pr new --json | tail` truncates the JSON, or the agent
 * summarises MR links from `glab mr list` shorthand.
 */
function scanTranscriptForMrUrls(transcriptPath) {
  if (!transcriptPath) return;
  try {
    const raw = fs.readFileSync(transcriptPath, "utf8");
    // Only look at the tail — the last assistant message is near the end
    const lines = raw.trimEnd().split("\n");
    const tail = lines.slice(-30);
    for (const line of tail) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "assistant") continue;
        const content = entry.message?.content;
        if (!content) continue;
        // content can be a string or array of {type,text} blocks
        const texts = typeof content === "string"
          ? [content]
          : Array.isArray(content)
            ? content.filter((c) => c.type === "text").map((c) => c.text)
            : [];
        const combined = texts.join("\n");
        const urls = extractMrUrls(combined);
        for (const url of urls) {
          post("/api/hooks/mr", { sessionId: sid, url });
        }
      } catch { /* skip unparseable lines */ }
    }
  } catch { /* transcript not readable — best effort */ }
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
      scanTranscriptForMrUrls(data.transcript_path);
      break;

    case "Notification":
      // Fires when Claude Code needs user input — permission prompts,
      // plan-mode approval (ExitPlanMode), idle-timeout. In all these
      // cases the agent is blocked waiting for the user, so flip the
      // status indicator to "waiting".
      // Also scan transcript: when the agent finishes a task and is
      // waiting for input, it may have mentioned MR URLs in its text
      // that never appeared in a Bash tool_response. This catches
      // them immediately instead of waiting for Stop (which may
      // never fire for long-running orchestrator sessions).
      post("/api/hooks/idle", { sessionId: sid });
      scanTranscriptForMrUrls(data.transcript_path);
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
          : [response?.stdout, response?.stderr].filter(Boolean).join("\n") || "";
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
