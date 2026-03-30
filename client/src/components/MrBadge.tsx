import type { MrStatus } from "../api";
import { getMrLabel, getMrStatusClass, getMrStatusTooltip } from "../api";

interface MrBadgeProps {
  url: string;
  status?: MrStatus;
  /** Extra class names for context-specific sizing / layout. */
  className?: string;
}

/**
 * Shared MR / PR badge rendered as an `<a>` tag.
 * Applies the unified `.mr-badge .mr-status-*` colour palette everywhere.
 */
export default function MrBadge({ url, status, className }: MrBadgeProps) {
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
