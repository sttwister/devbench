/**
 * Canonical list of icon names available in the app.
 *
 * This is the single source of truth — Icon.tsx maps each name to a Lucide
 * component via `Record<IconName, …>`, so the compiler will reject:
 *   • using a name not in this union  (in JSX or shared helpers)
 *   • adding a name here without mapping it in Icon.tsx
 *   • mapping a name in Icon.tsx that isn't listed here
 */
export type IconName =
  // Session types
  | "terminal"
  | "bot"
  | "sparkles"
  | "pi"

  // General UI
  | "x"
  | "menu"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "refresh-cw"
  | "globe"
  | "home"
  | "monitor"
  | "smartphone"
  | "archive"
  | "archive-restore"
  | "pencil"
  | "plus"
  | "rotate-cw"
  | "external-link"
  | "save"
  | "grip-vertical"
  | "settings"
  | "info"

  // Source / integration icons
  | "ticket"
  | "bug"
  | "message-square"
  | "link"
  | "github"
  | "gitlab"
  | "linear"

  // Git
  | "git-branch"
  | "git-merge"
  | "git-graph"

  // Status / feedback
  | "ellipsis-vertical"
  | "loader"
  | "arrow-down"
  | "arrow-up"
  | "alert-circle"
  | "check"
  | "check-circle"
  | "alert-triangle"
  | "x-circle"
  | "folder"
  | "paperclip"
  | "copy";
