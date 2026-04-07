// @lat: [[electron#Main Process]]
import {
  app,
  BaseWindow,
  WebContentsView,
  ipcMain,
} from "electron";
import path from "path";
import { SHORTCUT_MAP } from "./shortcuts.ts";
import { SIDEBAR_WIDTH, updateLayout } from "./layout.ts";
import { buildMenu } from "./menu.ts";
import * as views from "./view-manager.ts";

// ── Configuration ───────────────────────────────────────────────────
const DEVBOX_URL = process.env.DEVBOX_URL || "http://localhost:3001";

// ── State ───────────────────────────────────────────────────────────
let win: BaseWindow | null = null;
let appView: WebContentsView | null = null;
let toolbarView: WebContentsView | null = null;

let activeSessionId: number | null = null;
let activeProjectId: number | null = null;
let currentDefaultUrl = "";
let browserOpen = false;
let splitPercent = 50;
let isResizing = false;

// ── Messaging helpers ───────────────────────────────────────────────

function sendToToolbar(channel: string, ...args: unknown[]) {
  toolbarView?.webContents.send(channel, ...args);
}

function sendToApp(channel: string, ...args: unknown[]) {
  appView?.webContents.send(channel, ...args);
}

function getActiveSessionId(): number | null { return activeSessionId; }

// ── Layout shorthand ────────────────────────────────────────────────

function relayout() {
  updateLayout(win, appView, toolbarView, activeSessionId, browserOpen, splitPercent);
}

function sendTabsToToolbar() {
  sendToToolbar("toolbar:tabs-changed", views.buildTabsData(activeSessionId));
}

function toggleBrowser() {
  browserOpen = !browserOpen;
  // Ensure the app view is created and loaded when opening the browser
  if (browserOpen && activeSessionId !== null && currentDefaultUrl) {
    getOrCreateAppView(activeSessionId, currentDefaultUrl);
  }
  relayout();
  sendToApp("devbench:browser-toggled", browserOpen);
}

// ── View factory shorthand ──────────────────────────────────────────

function getOrCreateAppView(sessionId: number, url?: string) {
  return views.getOrCreateAppView(sessionId, url, getActiveSessionId, sendToToolbar, sendToApp);
}

function getOrCreateMrView(sessionId: number) {
  return views.getOrCreateMrView(sessionId, getActiveSessionId, sendToToolbar, sendToApp);
}

// ── IPC: App → Main ─────────────────────────────────────────────────

ipcMain.on("devbench:toggle-browser", toggleBrowser);

ipcMain.on(
  "devbench:session-changed",
  (_e, sessionId: number, projectId: number, browserUrl: string | null, defaultViewMode?: string, sessionBrowserOpen?: boolean, sessionViewModeVal?: string | null) => {
    activeSessionId = sessionId;
    activeProjectId = projectId;
    currentDefaultUrl = browserUrl || "";

    if (!views.hasViewMode(sessionId)) {
      views.setViewMode(sessionId, sessionViewModeVal || defaultViewMode || "desktop");
    }

    const shouldBeOpen = !!(sessionBrowserOpen && browserUrl);
    if (shouldBeOpen !== browserOpen) {
      browserOpen = shouldBeOpen;
      sendToApp("devbench:browser-toggled", browserOpen);
    }

    if (browserUrl && browserOpen) {
      getOrCreateAppView(sessionId, browserUrl);
    }

    const tab = views.getActiveTab(sessionId);
    let currentUrl: string;
    if (tab !== "app") {
      const mrV = views.getAppView(sessionId); // actually get MR view URL
      currentUrl = views.getActiveContentView(sessionId)?.webContents.getURL() || tab;
    } else {
      const wc = views.getAppView(sessionId)?.webContents;
      currentUrl = wc?.getURL() || browserUrl || "";
    }
    sendToToolbar("toolbar:url-changed", currentUrl);
    sendToToolbar("toolbar:default-url-changed", currentDefaultUrl);
    sendToToolbar("toolbar:loading-changed",
      views.getActiveContentView(sessionId)?.webContents.isLoading() ?? false);
    sendToToolbar("toolbar:view-mode-changed", views.getViewMode(sessionId));
    sendTabsToToolbar();
    relayout();
  }
);

ipcMain.on("devbench:session-destroyed", (_e, sessionId: number) => {
  activeSessionId = views.destroySessionViews(sessionId, activeSessionId);
  relayout();
});

ipcMain.on("devbench:navigate-to-url", (_e, sessionId: number, url: string, mrUrls: string[]) => {
  if (mrUrls && mrUrls.length > 0) views.setMrUrls(sessionId, mrUrls);
  if (!views.hasAppView(sessionId) && currentDefaultUrl) {
    getOrCreateAppView(sessionId, currentDefaultUrl);
  }

  const mrView = getOrCreateMrView(sessionId);
  mrView.webContents.loadURL(url);
  views.setActiveTab(sessionId, url);
  activeSessionId = sessionId;

  if (!browserOpen) {
    browserOpen = true;
    sendToApp("devbench:browser-toggled", true);
  }

  sendToToolbar("toolbar:url-changed", url);
  sendTabsToToolbar();
  relayout();
});

ipcMain.on("devbench:update-mr-urls", (_e, sessionId: number, mrUrls: string[]) => {
  const prev = views.getMrUrls(sessionId);
  views.setMrUrls(sessionId, mrUrls);
  if (sessionId === activeSessionId && JSON.stringify(prev) !== JSON.stringify(mrUrls)) {
    sendTabsToToolbar();
    relayout();
  }
});

// ── IPC: App → Main (resize) ────────────────────────────────────────

ipcMain.on("devbench:resize-start", () => {
  isResizing = true;
  if (!win || !appView) return;
  const [winW, winH] = win.getContentSize();
  appView.setBounds({ x: 0, y: 0, width: winW, height: winH });
  if (toolbarView) views.detachView(toolbarView);
  views.detachAllContentViews();
});

ipcMain.on("devbench:resize-end", (_e, clientX: number) => {
  if (!win) return;
  isResizing = false;
  const [winW] = win.getContentSize();
  const contentW = winW - SIDEBAR_WIDTH;
  if (contentW > 0) splitPercent = ((clientX - SIDEBAR_WIDTH) / contentW) * 100;
  relayout();
});

// ── IPC: Toolbar → Main ─────────────────────────────────────────────

ipcMain.on("toolbar:navigate", (_e, url: string) => {
  if (activeSessionId === null) return;
  const view = views.getActiveContentView(activeSessionId) ?? getOrCreateAppView(activeSessionId);
  view.webContents.loadURL(url);
  if (!browserOpen) {
    browserOpen = true;
    sendToApp("devbench:browser-toggled", true);
  }
  relayout();
});

ipcMain.on("toolbar:back", () => {
  const wc = views.getActiveContentView(activeSessionId)?.webContents;
  if (wc?.canGoBack()) wc.goBack();
});

ipcMain.on("toolbar:forward", () => {
  const wc = views.getActiveContentView(activeSessionId)?.webContents;
  if (wc?.canGoForward()) wc.goForward();
});

ipcMain.on("toolbar:refresh", () => {
  views.getActiveContentView(activeSessionId)?.webContents.reload();
});

ipcMain.on("toolbar:close", () => {
  browserOpen = false;
  relayout();
  sendToApp("devbench:browser-toggled", false);
});

ipcMain.on("toolbar:save-url", async (_e, url: string) => {
  if (activeProjectId === null) return;
  try {
    const res = await fetch(`${DEVBOX_URL}/api/projects/${activeProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browser_url: url }),
    });
    if (res.ok) {
      currentDefaultUrl = url;
      sendToToolbar("toolbar:default-url-changed", url);
      sendToApp("devbench:projects-changed");
    }
  } catch (err) {
    console.error("[save-url]", err);
  }
});

ipcMain.on("toolbar:switch-tab", (_e, tabId: string) => {
  if (activeSessionId === null) return;

  if (tabId === "app") {
    views.setActiveTab(activeSessionId, "app");
    let av = views.getAppView(activeSessionId);
    if (!av && currentDefaultUrl) av = getOrCreateAppView(activeSessionId, currentDefaultUrl);
    sendToToolbar("toolbar:url-changed", av?.webContents.getURL() || currentDefaultUrl);
  } else {
    const mrView = getOrCreateMrView(activeSessionId);
    const currentUrl = mrView.webContents.getURL();
    if (!currentUrl || currentUrl === "about:blank" || currentUrl !== tabId) {
      mrView.webContents.loadURL(tabId);
    }
    views.setActiveTab(activeSessionId, tabId);
    sendToToolbar("toolbar:url-changed", currentUrl && currentUrl !== "about:blank" ? currentUrl : tabId);
  }

  sendTabsToToolbar();
  relayout();
});

ipcMain.on("toolbar:set-view-mode", (_e, mode: string) => {
  if (activeSessionId === null) return;
  views.setViewMode(activeSessionId, mode);
  sendToToolbar("toolbar:view-mode-changed", mode);
  sendToApp("devbench:view-mode-changed", mode);
  relayout();
});

// ── Window creation ─────────────────────────────────────────────────

function createWindow() {
  win = new BaseWindow({
    width: 1400, height: 900,
    title: "Devbench",
    backgroundColor: "#010409",
  });
  views.setWindow(win);

  appView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  appView.setBackgroundColor("#0d1117");
  views.attachView(appView);
  appView.webContents.loadURL(DEVBOX_URL);

  toolbarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "toolbar-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  toolbarView.setBackgroundColor("#161b22");
  toolbarView.webContents.loadFile(path.join(__dirname, "browser-toolbar.html"));

  relayout();
  win.on("resize", relayout);

  appView.webContents.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown" || !input.control || !input.shift) return;
    const action = SHORTCUT_MAP[input.key.toUpperCase()];
    if (action) {
      _e.preventDefault();
      sendToApp("devbench:shortcut", action);
    }
  });

  win.on("closed", () => {
    views.clearAll();
    views.setWindow(null);
    win = null;
    appView = null;
    toolbarView = null;
    activeSessionId = null;
  });
}

// ── Startup ─────────────────────────────────────────────────────────

app.whenReady().then(() => {
  buildMenu(sendToApp, toggleBrowser);
  createWindow();
});

app.on("window-all-closed", () => app.quit());
