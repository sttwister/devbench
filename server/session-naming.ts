// @lat: [[sessions#Session Naming]]
export const DEFAULT_NAME_RE = /^(Terminal|Claude Code|Pi|Codex) \d+$/;

export function isDefaultSessionName(name: string): boolean {
  return DEFAULT_NAME_RE.test(name.trim());
}

const MAX_SESSION_NAME_LENGTH = 30;

/**
 * Slugify a string into a kebab-case session name, capped at 30 characters.
 * Truncates at the last word boundary (hyphen) to avoid cut-off words.
 * Single source of truth for JIRA, Linear, and auto-rename name generation.
 */
export function slugifySessionName(text: string): string {
  let slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > MAX_SESSION_NAME_LENGTH) {
    slug = slug.slice(0, MAX_SESSION_NAME_LENGTH).replace(/-[^-]*$/, "");
  }
  return slug;
}

export function slugifySessionWorkName(name: string): string {
  return slugifySessionName(name.replace(/^feature\//i, ""));
}

export function toFeatureBranchName(name: string): string | null {
  const slug = slugifySessionWorkName(name);
  return slug ? `feature/${slug}` : null;
}
