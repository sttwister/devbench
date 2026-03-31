import { getMrLabel, getMrStatusClass, getMrStatusTooltip } from "../api";
import { useMrStatus } from "../contexts/MrStatusContext";

interface MrBadgeProps {
  url: string;
  /** Extra class names for context-specific sizing / layout. */
  className?: string;
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
      className={`mr-badge mr-status-${statusClass}${className ? ` ${className}` : ""}`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={tooltip}
      onClick={(e) => e.stopPropagation()}
    >
      {getMrLabel(url)}
    </a>
  );
}
