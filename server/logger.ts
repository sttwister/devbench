/**
 * File-based logger for devbench.
 *
 * Writes structured log lines to rotating daily log files.
 * Log files live next to the database (project root) in a `logs/` directory.
 *
 * Usage:
 *   import { logger } from "./logger.ts";
 *   logger.info("server", "Started on port 3001");
 *   logger.error("router", "Unhandled error", { method: "GET", path: "/api/foo" });
 *   logger.httpRequest(req, res, durationMs);
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, "..", "logs");

// Ensure logs directory exists
fs.mkdirSync(LOGS_DIR, { recursive: true });

type LogLevel = "info" | "warn" | "error" | "debug";

/** Get today's date as YYYY-MM-DD for log file naming. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Format a timestamp for log lines: ISO 8601. */
function timestamp(): string {
  return new Date().toISOString();
}

/** Map of open write streams, keyed by file base name. */
const streams = new Map<string, { stream: fs.WriteStream; date: string }>();

/**
 * Get or create a write stream for a given log category.
 * Rotates to a new file when the date changes.
 */
function getStream(category: string): fs.WriteStream {
  const d = today();
  const existing = streams.get(category);
  if (existing && existing.date === d) return existing.stream;

  // Close old stream if date changed
  if (existing) {
    existing.stream.end();
  }

  const filePath = path.join(LOGS_DIR, `${category}-${d}.log`);
  const stream = fs.createWriteStream(filePath, { flags: "a" });
  streams.set(category, { stream, date: d });
  return stream;
}

/** Write a single log line to the given category file. */
function writeLine(category: string, line: string): void {
  const stream = getStream(category);
  stream.write(line + "\n");
}

/**
 * Format extra data for log lines.
 * Produces a compact single-line JSON string, or empty string if no data.
 */
function formatExtra(extra?: Record<string, unknown>): string {
  if (!extra || Object.keys(extra).length === 0) return "";
  return " " + JSON.stringify(extra);
}

// ── Public API ──────────────────────────────────────────────────────

export const logger = {
  /**
   * Log an informational message.
   */
  info(tag: string, message: string, extra?: Record<string, unknown>): void {
    writeLine("app", `${timestamp()} INFO  [${tag}] ${message}${formatExtra(extra)}`);
  },

  /**
   * Log a warning.
   */
  warn(tag: string, message: string, extra?: Record<string, unknown>): void {
    writeLine("app", `${timestamp()} WARN  [${tag}] ${message}${formatExtra(extra)}`);
  },

  /**
   * Log an error.
   */
  error(tag: string, message: string, extra?: Record<string, unknown>): void {
    writeLine("app", `${timestamp()} ERROR [${tag}] ${message}${formatExtra(extra)}`);
  },

  /**
   * Log a debug-level message.
   */
  debug(tag: string, message: string, extra?: Record<string, unknown>): void {
    writeLine("app", `${timestamp()} DEBUG [${tag}] ${message}${formatExtra(extra)}`);
  },

  /**
   * Log an HTTP request/response to the dedicated http log file.
   * Called after the response is sent so we have status and duration.
   */
  http(fields: {
    method: string;
    url: string;
    status: number;
    durationMs: number;
    remoteAddr?: string;
    contentLength?: number;
  }): void {
    const { method, url, status, durationMs, remoteAddr, contentLength } = fields;
    const cl = contentLength !== undefined ? ` ${contentLength}b` : "";
    writeLine(
      "http",
      `${timestamp()} ${method} ${url} ${status} ${durationMs.toFixed(1)}ms${cl}${remoteAddr ? " " + remoteAddr : ""}`
    );
  },

  /**
   * Close all open log streams (for graceful shutdown).
   */
  close(): void {
    for (const [, { stream }] of streams) {
      stream.end();
    }
    streams.clear();
  },
};
