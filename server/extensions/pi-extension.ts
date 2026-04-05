// devbench-extension v1
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

  /** Extract MR/PR URLs from text. */
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
    return [...urls];
  }

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

    // Scan bash output for MR/PR URLs
    if (event.toolName === "bash" && !event.isError && event.result) {
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
