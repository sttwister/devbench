// @lat: [[integrations#Slack API]]
/**
 * Slack API integration.
 *
 * Fetches message details (text, user, files, thread) from
 * the Slack Web API.  Downloads image and video attachments to local tmp files.
 */

import * as db from "./db.ts";
import { slugifySessionName } from "./session-naming.ts";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

const SLACK_API_URL = "https://slack.com/api";
const IMAGE_UPLOAD_DIR = join(tmpdir(), "devbench-uploads");

// ── Types ───────────────────────────────────────────────────────────

export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  url_private: string;
}

export interface SlackMessage {
  ts: string;
  user?: string;
  text: string;
  files?: SlackFile[];
  thread_ts?: string;
  reply_count?: number;
}

export interface SlackParsedUrl {
  channelId: string;
  messageTs: string;
  threadTs?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function getToken(): string | null {
  return db.getSetting("slack_token");
}

async function slackApi<T>(method: string, params: Record<string, string> = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("Slack API token not configured");

  const url = new URL(`${SLACK_API_URL}/${method}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Slack API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as any;
  if (!json.ok) {
    throw new Error(`Slack API error: ${json.error || "unknown error"}`);
  }

  return json as T;
}

// ── Parse message URL ───────────────────────────────────────────────

/**
 * Parse a Slack message URL to extract channel ID, message timestamp,
 * and optional thread timestamp.
 *
 * Supports:
 *   https://myteam.slack.com/archives/C01234ABC/p1234567890123456
 *   https://myteam.slack.com/archives/C01234ABC/p1234567890123456?thread_ts=1234567890.123456&cid=C01234ABC
 *
 * The `p<digits>` encodes the timestamp: remove the `p` prefix and
 * insert a dot before the last 6 digits → "1234567890.123456".
 */
export function parseSlackUrl(url: string): SlackParsedUrl | null {
  const match = url.match(/slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)/);
  if (!match) return null;

  const channelId = match[1];
  const rawTs = match[2];
  // Insert dot before last 6 digits: "1234567890123456" → "1234567890.123456"
  const messageTs = rawTs.length > 6
    ? rawTs.slice(0, rawTs.length - 6) + "." + rawTs.slice(rawTs.length - 6)
    : rawTs;

  // Check for thread_ts in query params
  let threadTs: string | undefined;
  try {
    const parsed = new URL(url);
    const tt = parsed.searchParams.get("thread_ts");
    if (tt) threadTs = tt;
  } catch {
    // Ignore URL parsing errors
  }

  return { channelId, messageTs, threadTs };
}

// ── Fetch message ───────────────────────────────────────────────────

/**
 * Fetch a single Slack message by channel and timestamp.
 * Uses conversations.history with inclusive=true and limit=1.
 */
export async function fetchMessage(
  channelId: string,
  ts: string,
): Promise<SlackMessage | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const data = await slackApi<{
      messages: Array<{
        ts: string;
        user?: string;
        text: string;
        files?: Array<{
          id: string;
          name: string;
          mimetype: string;
          url_private: string;
        }>;
        thread_ts?: string;
        reply_count?: number;
      }>;
    }>("conversations.history", {
      channel: channelId,
      latest: ts,
      inclusive: "true",
      limit: "1",
    });

    if (!data.messages || data.messages.length === 0) return null;

    const msg = data.messages[0];
    return {
      ts: msg.ts,
      user: msg.user,
      text: msg.text,
      files: msg.files?.filter((f) => f.url_private).map((f) => ({
        id: f.id,
        name: f.name,
        mimetype: f.mimetype,
        url_private: f.url_private,
      })),
      thread_ts: msg.thread_ts,
      reply_count: msg.reply_count,
    };
  } catch (e: any) {
    console.error(`[slack] Failed to fetch message ${channelId}/${ts}:`, e.message);
    return null;
  }
}

/**
 * Fetch a message from a Slack URL.
 * Returns null if the URL is not a valid Slack message URL or the token is not configured.
 */
export async function fetchMessageFromUrl(url: string): Promise<{
  message: SlackMessage;
  threadMessages?: SlackMessage[];
  parsed: SlackParsedUrl;
} | null> {
  const parsed = parseSlackUrl(url);
  if (!parsed) return null;

  const message = await fetchMessage(parsed.channelId, parsed.messageTs);
  if (!message) return null;

  // Determine if we should fetch the thread
  const threadTs = parsed.threadTs || message.thread_ts;
  let threadMessages: SlackMessage[] | undefined;

  if (threadTs) {
    threadMessages = await fetchThread(parsed.channelId, threadTs);
  } else if (message.reply_count && message.reply_count > 0) {
    // The message is a thread parent with replies
    threadMessages = await fetchThread(parsed.channelId, message.ts);
  }

  return { message, threadMessages, parsed };
}

// ── Fetch thread ────────────────────────────────────────────────────

/**
 * Fetch all messages in a Slack thread.
 * Uses conversations.replies to get the parent message and all replies.
 */
export async function fetchThread(
  channelId: string,
  threadTs: string,
): Promise<SlackMessage[]> {
  try {
    const data = await slackApi<{
      messages: Array<{
        ts: string;
        user?: string;
        text: string;
        files?: Array<{
          id: string;
          name: string;
          mimetype: string;
          url_private: string;
        }>;
        thread_ts?: string;
      }>;
    }>("conversations.replies", {
      channel: channelId,
      ts: threadTs,
    });

    if (!data.messages) return [];

    return data.messages.map((msg) => ({
      ts: msg.ts,
      user: msg.user,
      text: msg.text,
      files: msg.files?.filter((f) => f.url_private).map((f) => ({
        id: f.id,
        name: f.name,
        mimetype: f.mimetype,
        url_private: f.url_private,
      })),
      thread_ts: msg.thread_ts,
    }));
  } catch (e: any) {
    console.error(`[slack] Failed to fetch thread ${channelId}/${threadTs}:`, e.message);
    return [];
  }
}

// ── Image download ──────────────────────────────────────────────────

/**
 * Download a Slack file to a local tmp file.
 * Uses the same upload directory as the JIRA image and file-upload features.
 * Returns the local file path, or null on failure.
 */
async function downloadFile(fileUrl: string, filename: string): Promise<string | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error(`[slack] Failed to download file ${filename}: HTTP ${res.status}`);
      return null;
    }

    mkdirSync(IMAGE_UPLOAD_DIR, { recursive: true });

    const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
    const uniqueName = `slack-${Date.now()}-${randomBytes(4).toString("hex")}${ext}`;
    const filePath = join(IMAGE_UPLOAD_DIR, uniqueName);

    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(filePath, buffer);
    console.log(`[slack] Downloaded file ${filename} → ${filePath}`);
    return filePath;
  } catch (e: any) {
    console.error(`[slack] Failed to download file ${filename}:`, e.message);
    return null;
  }
}

/**
 * Download all image and video files from a list of Slack messages.
 * Returns a list of local file paths.
 */
export async function downloadMessageMedia(
  messages: SlackMessage[],
): Promise<string[]> {
  const mediaPaths: string[] = [];

  const allFiles = messages.flatMap((m) =>
    (m.files ?? []).filter(
      (f) => f.mimetype.startsWith("image/") || f.mimetype.startsWith("video/"),
    )
  );

  if (allFiles.length === 0) return mediaPaths;

  await Promise.all(
    allFiles.map(async (file) => {
      const localPath = await downloadFile(file.url_private, file.name);
      if (localPath) {
        mediaPaths.push(localPath);
      }
    }),
  );

  return mediaPaths;
}

// ── Prompt generation ───────────────────────────────────────────────

/**
 * Generate the prompt text to paste into an agent session from a Slack message.
 * Includes the message text, thread replies (if any), and media file paths
 * (images and videos).
 */
export function promptFromMessage(
  message: SlackMessage,
  sourceUrl: string,
  threadMessages?: SlackMessage[],
  mediaPaths?: string[],
): string {
  const parts: string[] = [];

  parts.push("Implement this Slack message:");
  parts.push("", message.text);

  // Add thread messages (skip the parent if it's duplicated)
  if (threadMessages && threadMessages.length > 1) {
    parts.push("", "--- Thread replies ---");
    for (const reply of threadMessages) {
      if (reply.ts === message.ts) continue; // skip parent
      parts.push("", reply.text);
    }
  }

  // Add media paths (images and videos)
  if (mediaPaths && mediaPaths.length > 0) {
    parts.push("", "Attached media:");
    for (const p of mediaPaths) {
      parts.push(p);
    }
  }

  parts.push("", `Reference: ${sourceUrl}`);
  return parts.join("\n");
}

// ── Session naming ──────────────────────────────────────────────────

/**
 * Generate a session name from a Slack message.
 * Uses the first portion of the message text as a kebab-case slug.
 */
export function sessionNameFromMessage(message: SlackMessage): string {
  return slugifySessionName(message.text) || "slack-message";
}

// ── Token validation ────────────────────────────────────────────────

/**
 * Validate a Slack API token by calling auth.test.
 */
export async function validateToken(
  token: string,
): Promise<{ valid: boolean; user?: string; error?: string }> {
  try {
    const res = await fetch(`${SLACK_API_URL}/auth.test`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    if (!res.ok) {
      return { valid: false, error: `HTTP ${res.status}` };
    }

    const json = (await res.json()) as any;
    if (!json.ok) {
      return { valid: false, error: json.error || "Unknown error" };
    }

    return { valid: true, user: json.user || json.team };
  } catch (e: any) {
    return { valid: false, error: e.message };
  }
}
