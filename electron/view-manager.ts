import { WebContentsView } from "electron";
import type { BaseWindow } from "electron";
import { getMrLabel } from "../shared/mr-labels.ts";
import { SHORTCUT_MAP } from "./shortcuts.ts";

// ── Per-session state ───────────────────────────────────────────────

const sessionAppViews = new Map<number, WebContentsView>();
const sessionMrViews = new Map<number, WebContentsView>();
const sessionActiveTab = new Map<number, string>();    // "app" or MR URL
const sessionMrUrls = new Map<number, string[]>();     // MR URLs for tab bar
const sessionViewMode = new Map<number, string>();     // "desktop" or "mobile"
const attachedViews = new Set<WebContentsView>();

let winRef: BaseWindow | null = null;

export function setWindow(w: BaseWindow | null) { winRef = w; }

// ── View attach / detach ────────────────────────────────────────────

export function attachView(view: WebContentsView) {
  if (!winRef || attachedViews.has(view)) return;
  winRef.contentView.addChildView(view);
  attachedViews.add(view);
}

export function detachView(view: WebContentsView) {
  if (!winRef || !attachedViews.has(view)) return;
  winRef.contentView.removeChildView(view);
  attachedViews.delete(view);
}

// ── Active content view ─────────────────────────────────────────────

export function getActiveContentView(activeSessionId: number | null): WebContentsView | null {
  if (activeSessionId === null) return null;
  const tab = sessionActiveTab.get(activeSessionId) ?? "app";
  if (tab !== "app") return sessionMrViews.get(activeSessionId) ?? null;
  return sessionAppViews.get(activeSessionId) ?? null;
}

// ── Session view mode ───────────────────────────────────────────────

export function getViewMode(sessionId: number): string {
  return sessionViewMode.get(sessionId) ?? "desktop";
}

export function setViewMode(sessionId: number, mode: string) {
  sessionViewMode.set(sessionId, mode);
}

export function hasViewMode(sessionId: number): boolean {
  return sessionViewMode.has(sessionId);
}

// ── MR URLs / tabs ──────────────────────────────────────────────────

export function getMrUrls(sessionId: number): string[] {
  return sessionMrUrls.get(sessionId) ?? [];
}

export function setMrUrls(sessionId: number, urls: string[]) {
  sessionMrUrls.set(sessionId, urls);
}

export function getActiveTab(sessionId: number): string {
  return sessionActiveTab.get(sessionId) ?? "app";
}

export function setActiveTab(sessionId: number, tabId: string) {
  sessionActiveTab.set(sessionId, tabId);
}

// ── Tab bar data ────────────────────────────────────────────────────

export function buildTabsData(activeSessionId: number | null): Array<{ id: string; label: string; active: boolean }> {
  if (activeSessionId === null) return [];
  const mrUrls = sessionMrUrls.get(activeSessionId) ?? [];
  if (mrUrls.length === 0) return [];
  const activeTab = sessionActiveTab.get(activeSessionId) ?? "app";
  return [
    { id: "app", label: "App", active: activeTab === "app" },
    ...mrUrls.map((url) => ({
      id: url,
      label: getMrLabel(url),
      active: activeTab === url,
    })),
  ];
}

// ── View lifecycle ──────────────────────────────────────────────────

export function createBrowserView(
  sessionId: number,
  getActiveSessionId: () => number | null,
  sendToToolbar: (ch: string, ...args: unknown[]) => void,
  sendToApp: (ch: string, ...args: unknown[]) => void
): WebContentsView {
  const view = new WebContentsView({
    webPreferences: { sandbox: true },
  });
  view.setBackgroundColor("#0d1117");

  const wc = view.webContents;

  const onNavigate = (_e: unknown, navUrl: string) => {
    if (sessionId === getActiveSessionId() && view === getActiveContentView(sessionId)) {
      sendToToolbar("toolbar:url-changed", navUrl);
    }
  };
  wc.on("did-navigate", onNavigate as any);
  wc.on("did-navigate-in-page", onNavigate as any);

  wc.on("did-start-loading", () => {
    if (sessionId === getActiveSessionId() && view === getActiveContentView(sessionId))
      sendToToolbar("toolbar:loading-changed", true);
  });
  wc.on("did-stop-loading", () => {
    if (sessionId === getActiveSessionId() && view === getActiveContentView(sessionId))
      sendToToolbar("toolbar:loading-changed", false);
  });

  wc.setWindowOpenHandler(({ url: openUrl }) => {
    wc.loadURL(openUrl);
    return { action: "deny" };
  });

  wc.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown" || !input.control || !input.shift) return;
    const action = SHORTCUT_MAP[input.key.toUpperCase()];
    if (action) {
      _e.preventDefault();
      sendToApp("devbench:shortcut", action);
    }
  });

  return view;
}

export function getOrCreateAppView(
  sessionId: number,
  url: string | undefined,
  getActiveSessionId: () => number | null,
  sendToToolbar: (ch: string, ...args: unknown[]) => void,
  sendToApp: (ch: string, ...args: unknown[]) => void
): WebContentsView {
  let view = sessionAppViews.get(sessionId);
  if (view) return view;
  view = createBrowserView(sessionId, getActiveSessionId, sendToToolbar, sendToApp);
  sessionAppViews.set(sessionId, view);
  if (url) view.webContents.loadURL(url);
  return view;
}

export function getOrCreateMrView(
  sessionId: number,
  getActiveSessionId: () => number | null,
  sendToToolbar: (ch: string, ...args: unknown[]) => void,
  sendToApp: (ch: string, ...args: unknown[]) => void
): WebContentsView {
  let view = sessionMrViews.get(sessionId);
  if (view) return view;
  view = createBrowserView(sessionId, getActiveSessionId, sendToToolbar, sendToApp);
  sessionMrViews.set(sessionId, view);
  return view;
}

export function getAppView(sessionId: number): WebContentsView | undefined {
  return sessionAppViews.get(sessionId);
}

export function hasAppView(sessionId: number): boolean {
  return sessionAppViews.has(sessionId);
}

export function destroySessionViews(sessionId: number, activeSessionId: number | null): number | null {
  const appV = sessionAppViews.get(sessionId);
  if (appV) {
    detachView(appV);
    (appV.webContents as any).destroy?.();
    sessionAppViews.delete(sessionId);
  }
  const mrV = sessionMrViews.get(sessionId);
  if (mrV) {
    detachView(mrV);
    (mrV.webContents as any).destroy?.();
    sessionMrViews.delete(sessionId);
  }
  sessionActiveTab.delete(sessionId);
  sessionMrUrls.delete(sessionId);
  sessionViewMode.delete(sessionId);
  return activeSessionId === sessionId ? null : activeSessionId;
}

export function detachAllContentViews() {
  for (const v of sessionAppViews.values()) detachView(v);
  for (const v of sessionMrViews.values()) detachView(v);
}

export function clearAll() {
  sessionAppViews.clear();
  sessionMrViews.clear();
  sessionActiveTab.clear();
  sessionMrUrls.clear();
  sessionViewMode.clear();
  attachedViews.clear();
}
