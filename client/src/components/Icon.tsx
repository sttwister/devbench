import {
  Terminal,
  Bot,
  Sparkles,
  Pi,
  X,
  Menu,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Globe,
  Home,
  Monitor,
  Smartphone,
  Archive,
  ArchiveRestore,
  Pencil,
  Plus,
  RotateCw,
  ExternalLink,
  Save,
  GripVertical,
  Settings,
  Info,
  Ticket,
  Bug,
  MessageSquare,
  Link,
  EllipsisVertical,
  FileDiff,
  GitBranch,
  GitFork,
  GitGraph,
  GitMerge,
  SquareKanban,
  Loader2,
  ArrowDown,
  ArrowUp,
  AlertCircle,
  Check,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Folder,
  Paperclip,
  Copy,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { IconName } from "@devbench/shared";

/**
 * Map of icon name → Lucide component.
 *
 * Typed as `Record<IconName, …>` so that:
 *   • adding a name to `IconName` without mapping it here → compile error
 *   • mapping a name here that isn't in `IconName`        → compile error
 */
const ICON_MAP: Record<IconName, React.FC<LucideProps>> = {
  // Session types
  terminal: Terminal,
  bot: Bot,
  sparkles: Sparkles,
  pi: Pi,

  // General UI
  x: X,
  menu: Menu,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "refresh-cw": RefreshCw,
  globe: Globe,
  home: Home,
  monitor: Monitor,
  smartphone: Smartphone,
  archive: Archive,
  "archive-restore": ArchiveRestore,
  pencil: Pencil,
  plus: Plus,
  "rotate-cw": RotateCw,
  "external-link": ExternalLink,
  save: Save,
  "grip-vertical": GripVertical,
  settings: Settings,
  info: Info,

  // Source / integration icons
  ticket: Ticket,
  bug: Bug,
  "message-square": MessageSquare,
  link: Link,
  github: GitBranch,
  gitlab: GitFork,
  linear: SquareKanban,

  // Git
  "git-branch": GitBranch,
  "git-merge": GitMerge,
  "git-graph": GitGraph,
  "file-diff": FileDiff,

  // Status / feedback
  "ellipsis-vertical": EllipsisVertical,
  loader: Loader2,
  "arrow-down": ArrowDown,
  "arrow-up": ArrowUp,
  "alert-circle": AlertCircle,
  check: Check,
  "check-circle": CheckCircle,
  "alert-triangle": AlertTriangle,
  "x-circle": XCircle,
  folder: Folder,
  paperclip: Paperclip,
  copy: Copy,
  "zoom-in": ZoomIn,
  "zoom-out": ZoomOut,
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Renders an SVG icon by name.
 *
 * Invalid names are caught at compile time via the `IconName` type.
 * A runtime error is thrown as a safety net for dynamic values.
 */
export default function Icon({ name, size = 16, className, title }: IconProps) {
  const Component = ICON_MAP[name];
  if (!Component) {
    throw new Error(`Icon: unknown icon name "${name}". Add it to shared/icon-names.ts and client/src/components/Icon.tsx.`);
  }
  const spin = name === "loader" ? "icon-spin" : undefined;
  const cls = [spin, className].filter(Boolean).join(" ") || undefined;
  return <Component size={size} className={cls} aria-hidden={!title} title={title} />;
}
