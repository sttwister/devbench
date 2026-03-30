/**
 * Utilities for detecting source type from URLs and generating
 * display labels / session name prefixes.
 *
 * Pure functions, no I/O — shared between client and server.
 */

export type SourceType = "jira" | "linear" | "sentry" | "github_issue" | "gitlab_issue" | "slack";

interface SourcePattern {
  type: SourceType;
  /** URL pattern to match */
  pattern: RegExp;
  /** Extract a short label from the URL (e.g. "PROJ-123") */
  label: (match: RegExpMatchArray) => string;
  /** Icon hint for the badge */
  icon: string;
}

const SOURCE_PATTERNS: SourcePattern[] = [
  {
    type: "jira",
    // https://mycompany.atlassian.net/browse/PROJ-123
    // https://jira.mycompany.com/browse/PROJ-123
    pattern: /\/browse\/([A-Z][A-Z0-9]+-\d+)/,
    label: (m) => m[1],
    icon: "ticket",
  },
  {
    type: "linear",
    // https://linear.app/team/issue/LIN-45/some-title
    pattern: /linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/,
    label: (m) => m[1],
    icon: "linear",
  },
  {
    type: "sentry",
    // https://myorg.sentry.io/issues/12345/
    pattern: /sentry\.io\/issues\/(\d+)/,
    label: (m) => `Sentry #${m[1]}`,
    icon: "bug",
  },
  {
    type: "github_issue",
    // https://github.com/owner/repo/issues/89
    pattern: /github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/,
    label: (m) => `#${m[1]}`,
    icon: "github",
  },
  {
    type: "gitlab_issue",
    // https://gitlab.com/group/project/-/issues/12
    pattern: /\/-\/issues\/(\d+)/,
    label: (m) => `#${m[1]}`,
    icon: "gitlab",
  },
  {
    type: "slack",
    // https://myteam.slack.com/archives/C01234/p1234567890
    pattern: /slack\.com\/archives\/([A-Z0-9]+)/,
    label: () => "Slack",
    icon: "message-square",
  },
];

/** Detect the source type from a URL. Returns null if unrecognized. */
export function detectSourceType(url: string): SourceType | null {
  for (const sp of SOURCE_PATTERNS) {
    if (sp.pattern.test(url)) return sp.type;
  }
  return null;
}

/** Get a short display label for a source URL (e.g. "PROJ-123", "#89", "Sentry #4521"). */
export function getSourceLabel(url: string): string | null {
  for (const sp of SOURCE_PATTERNS) {
    const match = url.match(sp.pattern);
    if (match) return sp.label(match);
  }
  return null;
}

/** Get the icon name for a source type. */
export function getSourceIcon(type: SourceType): string {
  const sp = SOURCE_PATTERNS.find((p) => p.type === type);
  return sp?.icon ?? "link";
}

/**
 * Generate a session name prefix from a source URL.
 * Returns null if the URL is unrecognized.
 * e.g. "PROJ-123" for JIRA, "LIN-45" for Linear, "sentry-12345" for Sentry
 */
export function getSourceNamePrefix(url: string): string | null {
  return getSourceLabel(url);
}
