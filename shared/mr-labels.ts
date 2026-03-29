/** Derive a short display label from an MR/PR URL. */
export function getMrLabel(url: string): string {
  const gitlabMr = url.match(/\/-\/merge_requests\/(\d+)/);
  if (gitlabMr) return `!${gitlabMr[1]}`;
  const githubPr = url.match(/\/pull\/(\d+)/);
  if (githubPr) return `#${githubPr[1]}`;
  const bbPr = url.match(/\/pull-requests\/(\d+)/);
  if (bbPr) return `#${bbPr[1]}`;
  if (url.includes("/merge_requests/new")) return "MR";
  if (url.includes("/pull/new/")) return "PR";
  return "MR";
}
