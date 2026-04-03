// @lat: [[integrations#JIRA API]]
/**
 * JIRA API integration.
 *
 * Fetches issue details (title, description, key, status) from
 * the JIRA REST API.  Also supports transitioning issues through
 * workflow states (In Progress, Done).
 */

import * as db from "./db.ts";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

// ── Types ───────────────────────────────────────────────────────────

export interface JiraIssue {
  id: string;
  key: string;
  title: string;
  description: string | null;
  url: string;
  status: {
    id: string;
    name: string;
    categoryKey: string; // "new" | "indeterminate" | "done"
  };
  transitions: Array<{
    id: string;
    name: string;
    to: {
      id: string;
      name: string;
      categoryKey: string;
    };
  }>;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    content: string; // URL to download
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────

function getToken(): string | null {
  return db.getSetting("jira_token");
}

function getBaseUrl(): string | null {
  return db.getSetting("jira_base_url");
}

/**
 * Derive the JIRA base URL from an issue URL.
 * e.g. "https://mycompany.atlassian.net/browse/PROJ-123" → "https://mycompany.atlassian.net"
 */
function baseUrlFromIssueUrl(issueUrl: string): string | null {
  const match = issueUrl.match(/^(https?:\/\/[^/]+)/);
  return match ? match[1] : null;
}

async function jiraFetch<T>(baseUrl: string, path: string): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("JIRA API token not configured");

  // JIRA Cloud uses "Basic <base64(email:token)>" or "Bearer <PAT>"
  // We support both: if the token contains a colon, treat it as email:token for Basic auth;
  // otherwise treat it as a Personal Access Token (Bearer).
  const authHeader = token.includes(":")
    ? `Basic ${Buffer.from(token).toString("base64")}`
    : `Bearer ${token}`;

  const res = await fetch(`${baseUrl}/rest/api/2${path}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`JIRA API error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

async function jiraPost<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("JIRA API token not configured");

  const authHeader = token.includes(":")
    ? `Basic ${Buffer.from(token).toString("base64")}`
    : `Bearer ${token}`;

  const res = await fetch(`${baseUrl}/rest/api/2${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`JIRA API error ${res.status}: ${text.slice(0, 200)}`);
  }

  // Some JIRA endpoints (like transitions) return 204 No Content
  if (res.status === 204) return {} as T;

  return res.json() as Promise<T>;
}

// ── Parse issue key from URL ────────────────────────────────────────

/**
 * Extract the issue key (e.g. "PROJ-123") from a JIRA URL.
 * Supports:
 *   https://mycompany.atlassian.net/browse/PROJ-123
 *   https://jira.mycompany.com/browse/PROJ-123
 */
export function parseJiraIssueKey(url: string): string | null {
  const match = url.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/);
  return match ? match[1] : null;
}

// ── Fetch issue ─────────────────────────────────────────────────────

/**
 * Fetch a JIRA issue by its key (e.g. "PROJ-123").
 * Returns null if the token or base URL is not configured.
 */
export async function fetchIssue(key: string, issueUrl?: string): Promise<JiraIssue | null> {
  const token = getToken();
  if (!token) return null;

  const baseUrl = getBaseUrl() || (issueUrl ? baseUrlFromIssueUrl(issueUrl) : null);
  if (!baseUrl) return null;

  try {
    // Fetch issue details
    const data = await jiraFetch<any>(baseUrl, `/issue/${key}?fields=summary,description,status,attachment`);

    // Fetch available transitions
    const transData = await jiraFetch<any>(baseUrl, `/issue/${key}/transitions`);

    return {
      id: data.id,
      key: data.key,
      title: data.fields.summary,
      description: data.fields.description,
      url: `${baseUrl}/browse/${data.key}`,
      status: {
        id: data.fields.status.id,
        name: data.fields.status.name,
        categoryKey: data.fields.status.statusCategory?.key ?? "indeterminate",
      },
      transitions: (transData.transitions ?? []).map((t: any) => ({
        id: t.id,
        name: t.name,
        to: {
          id: t.to.id,
          name: t.to.name,
          categoryKey: t.to.statusCategory?.key ?? "indeterminate",
        },
      })),
      attachments: (data.fields.attachment ?? []).map((a: any) => ({
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        content: a.content,
      })),
    };
  } catch (e: any) {
    console.error(`[jira] Failed to fetch issue ${key}:`, e.message);
    return null;
  }
}

/**
 * Fetch a JIRA issue from a URL.
 * Returns null if the URL is not a JIRA issue URL or the token is not configured.
 */
export async function fetchIssueFromUrl(url: string): Promise<JiraIssue | null> {
  const key = parseJiraIssueKey(url);
  if (!key) return null;
  return fetchIssue(key, url);
}

// ── Issue state transitions ──────────────────────────────────────────

/**
 * Transition a JIRA issue to "In Progress" state.
 * Finds the first available transition whose target status category is "indeterminate"
 * (the JIRA category for in-progress states), or falls back to a transition named
 * "In Progress".
 *
 * @returns The new status name, or null if transition failed.
 */
export async function markIssueInProgress(issueKey: string, issueUrl?: string): Promise<string | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const issue = await fetchIssue(issueKey, issueUrl);
    if (!issue) return null;

    // Already in progress or done?
    if (issue.status.categoryKey === "indeterminate" || issue.status.categoryKey === "done") {
      console.log(`[jira] Issue ${issueKey} is already in status "${issue.status.name}"`);
      return issue.status.name;
    }

    // Find a transition to an "in progress" state
    const transition =
      issue.transitions.find((t) => t.to.categoryKey === "indeterminate") ??
      issue.transitions.find((t) => t.name.toLowerCase().includes("in progress"));

    if (!transition) {
      console.error(`[jira] No "in progress" transition found for issue ${issueKey}`);
      return null;
    }

    const baseUrl = getBaseUrl() || baseUrlFromIssueUrl(issue.url);
    if (!baseUrl) return null;

    await jiraPost(baseUrl, `/issue/${issueKey}/transitions`, {
      transition: { id: transition.id },
    });

    console.log(`[jira] Issue ${issueKey} → "${transition.to.name}"`);
    return transition.to.name;
  } catch (e: any) {
    console.error(`[jira] Failed to mark issue ${issueKey} as in-progress:`, e.message);
    return null;
  }
}

/**
 * Transition a JIRA issue to the "Done" state.
 * Finds the first available transition whose target status category is "done".
 *
 * @returns The new status name, or null if transition failed.
 */
export async function markIssueDone(issueKey: string, issueUrl?: string): Promise<string | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const issue = await fetchIssue(issueKey, issueUrl);
    if (!issue) return null;

    // Already done?
    if (issue.status.categoryKey === "done") {
      console.log(`[jira] Issue ${issueKey} is already in status "${issue.status.name}"`);
      return issue.status.name;
    }

    // Find a transition to a "done" state
    const transition =
      issue.transitions.find((t) => t.to.categoryKey === "done") ??
      issue.transitions.find((t) => t.name.toLowerCase() === "done");

    if (!transition) {
      console.error(`[jira] No "done" transition found for issue ${issueKey}`);
      return null;
    }

    const baseUrl = getBaseUrl() || baseUrlFromIssueUrl(issue.url);
    if (!baseUrl) return null;

    await jiraPost(baseUrl, `/issue/${issueKey}/transitions`, {
      transition: { id: transition.id },
    });

    console.log(`[jira] Issue ${issueKey} → "${transition.to.name}"`);
    return transition.to.name;
  } catch (e: any) {
    console.error(`[jira] Failed to mark issue ${issueKey} as done:`, e.message);
    return null;
  }
}

/**
 * Validate a JIRA API token by fetching the current user.
 */
export async function validateToken(token: string, baseUrl: string): Promise<{ valid: boolean; user?: string; error?: string }> {
  try {
    const authHeader = token.includes(":")
      ? `Basic ${Buffer.from(token).toString("base64")}`
      : `Bearer ${token}`;

    const res = await fetch(`${baseUrl}/rest/api/2/myself`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
    });

    if (!res.ok) {
      return { valid: false, error: `HTTP ${res.status}` };
    }

    const json = await res.json() as any;
    return { valid: true, user: json.displayName || json.emailAddress || json.name };
  } catch (e: any) {
    return { valid: false, error: e.message };
  }
}

// ── Generate session name from issue ────────────────────────────────

/**
 * Generate a session name from a JIRA issue.
 * Format: "short-title-slug"
 */
export function sessionNameFromIssue(issue: JiraIssue): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug || issue.key;
}

// ── Image support ───────────────────────────────────────────────────

const IMAGE_UPLOAD_DIR = join(tmpdir(), "devbench-uploads");

/**
 * Parse JIRA wiki-markup image references from a description.
 * Matches `!filename!` and `!filename|params!` patterns.
 * Returns the list of referenced filenames.
 */
export function parseImageReferences(description: string): string[] {
  const regex = /!([^!|\n]+?)(?:\|[^!\n]*)?!/g;
  const filenames: string[] = [];
  let match;
  while ((match = regex.exec(description)) !== null) {
    filenames.push(match[1]);
  }
  return filenames;
}

/**
 * Download a JIRA attachment to a local tmp file.
 * Uses the same upload directory as the file-upload feature.
 * Returns the local file path, or null on failure.
 */
async function downloadAttachment(contentUrl: string, filename: string): Promise<string | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const authHeader = token.includes(":")
      ? `Basic ${Buffer.from(token).toString("base64")}`
      : `Bearer ${token}`;

    const res = await fetch(contentUrl, {
      headers: { Authorization: authHeader },
    });

    if (!res.ok) {
      console.error(`[jira] Failed to download attachment ${filename}: HTTP ${res.status}`);
      return null;
    }

    mkdirSync(IMAGE_UPLOAD_DIR, { recursive: true });

    const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
    const uniqueName = `jira-${Date.now()}-${randomBytes(4).toString("hex")}${ext}`;
    const filePath = join(IMAGE_UPLOAD_DIR, uniqueName);

    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(filePath, buffer);
    console.log(`[jira] Downloaded attachment ${filename} → ${filePath}`);
    return filePath;
  } catch (e: any) {
    console.error(`[jira] Failed to download attachment ${filename}:`, e.message);
    return null;
  }
}

/**
 * Download all image attachments referenced in the issue description.
 * Returns a map of attachment filename → local file path.
 */
export async function downloadIssueImages(
  issue: JiraIssue
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();
  if (!issue.description) return imageMap;

  const referencedFilenames = parseImageReferences(issue.description);
  if (referencedFilenames.length === 0) return imageMap;

  // Only download image attachments that are referenced in the description
  const imageAttachments = issue.attachments.filter(
    (a) => a.mimeType.startsWith("image/") && referencedFilenames.includes(a.filename)
  );

  await Promise.all(
    imageAttachments.map(async (att) => {
      const localPath = await downloadAttachment(att.content, att.filename);
      if (localPath) {
        imageMap.set(att.filename, localPath);
      }
    })
  );

  return imageMap;
}

/**
 * Replace JIRA wiki-markup image references in a description with local file paths.
 * `!filename|params!` → the local file path.
 * Images that couldn't be downloaded are removed from the text.
 */
export function replaceImageReferences(
  description: string,
  imageMap: Map<string, string>
): string {
  return description.replace(
    /!([^!|\n]+?)(?:\|[^!\n]*)?!/g,
    (_match, filename) => {
      const localPath = imageMap.get(filename);
      return localPath ?? "";
    }
  );
}

/**
 * Generate the prompt text to paste into an agent session from a JIRA issue.
 * Downloads referenced images and includes their local file paths inline.
 */
export async function promptFromIssue(issue: JiraIssue): Promise<string> {
  const parts = [
    `Implement JIRA issue ${issue.key}: ${issue.title}`,
  ];
  if (issue.description) {
    const imageMap = await downloadIssueImages(issue);
    const processedDescription = replaceImageReferences(issue.description, imageMap);
    parts.push("", processedDescription);
  }
  parts.push("", `Reference: ${issue.url}`);
  return parts.join("\n");
}
