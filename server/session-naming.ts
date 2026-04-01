// @lat: [[sessions#Session Naming]]
export const DEFAULT_NAME_RE = /^(Terminal|Claude Code|Pi|Codex) \d+$/;

export function isDefaultSessionName(name: string): boolean {
  return DEFAULT_NAME_RE.test(name.trim());
}

export function slugifySessionWorkName(name: string): string {
  return name
    .trim()
    .replace(/^feature\//i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function toFeatureBranchName(name: string): string | null {
  const slug = slugifySessionWorkName(name);
  return slug ? `feature/${slug}` : null;
}
