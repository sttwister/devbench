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
  Ticket,
  Bug,
  MessageSquare,
  Link,
  EllipsisVertical,
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
  AlertTriangle,
  XCircle,
  Folder,
  Paperclip,
  Copy,
} from "lucide-react";
import type { LucideProps } from "lucide-react";

/**
 * Map of icon name → Lucide component.
 * Session-type icons use the same keys defined in shared/session-config.ts.
 */
const ICON_MAP: Record<string, React.FC<LucideProps>> = {
  // Session types
  terminal: Terminal,
  bot: Bot,
  sparkles: Sparkles,
  pi: Pi,

  // UI actions
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
  ticket: Ticket,
  bug: Bug,
  "message-square": MessageSquare,
  link: Link,
  github: GitBranch,
  "git-branch": GitBranch,
  gitlab: GitFork,
  "git-merge": GitMerge,
  "git-graph": GitGraph,
  "ellipsis-vertical": EllipsisVertical,
  linear: SquareKanban,
  loader: Loader2,
  "arrow-down": ArrowDown,
  "arrow-up": ArrowUp,
  "alert-circle": AlertCircle,
  check: Check,
  "alert-triangle": AlertTriangle,
  "x-circle": XCircle,
  folder: Folder,
  paperclip: Paperclip,
  copy: Copy,
};

interface IconProps {
  name: string;
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Renders an SVG icon by name. Falls back to Terminal icon for unknown names.
 */
export default function Icon({ name, size = 16, className, title }: IconProps) {
  const Component = ICON_MAP[name] ?? Terminal;
  return <Component size={size} className={className} aria-hidden={!title} title={title} />;
}
