import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pty = require("node-pty");

export interface PtyEntry {
  pty: any;
  clients: Set<any>;
  dataHandler: any;
  exitHandler: any;
}

const ptyMap = new Map<number, PtyEntry>();

export function spawnPty(sessionId: number, type: "terminal" | "claude", cwd: string): PtyEntry {
  const existing = ptyMap.get(sessionId);
  if (existing) return existing;

  const shell = type === "terminal" ? "bash" : "claude";
  const args = type === "claude" ? ["--dangerously-skip-permissions"] : [];

  const ptyProcess = pty.spawn(shell, args, {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd,
    env: { ...process.env },
  });

  const clients = new Set<any>();

  const dataHandler = (data: string) => {
    const buf = Buffer.from(data, "utf-8");
    for (const client of clients) {
      try {
        client.sendBinary(buf);
      } catch (e) {
        // client disconnected
      }
    }
  };

  const exitHandler = ({ exitCode }: { exitCode: number }) => {
    // Notify clients pty exited
    const msg = `\r\n\x1b[31m[Process exited with code ${exitCode}]\x1b[0m\r\n`;
    const buf = Buffer.from(msg, "utf-8");
    for (const client of clients) {
      try {
        client.sendBinary(buf);
      } catch (e) {}
    }
    ptyMap.delete(sessionId);
  };

  ptyProcess.onData(dataHandler);
  ptyProcess.onExit(exitHandler);

  const entry: PtyEntry = { pty: ptyProcess, clients, dataHandler, exitHandler };
  ptyMap.set(sessionId, entry);
  return entry;
}

export function getPty(sessionId: number): PtyEntry | undefined {
  return ptyMap.get(sessionId);
}

export function killPty(sessionId: number): void {
  const entry = ptyMap.get(sessionId);
  if (entry) {
    try {
      entry.pty.kill();
    } catch (e) {}
    ptyMap.delete(sessionId);
  }
}

export function attachClient(sessionId: number, ws: any): void {
  const entry = ptyMap.get(sessionId);
  if (entry) {
    entry.clients.add(ws);
  }
}

export function detachClient(sessionId: number, ws: any): void {
  const entry = ptyMap.get(sessionId);
  if (entry) {
    entry.clients.delete(ws);
  }
}
