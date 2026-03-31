/**
 * Linear API integration.
 *
 * Fetches issue details (title, description, identifier, state) from
 * the Linear GraphQL API.  Also supports transitioning issues to "Done".
 */

import * as db from "./db.ts";

const LINEAR_API_URL = "https://api.linear.app/graphql";

// ── Types ───────────────────────────────────────────────────────────

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: {
    id: string;
    name: string;
    type: string; // "started" | "unstarted" | "completed" | "canceled" | "backlog" | "triage"
  };
  team: {
    id: string;
    name: string;
    states: {
      nodes: Array<{
        id: string;
        name: string;
        type: string;
      }>;
    };
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function getToken(): string | null {
  return db.getSetting("linear_token");
}

async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = getToken();
  if (!token) throw new Error("Linear API token not configured");

  const res = await fetch(LINEAR_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Linear API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as any;
  if (json.errors?.length) {
    throw new Error(`Linear GraphQL error: ${json.errors[0].message}`);
  }

  return json.data as T;
}

// ── Parse issue identifier from URL ─────────────────────────────────

/**
 * Extract the issue identifier (e.g. "ENG-123") from a Linear URL.
 * Supports: https://linear.app/team/issue/ENG-123/some-title
 */
export function parseLinearIssueId(url: string): string | null {
  const match = url.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/);
  return match ? match[1] : null;
}

// ── Fetch issue ─────────────────────────────────────────────────────

const ISSUE_QUERY = `
  query IssueByIdentifier($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      state {
        id
        name
        type
      }
      team {
        id
        name
        states {
          nodes {
            id
            name
            type
          }
        }
      }
    }
  }
`;

/**
 * Fetch a Linear issue by its identifier (e.g. "ENG-123").
 * Returns null if the token is not configured.
 */
export async function fetchIssue(identifier: string): Promise<LinearIssue | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const data = await graphql<{ issue: LinearIssue }>(ISSUE_QUERY, { id: identifier });
    return data.issue;
  } catch (e: any) {
    console.error(`[linear] Failed to fetch issue ${identifier}:`, e.message);
    return null;
  }
}

/**
 * Fetch a Linear issue from a URL.
 * Returns null if the URL is not a Linear issue URL or the token is not configured.
 */
export async function fetchIssueFromUrl(url: string): Promise<LinearIssue | null> {
  const identifier = parseLinearIssueId(url);
  if (!identifier) return null;
  return fetchIssue(identifier);
}

// ── Transition issue to Done ────────────────────────────────────────

const UPDATE_ISSUE_MUTATION = `
  mutation UpdateIssue($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) {
      success
      issue {
        id
        identifier
        state {
          name
          type
        }
      }
    }
  }
`;

/**
 * Transition a Linear issue to the "Done" state.
 * Finds the first state with type "completed" in the issue's team.
 *
 * @returns The updated issue state name, or null if transition failed.
 */
export async function markIssueDone(issueIdentifier: string): Promise<string | null> {
  const token = getToken();
  if (!token) return null;

  try {
    // First fetch the issue to get its team's states
    const issue = await fetchIssue(issueIdentifier);
    if (!issue) return null;

    // Find the "Done" state (type = "completed")
    const doneState = issue.team.states.nodes.find((s) => s.type === "completed");
    if (!doneState) {
      console.error(`[linear] No "completed" state found for team ${issue.team.name}`);
      return null;
    }

    // Already done?
    if (issue.state.type === "completed") {
      console.log(`[linear] Issue ${issueIdentifier} is already in state "${issue.state.name}"`);
      return issue.state.name;
    }

    const data = await graphql<{
      issueUpdate: { success: boolean; issue: { state: { name: string; type: string } } };
    }>(UPDATE_ISSUE_MUTATION, {
      id: issue.id,
      stateId: doneState.id,
    });

    if (data.issueUpdate.success) {
      console.log(`[linear] Issue ${issueIdentifier} → "${data.issueUpdate.issue.state.name}"`);
      return data.issueUpdate.issue.state.name;
    }

    return null;
  } catch (e: any) {
    console.error(`[linear] Failed to mark issue ${issueIdentifier} as done:`, e.message);
    return null;
  }
}

/**
 * Validate a Linear API token by fetching the current user.
 */
export async function validateToken(token: string): Promise<{ valid: boolean; user?: string; error?: string }> {
  try {
    const res = await fetch(LINEAR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token,
      },
      body: JSON.stringify({ query: "{ viewer { name email } }" }),
    });

    if (!res.ok) {
      return { valid: false, error: `HTTP ${res.status}` };
    }

    const json = await res.json() as any;
    if (json.errors?.length) {
      return { valid: false, error: json.errors[0].message };
    }

    return { valid: true, user: json.data.viewer.name || json.data.viewer.email };
  } catch (e: any) {
    return { valid: false, error: e.message };
  }
}

// ── Generate session name from issue ────────────────────────────────

/**
 * Generate a session name from a Linear issue.
 * Format: "ENG-123-short-title-slug"
 */
export function sessionNameFromIssue(issue: LinearIssue): string {
  const slug = issue.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug || issue.identifier;
}

/**
 * Generate the prompt text to paste into an agent session from a Linear issue.
 * Includes title, description, and reference URL.
 */
export function promptFromIssue(issue: LinearIssue): string {
  const parts = [
    `Implement Linear issue ${issue.identifier}: ${issue.title}`,
  ];
  if (issue.description) {
    parts.push("", issue.description);
  }
  parts.push("", `Reference: ${issue.url}`);
  return parts.join("\n");
}
