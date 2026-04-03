/** Keyboard shortcut map — shared between appView and browser content views. */
export const SHORTCUT_MAP: Record<string, string> = {
  J: "next-session",
  K: "prev-session",
  B: "toggle-browser",
  T: "toggle-terminal",
  N: "new-session",
  X: "kill-session",
  A: "revive-session",
  R: "rename-session",
  G: "git-commit-push",
  D: "toggle-project-dashboard",
  F: "toggle-all-dashboard",
  L: "gitbutler-pull",
  "?": "show-shortcuts",
  E: "toggle-diff",
};
