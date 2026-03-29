import {
  Terminal,
  Bot,
  Sparkles,
  Pi,
  X,
  Menu,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Globe,
  Home,
  Monitor,
  Smartphone,
  Archive,
  Pencil,
  Plus,
  RotateCw,
  ExternalLink,
  Save,
  GripVertical,
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
  "chevron-right": ChevronRight,
  "refresh-cw": RefreshCw,
  globe: Globe,
  home: Home,
  monitor: Monitor,
  smartphone: Smartphone,
  archive: Archive,
  pencil: Pencil,
  plus: Plus,
  "rotate-cw": RotateCw,
  "external-link": ExternalLink,
  save: Save,
  "grip-vertical": GripVertical,
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
