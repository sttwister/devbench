import { getMrLabel, getMrStatusClass, getMrStatusTooltip } from "../api";
import { useMrStatus } from "../contexts/MrStatusContext";
import type { MrStatus } from "../api";
import Icon from "./Icon";

interface MrBadgeProps {
  url: string;
  /** Extra class names for context-specific sizing / layout. */
  className?: string;
}

/** Small inline indicator for pipeline status (shown after the label). */
function PipelineIndicator({ status }: { status: MrStatus }) {
  if (status.state === "merged" || status.state === "closed") return null;
  const ps = status.pipeline_status;
  if (!ps) return null;

  if (ps === "success") {
    return <span className="mr-badge-indicator mr-indicator-success"><Icon name="check" size={10} /></span>;
  }
  if (ps === "failed") {
    return <span className="mr-badge-indicator mr-indicator-failed"><Icon name="x" size={10} /></span>;
  }
  if (ps === "running" || ps === "pending") {
    return <span className="mr-badge-indicator mr-indicator-running"><Icon name="loader" size={10} /></span>;
  }
  return null;
}

/** Small auto-merge icon shown when merge-when-pipeline-succeeds is active. */
function AutoMergeIndicator({ status }: { status: MrStatus }) {
  if (!status.auto_merge) return null;
  if (status.state === "merged" || status.state === "closed") return null;
  return <span className="mr-badge-indicator mr-indicator-auto-merge" title="Auto-merge enabled"><Icon name="git-merge" size={10} /></span>;
}

/**
 * Shared MR / PR badge rendered as an `<a>` tag.
 *
 * Status is looked up automatically from the global MR status store —
 * callers only need to provide the URL.  This guarantees that two badges
 * for the same URL always show identical status.
 */
export default function MrBadge({ url, className }: MrBadgeProps) {
  const { statuses } = useMrStatus();
  const status = statuses[url];
  const statusClass = getMrStatusClass(status);
  const tooltip = status ? `${url}\n${getMrStatusTooltip(status)}` : url;
  return (
    <a
      className={`mr-badge mr-status-${statusClass}${status?.auto_merge && status.state === "open" ? " mr-auto-merge" : ""}${className ? ` ${className}` : ""}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip}
      onClick={(e) => e.stopPropagation()}
    >
      {status && <AutoMergeIndicator status={status} />}
      {getMrLabel(url)}
      {status && <PipelineIndicator status={status} />}
    </a>
  );
}
