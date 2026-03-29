import type { BaseWindow, WebContentsView } from "electron";
import * as views from "./view-manager.ts";

// ── Constants ───────────────────────────────────────────────────────
export const TOOLBAR_NAV_HEIGHT = 41;
export const TAB_BAR_HEIGHT = 30;
export const RESIZER_WIDTH = 4;
export const SIDEBAR_WIDTH = 260;       // must match CSS --sidebar-w
export const MIN_PANEL_WIDTH = 200;     // min terminal / browser content width
export const MOBILE_VIEWPORT_WIDTH = 375;
export const MOBILE_VIEWPORT_HEIGHT = 844;

// ── Layout ──────────────────────────────────────────────────────────

export function getToolbarHeight(activeSessionId: number | null): number {
  if (!activeSessionId) return TOOLBAR_NAV_HEIGHT;
  const mrUrls = views.getMrUrls(activeSessionId);
  return mrUrls.length > 0 ? TOOLBAR_NAV_HEIGHT + TAB_BAR_HEIGHT : TOOLBAR_NAV_HEIGHT;
}

export function updateLayout(
  win: BaseWindow | null,
  appView: WebContentsView | null,
  toolbarView: WebContentsView | null,
  activeSessionId: number | null,
  browserOpen: boolean,
  splitPercent: number
) {
  if (!win || !appView) return;
  const [winW, winH] = win.getContentSize();

  const activeContentView = views.getActiveContentView(activeSessionId);

  if (!browserOpen || !activeContentView) {
    appView.setBounds({ x: 0, y: 0, width: winW, height: winH });
    if (toolbarView) views.detachView(toolbarView);
    views.detachAllContentViews();
    return;
  }

  const contentW = winW - SIDEBAR_WIDTH;
  const minPct = (MIN_PANEL_WIDTH / contentW) * 100;
  const maxPct = ((contentW - MIN_PANEL_WIDTH - RESIZER_WIDTH) / contentW) * 100;
  const clamped = Math.max(minPct, Math.min(maxPct, splitPercent));

  const terminalW = Math.round(contentW * clamped / 100);
  const appW = SIDEBAR_WIDTH + terminalW;
  const rightX = appW + RESIZER_WIDTH;
  const rightW = Math.max(0, winW - rightX);
  const toolbarH = getToolbarHeight(activeSessionId);

  // Left panel: React app (sidebar + terminal + resizer)
  appView.setBounds({ x: 0, y: 0, width: appW, height: winH });

  // Right panel: toolbar + content
  if (toolbarView) {
    views.attachView(toolbarView);
    toolbarView.setBounds({ x: rightX, y: 0, width: rightW, height: toolbarH });
  }

  // Detach all content views, then attach only the active one
  views.detachAllContentViews();
  views.attachView(activeContentView);

  const viewMode = activeSessionId !== null
    ? views.getViewMode(activeSessionId)
    : "desktop";
  const contentH = Math.max(0, winH - toolbarH);

  if (viewMode === "mobile" && rightW > MOBILE_VIEWPORT_WIDTH) {
    const mobileW = MOBILE_VIEWPORT_WIDTH;
    const mobileH = Math.min(contentH, MOBILE_VIEWPORT_HEIGHT);
    const centeredX = rightX + Math.round((rightW - mobileW) / 2);
    const centeredY = toolbarH + Math.round((contentH - mobileH) / 2);
    activeContentView.setBounds({
      x: centeredX, y: centeredY, width: mobileW, height: mobileH,
    });
  } else {
    activeContentView.setBounds({
      x: rightX, y: toolbarH, width: rightW, height: contentH,
    });
  }
}
