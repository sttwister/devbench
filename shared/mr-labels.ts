// @lat: [[integrations#MR Badge Display]]
import type { MrStatus } from "./types.ts";

/**
 * Get a CSS class suffix for an MR status badge.
 * Returns: "merged" | "approved" | "changes-requested" | "draft" | "closed" | "failed" | "pipeline-success" | "open"
 */
export function getMrStatusClass(status: MrStatus | undefined): string {
  if (!status) return "open";
  if (status.state === "merged") return "merged";
  if (status.state === "closed") return "closed";
  if (status.changes_requested) return "changes-requested";
  if (status.pipeline_status === "failed") return "failed";
  if (status.approved) return "approved";
  if (status.pipeline_status === "success") return "pipeline-success";
  if (status.draft) return "draft";
  return "open";
}

/**
 * Get a human-readable tooltip for an MR status.
 */
export function getMrStatusTooltip(status: MrStatus | undefined): string {
  if (!status) return "";
  const parts: string[] = [];
  parts.push(status.state.charAt(0).toUpperCase() + status.state.slice(1));
  if (status.draft) parts.push("Draft");
  if (status.approved) parts.push("Approved");
  if (status.changes_requested) parts.push("Changes requested");
  if (status.pipeline_status) {
    parts.push(`Pipeline: ${status.pipeline_status}`);
  }
  if (status.auto_merge) parts.push("Auto-merge enabled");
  return parts.join(" · ");
}

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
