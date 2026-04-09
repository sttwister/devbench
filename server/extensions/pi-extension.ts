// devbench-extension v4
//
// Pi extension that pushes events to the devbench server.
// Installed globally at ~/.pi/agent/extensions/devbench.ts
//
// Environment variables (set by devbench via tmux set-environment):
//   DEVBENCH_PORT       — devbench server port (default 3001)
//   DEVBENCH_SESSION_ID — devbench session ID (numeric)

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const port = process.env.DEVBENCH_PORT;
  const sessionId = process.env.DEVBENCH_SESSION_ID;

  // Not running inside devbench — skip all hooks
  if (!port || !sessionId) {
    console.error("[devbench-ext] No DEVBENCH_PORT/DEVBENCH_SESSION_ID — hooks disabled");
    return;
  }

  const sid = parseInt(sessionId, 10);
  if (isNaN(sid)) return;

  console.error(`[devbench-ext] Active: port=${port} sessionId=${sid}`);

  /** Fire-and-forget POST to devbench API. */
  function post(path: string, body: object): void {
    const http = require("http") as typeof import("http");
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: parseInt(port!, 10),
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
   * `server/extensions/claude-hook.js#extractMrUrls` — all three duplicate
   * the same logic because this file ships as a self-contained script copied
   * to `~/.pi/agent/extensions/` at install time.
   */
  function extractMrUrls(text: string): string[] {
    if (!text) return [];
    const urls = new Set<string>();
    const patterns = [
      /https?:\/\/[^\s"'<>),;\]\`]+\/-\/merge_requests\/\d+/g,
      /https?:\/\/[^\s"'<>),;\]\`]+\/pull\/\d+/g,
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

  // Track bash commands to detect git push in tool_execution_end
  const bashCommands = new Map<string, string>();

  pi.on("tool_call", async (event) => {
    // Recovery signal: any tool invocation means the agent is actively
    // working. This is the Pi analogue of Claude Code's `PreToolUse` hook.
    // Critical after a devbench server restart — `resumeSessionMonitors`
    // starts agent-status in "waiting" (to avoid spurious notifications),
    // and Pi's `input` event only fires on fresh user prompts, so without
    // this the indicator would stay stuck on "waiting" until the current
    // turn finished. See [[monitoring#Agent Status]].
    post("/api/hooks/working", { sessionId: sid });

    if (event.toolName === "bash" && "command" in event.input) {
      bashCommands.set(event.toolCallId, event.input.command as string);
    }
  });

  // User submitted a prompt → agent is working
  pi.on("input", async (event) => {
    if (typeof event.text === "string" && event.text.trim()) {
      post("/api/hooks/prompt", { sessionId: sid, prompt: event.text });
    }
  });

  // Agent finished processing → idle / waiting for input
  pi.on("agent_end", async () => {
    post("/api/hooks/idle", { sessionId: sid });
  });

  // Track file writes and MR URLs from tool results
  pi.on("tool_execution_end", async (event) => {
    // Track file changes (write/edit tools)
    if ((event.toolName === "write" || event.toolName === "edit") && !event.isError) {
      post("/api/hooks/changes", { sessionId: sid });
    }

    // Scan bash output for MR/PR URLs and detect git push
    if (event.toolName === "bash" && !event.isError && event.result) {
      // Detect git push in the command — clears uncommitted changes flag
      const command = bashCommands.get(event.toolCallId) || "";
      bashCommands.delete(event.toolCallId);
      if (/\b(git|but)\s+push\b/.test(command)) {
        post("/api/hooks/committed", { sessionId: sid });
      }
      const text =
        typeof event.result === "string"
          ? event.result
          : Array.isArray(event.result.content)
            ? event.result.content
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n")
            : "";
      const urls = extractMrUrls(text);
      for (const url of urls) {
        post("/api/hooks/mr", { sessionId: sid, url });
      }
    }
  });
}
