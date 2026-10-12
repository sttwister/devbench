import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "http";
import { spawn } from "child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Codex hook bridge", () => {
  let server: Server;
  let dir: string;
  let port: number;
  let events: { path: string; body: any }[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "devbench-codex-hook-"));
    // Installed scripts run outside the repository's ESM package scope.
    copyFileSync(new URL("../extensions/codex-hook.js", import.meta.url), join(dir, "hook.cjs"));
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => body += chunk);
      req.on("end", () => {
        events.push({ path: req.url!, body: JSON.parse(body) });
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  async function run(event: string, data: any, enabled = true) {
    events = [];
    const child = spawn(process.execPath, [join(dir, "hook.cjs"), event], {
      env: { ...process.env, DEVBENCH_PORT: String(port), DEVBENCH_SESSION_ID: enabled ? "42" : "" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stdin.end(typeof data === "string" ? data : JSON.stringify(data));
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(""); // Never alter hook decisions or inject model context.
    return events;
  }

  it("forwards prompts and session IDs, including clear and compact starts", async () => {
    expect(await run("UserPromptSubmit", { prompt: "Fix session naming" })).toEqual([
      { path: "/api/hooks/prompt", body: { sessionId: 42, prompt: "Fix session naming" } },
    ]);
    for (const source of ["startup", "resume", "clear", "compact"]) {
      expect(await run("SessionStart", { source, session_id: "thread-123" })).toEqual([
        { path: "/api/hooks/session-start", body: { sessionId: 42, agentSessionId: "thread-123" } },
      ]);
    }
  });

  it("reports working for non-shell tools and waiting for approvals and blocking questions", async () => {
    expect((await run("PreToolUse", { tool_name: "apply_patch" }))[0].path).toBe("/api/hooks/working");
    expect((await run("PreToolUse", { tool_name: "request_user_input" }))[0].path).toBe("/api/hooks/idle");
    expect((await run("PreToolUse", { tool_name: "request_user_input_async" }))[0].path).toBe("/api/hooks/working");
    expect((await run("PermissionRequest", { tool_name: "Bash" }))[0].path).toBe("/api/hooks/idle");
    expect((await run("PostToolUse", { tool_name: "Bash", tool_response: "done" }))[0].path).toBe("/api/hooks/working");
    for (const event of ["Stop", "Interrupt", "SessionEnd"]) {
      expect((await run(event, {}))[0].path).toBe("/api/hooks/idle");
    }
  });

  it("reports scoped add, update, delete and rename paths only after a successful patch", async () => {
    const data = {
      tool_name: "apply_patch", cwd: "/project",
      tool_input: { command: "*** Begin Patch\n*** Add File: a.ts\n*** Update File: b.ts\n*** Move to: c.ts\n*** Delete File: d.ts\n*** End Patch" },
      tool_response: "Success. Updated the following files:\nA a.ts\nM c.ts\nD d.ts",
    };
    const changes = (await run("PostToolUse", data)).filter((e) => e.path === "/api/hooks/changes");
    expect(changes.map((e) => e.body)).toEqual(["a.ts", "b.ts", "c.ts", "d.ts"].map((filePath) => ({ sessionId: 42, filePath, cwd: "/project" })));
    expect((await run("PostToolUse", { ...data, tool_response: "Failed to apply patch" })).map((e) => e.path)).toEqual(["/api/hooks/working"]);
  });

  it("clears changes only for completed successful pushes", async () => {
    const data = { tool_name: "Bash", tool_input: { command: "but push" } };
    for (const tool_response of [{ exit_code: 0, output: "pushed" }, "Process exited with code 0\nOutput: pushed"]) {
      expect((await run("PostToolUse", { ...data, tool_response })).map((e) => e.path)).toContain("/api/hooks/committed");
    }
    for (const tool_response of [{ exit_code: 1 }, { session_id: 12, output: "running" }, "Process exited with code 1"]) {
      expect((await run("PostToolUse", { ...data, tool_response })).map((e) => e.path)).not.toContain("/api/hooks/committed");
    }
  });

  it("finds PR links in MCP output, final replies and assistant transcript records", async () => {
    const url = "https://github.com/org/repo/pull/123";
    expect((await run("PostToolUse", { tool_name: "mcp__github__create_pr", tool_response: { content: [{ type: "text", text: url }] } })).find((e) => e.path === "/api/hooks/mr")?.body.url).toBe(url);
    expect((await run("Stop", { last_assistant_message: `Created ${url}` })).find((e) => e.path === "/api/hooks/mr")?.body.url).toBe(url);
    const path = join(dir, "transcript.jsonl");
    writeFileSync(path, [
      { type: "response_item", payload: { type: "message", role: "user", content: [{ text: "https://github.com/org/repo/pull/999" }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: url }] } },
    ].map((entry) => JSON.stringify(entry)).join("\n"));
    expect((await run("Stop", { transcript_path: path })).filter((e) => e.path === "/api/hooks/mr").map((e) => e.body.url)).toEqual([url]);
  });

  it("ignores invalid input and sessions outside Devbench", async () => {
    expect(await run("Stop", "invalid")).toEqual([]);
    expect(await run("Stop", null)).toEqual([]);
    expect(await run("UserPromptSubmit", { prompt: "   " })).toEqual([]);
    expect(await run("Stop", {}, false)).toEqual([]);
  });
});
