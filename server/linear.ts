// @lat: [[integrations#Linear API]]
/**
 * Linear API integration.
 *
 * Fetches issue details (title, description, identifier, state) from
 * the Linear GraphQL API.  Also supports transitioning issues to "Done".
 */

import * as db from "./db.ts";
import { slugifySessionName } from "./session-naming.ts";

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
        position: number;
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

// ── Projects and project issues ─────────────────────────────────────

export interface LinearProject {
  id: string;
  name: string;
}

export interface LinearProjectIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: number;
  priorityLabel: string;
  state: { name: string; type: string };
}

const PROJECTS_QUERY = `
  query Projects {
    projects(first: 250) {
      nodes { id name }
    }
  }
`;

/** Fetch all Linear projects. Returns null if the token is not configured. */
export async function fetchLinearProjects(): Promise<LinearProject[] | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const data = await graphql<{ projects: { nodes: LinearProject[] } }>(PROJECTS_QUERY);
    return data.projects.nodes;
  } catch (e: any) {
    console.error(`[linear] Failed to fetch projects:`, e.message);
    return null;
  }
}

const PROJECT_ISSUES_QUERY = `
  query ProjectIssues($projectId: String!) {
    project(id: $projectId) {
      issues(filter: { state: { type: { in: ["backlog", "unstarted"] } } }) {
        nodes {
          id
          identifier
          title
          description
          url
          priority
          priorityLabel
          state { name type }
        }
      }
    }
  }
`;

/**
 * Fetch backlog / todo issues for a Linear project, sorted by priority.
 * Linear uses 0 for "No priority" and 1–4 for Urgent→Low; sort so Urgent
 * comes first and "No priority" last.
 */
export async function fetchProjectIssues(
  projectId: string
): Promise<LinearProjectIssue[] | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const data = await graphql<{ project: { issues: { nodes: LinearProjectIssue[] } } | null }>(
      PROJECT_ISSUES_QUERY,
      { projectId }
    );
    if (!data.project) return [];
    const issues = data.project.issues.nodes.slice();
    issues.sort((a, b) => {
      const ap = a.priority === 0 ? 99 : a.priority;
      const bp = b.priority === 0 ? 99 : b.priority;
      return ap - bp;
    });
    return issues;
  } catch (e: any) {
    console.error(`[linear] Failed to fetch project issues for ${projectId}:`, e.message);
    return null;
  }
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
            position
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

// ── Issue state transitions ──────────────────────────────────────────

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
 * Transition a Linear issue to "In Progress" state.
 * Finds the first state with type "started" in the issue's team.
 *
 * @returns The updated issue state name, or null if transition failed.
 */
export async function markIssueInProgress(issueIdentifier: string): Promise<string | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const issue = await fetchIssue(issueIdentifier);
    if (!issue) return null;

    // Find the earliest "started" state (lowest position = "In Progress", not "In Review")
    const startedStates = issue.team.states.nodes
      .filter((s) => s.type === "started")
      .sort((a, b) => a.position - b.position);
    const startedState = startedStates[0];
    if (!startedState) {
      console.error(`[linear] No "started" state found for team ${issue.team.name}`);
      return null;
    }

    // Already started or further along?
    if (issue.state.type === "started" || issue.state.type === "completed") {
      console.log(`[linear] Issue ${issueIdentifier} is already in state "${issue.state.name}"`);
      return issue.state.name;
    }

    const data = await graphql<{
      issueUpdate: { success: boolean; issue: { state: { name: string; type: string } } };
    }>(UPDATE_ISSUE_MUTATION, {
      id: issue.id,
      stateId: startedState.id,
    });

    if (data.issueUpdate.success) {
      console.log(`[linear] Issue ${issueIdentifier} → "${data.issueUpdate.issue.state.name}"`);
      return data.issueUpdate.issue.state.name;
    }

    return null;
  } catch (e: any) {
    console.error(`[linear] Failed to mark issue ${issueIdentifier} as in-progress:`, e.message);
    return null;
  }
}

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
  return slugifySessionName(issue.title) || issue.identifier;
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
