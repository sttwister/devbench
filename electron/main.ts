import {
  app,
  BaseWindow,
  WebContentsView,
  ipcMain,
  Menu,
} from "electron";
import path from "path";

// ── Configuration ───────────────────────────────────────────────────
const DEVBOX_URL = process.env.DEVBOX_URL || "http://localhost:3001";
const TOOLBAR_NAV_HEIGHT = 41;
const TAB_BAR_HEIGHT = 30;
const RESIZER_WIDTH = 4;
const SIDEBAR_WIDTH = 260;       // must match CSS --sidebar-w
const MIN_PANEL_WIDTH = 200;     // min terminal / browser content width
const MOBILE_VIEWPORT_WIDTH = 375;
const MOBILE_VIEWPORT_HEIGHT = 844;

// ── State ───────────────────────────────────────────────────────────
let win: BaseWindow | null = null;
let appView: WebContentsView | null = null;
let toolbarView: WebContentsView | null = null;

// Per-session browser views: app views (project URL) and MR views
const sessionAppViews = new Map<number, WebContentsView>();
const sessionMrViews = new Map<number, WebContentsView>();
const sessionActiveTab = new Map<number, string>();    // "app" or MR URL
const sessionMrUrls = new Map<number, string[]>();     // MR URLs for tab bar
const sessionViewMode = new Map<number, string>();     // "desktop" or "mobile"

let activeSessionId: number | null = null;
let activeProjectId: number | null = null;
let currentDefaultUrl = "";
let browserOpen = false;
let splitPercent = 50;
let isResizing = false;

const attachedViews = new Set<WebContentsView>();

// ── Helpers ─────────────────────────────────────────────────────────
function getMrLabel(url: string): string {
  const gl = url.match(/\/-\/merge_requests\/(\d+)/);
  if (gl) return `!${gl[1]}`;
  const gh = url.match(/\/pull\/(\d+)/);
  if (gh) return `#${gh[1]}`;
  const bb = url.match(/\/pull-requests\/(\d+)/);
  if (bb) return `#${bb[1]}`;
  if (url.includes("/merge_requests/new")) return "MR";
  if (url.includes("/pull/new/")) return "PR";
  return "MR";
}

// ── View management ─────────────────────────────────────────────────
function attachView(view: WebContentsView) {
  if (!win || attachedViews.has(view)) return;
  win.contentView.addChildView(view);
  attachedViews.add(view);
}

function detachView(view: WebContentsView) {
  if (!win || !attachedViews.has(view)) return;
  win.contentView.removeChildView(view);
  attachedViews.delete(view);
}

/** Get whichever content view (app or MR) is active for the current session. */
function getActiveContentView(): WebContentsView | null {
  if (activeSessionId === null) return null;
  const tab = sessionActiveTab.get(activeSessionId) ?? "app";
  if (tab !== "app") {
    return sessionMrViews.get(activeSessionId) ?? null;
  }
  return sessionAppViews.get(activeSessionId) ?? null;
}

// ── Layout ──────────────────────────────────────────────────────────
function getToolbarHeight(): number {
  if (!activeSessionId) return TOOLBAR_NAV_HEIGHT;
  const mrUrls = sessionMrUrls.get(activeSessionId) ?? [];
  return mrUrls.length > 0 ? TOOLBAR_NAV_HEIGHT + TAB_BAR_HEIGHT : TOOLBAR_NAV_HEIGHT;
}

function updateLayout() {
  if (!win || !appView) return;
  const [winW, winH] = win.getContentSize();

  const activeContentView = getActiveContentView();

  if (!browserOpen || !activeContentView) {
    appView.setBounds({ x: 0, y: 0, width: winW, height: winH });
    if (toolbarView) detachView(toolbarView);
    for (const v of sessionAppViews.values()) detachView(v);
    for (const v of sessionMrViews.values()) detachView(v);
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
  const toolbarH = getToolbarHeight();

  // Left panel: React app (sidebar + terminal + resizer)
  appView.setBounds({ x: 0, y: 0, width: appW, height: winH });

  // Right panel: toolbar + content
  if (toolbarView) {
    attachView(toolbarView);
    toolbarView.setBounds({ x: rightX, y: 0, width: rightW, height: toolbarH });
  }

  // Detach all content views, then attach only the active one
  for (const v of sessionAppViews.values()) detachView(v);
  for (const v of sessionMrViews.values()) detachView(v);
  attachView(activeContentView);

  const viewMode = activeSessionId !== null
    ? (sessionViewMode.get(activeSessionId) ?? "desktop")
    : "desktop";
  const contentH = Math.max(0, winH - toolbarH);

  if (viewMode === "mobile" && rightW > MOBILE_VIEWPORT_WIDTH) {
    const mobileW = MOBILE_VIEWPORT_WIDTH;
    const mobileH = Math.min(contentH, MOBILE_VIEWPORT_HEIGHT);
    const centeredX = rightX + Math.round((rightW - mobileW) / 2);
    const centeredY = toolbarH + Math.round((contentH - mobileH) / 2);
    activeContentView.setBounds({
      x: centeredX,
      y: centeredY,
      width: mobileW,
      height: mobileH,
    });
  } else {
    activeContentView.setBounds({
      x: rightX,
      y: toolbarH,
      width: rightW,
      height: contentH,
    });
  }
}

// ── Toolbar helpers ─────────────────────────────────────────────────
function sendToToolbar(channel: string, ...args: unknown[]) {
  toolbarView?.webContents.send(channel, ...args);
}

function sendToApp(channel: string, ...args: unknown[]) {
  appView?.webContents.send(channel, ...args);
}

function sendTabsToToolbar() {
  if (activeSessionId === null) {
    sendToToolbar("toolbar:tabs-changed", []);
    return;
  }
  const mrUrls = sessionMrUrls.get(activeSessionId) ?? [];
  if (mrUrls.length === 0) {
    sendToToolbar("toolbar:tabs-changed", []);
    return;
  }
  const activeTab = sessionActiveTab.get(activeSessionId) ?? "app";
  const tabs = [
    { id: "app", label: "🌐 App", active: activeTab === "app" },
    ...mrUrls.map((url) => ({
      id: url,
      label: getMrLabel(url),
      active: activeTab === url,
    })),
  ];
  sendToToolbar("toolbar:tabs-changed", tabs);
}

// ── Content view lifecycle ──────────────────────────────────────────

/** Create a WebContentsView with standard event wiring for a session. */
function createBrowserView(sessionId: number): WebContentsView {
  const view = new WebContentsView({
    webPreferences: { sandbox: true },
  });
  view.setBackgroundColor("#0d1117");

  const wc = view.webContents;

  // Only update toolbar URL if this is the currently active view
  const onNavigate = (_e: unknown, navUrl: string) => {
    if (sessionId === activeSessionId && view === getActiveContentView()) {
      sendToToolbar("toolbar:url-changed", navUrl);
    }
  };
  wc.on("did-navigate", onNavigate as any);
  wc.on("did-navigate-in-page", onNavigate as any);

  wc.on("did-start-loading", () => {
    if (sessionId === activeSessionId && view === getActiveContentView())
      sendToToolbar("toolbar:loading-changed", true);
  });
  wc.on("did-stop-loading", () => {
    if (sessionId === activeSessionId && view === getActiveContentView())
      sendToToolbar("toolbar:loading-changed", false);
  });

  wc.setWindowOpenHandler(({ url: openUrl }) => {
    wc.loadURL(openUrl);
    return { action: "deny" };
  });

  wc.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown" || !input.control || !input.shift) return;
    const key = input.key.toUpperCase();
    const shortcutMap: Record<string, string> = {
      J: "next-session",
      K: "prev-session",
      B: "toggle-browser",
      N: "new-session",
      X: "kill-session",
      A: "revive-session",
      R: "rename-session",
      "?": "show-shortcuts",
    };
    const action = shortcutMap[key];
    if (action) {
      _e.preventDefault();
      sendToApp("devbench:shortcut", action);
    }
  });

  return view;
}

function getOrCreateAppView(sessionId: number, url?: string): WebContentsView {
  let view = sessionAppViews.get(sessionId);
  if (view) return view;
  view = createBrowserView(sessionId);
  sessionAppViews.set(sessionId, view);
  if (url) view.webContents.loadURL(url);
  return view;
}

function getOrCreateMrView(sessionId: number): WebContentsView {
  let view = sessionMrViews.get(sessionId);
  if (view) return view;
  view = createBrowserView(sessionId);
  sessionMrViews.set(sessionId, view);
  return view;
}

function destroySessionViews(sessionId: number) {
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
  if (activeSessionId === sessionId) activeSessionId = null;
}

// ── IPC: App → Main ─────────────────────────────────────────────────

ipcMain.on("devbench:toggle-browser", () => {
  browserOpen = !browserOpen;
  updateLayout();
  sendToApp("devbench:browser-toggled", browserOpen);
});

ipcMain.on(
  "devbench:session-changed",
  (_e, sessionId: number, projectId: number, browserUrl: string | null, defaultViewMode?: string, sessionBrowserOpen?: boolean, sessionViewModeVal?: string | null) => {
    activeSessionId = sessionId;
    activeProjectId = projectId;
    currentDefaultUrl = browserUrl || "";

    // Initialize view mode from session DB value, then project default
    if (!sessionViewMode.has(sessionId)) {
      sessionViewMode.set(sessionId, sessionViewModeVal || defaultViewMode || "desktop");
    }

    // Sync browser open state from session DB value
    const shouldBeOpen = !!(sessionBrowserOpen && browserUrl);
    if (shouldBeOpen !== browserOpen) {
      browserOpen = shouldBeOpen;
      sendToApp("devbench:browser-toggled", browserOpen);
    }

    if (browserUrl && browserOpen) {
      getOrCreateAppView(sessionId, browserUrl);
    }

    // Update toolbar with the current tab's URL
    const tab = sessionActiveTab.get(sessionId) ?? "app";
    let currentUrl: string;
    if (tab !== "app") {
      const mrV = sessionMrViews.get(sessionId);
      currentUrl = mrV?.webContents.getURL() || tab;
    } else {
      const wc = sessionAppViews.get(sessionId)?.webContents;
      currentUrl = wc?.getURL() || browserUrl || "";
    }
    sendToToolbar("toolbar:url-changed", currentUrl);
    sendToToolbar("toolbar:default-url-changed", currentDefaultUrl);
    sendToToolbar("toolbar:loading-changed",
      getActiveContentView()?.webContents.isLoading() ?? false);
    sendToToolbar("toolbar:view-mode-changed",
      sessionViewMode.get(sessionId) ?? "desktop");
    sendTabsToToolbar();

    updateLayout();
  }
);

ipcMain.on("devbench:session-destroyed", (_e, sessionId: number) => {
  destroySessionViews(sessionId);
  updateLayout();
});

ipcMain.on("devbench:navigate-to-url", (_e, sessionId: number, url: string, mrUrls: string[]) => {
  // Store MR URLs so the tab bar can render immediately
  if (mrUrls && mrUrls.length > 0) {
    sessionMrUrls.set(sessionId, mrUrls);
  }

  // Ensure app view exists (will get proper URL from session-changed shortly)
  if (!sessionAppViews.has(sessionId) && currentDefaultUrl) {
    getOrCreateAppView(sessionId, currentDefaultUrl);
  }

  // Navigate MR view
  const mrView = getOrCreateMrView(sessionId);
  mrView.webContents.loadURL(url);

  // Switch to MR tab
  sessionActiveTab.set(sessionId, url);
  activeSessionId = sessionId;

  if (!browserOpen) {
    browserOpen = true;
    sendToApp("devbench:browser-toggled", true);
  }

  sendToToolbar("toolbar:url-changed", url);
  sendTabsToToolbar();
  updateLayout();
});

ipcMain.on("devbench:update-mr-urls", (_e, sessionId: number, mrUrls: string[]) => {
  const prev = sessionMrUrls.get(sessionId);
  sessionMrUrls.set(sessionId, mrUrls);
  if (sessionId === activeSessionId) {
    // Only update layout/toolbar if the URLs actually changed
    const changed = JSON.stringify(prev) !== JSON.stringify(mrUrls);
    if (changed) {
      sendTabsToToolbar();
      updateLayout();
    }
  }
});

// ── IPC: App → Main (resize) ────────────────────────────────────────

ipcMain.on("devbench:resize-start", () => {
  isResizing = true;
  if (!win || !appView) return;
  const [winW, winH] = win.getContentSize();
  appView.setBounds({ x: 0, y: 0, width: winW, height: winH });
  if (toolbarView) detachView(toolbarView);
  for (const v of sessionAppViews.values()) detachView(v);
  for (const v of sessionMrViews.values()) detachView(v);
});

ipcMain.on("devbench:resize-end", (_e, clientX: number) => {
  if (!win) return;
  isResizing = false;
  const [winW] = win.getContentSize();
  const contentW = winW - SIDEBAR_WIDTH;
  if (contentW > 0) {
    splitPercent = ((clientX - SIDEBAR_WIDTH) / contentW) * 100;
  }
  updateLayout();
});

// ── IPC: Toolbar → Main ─────────────────────────────────────────────

ipcMain.on("toolbar:navigate", (_e, url: string) => {
  if (activeSessionId === null) return;
  const view = getActiveContentView() ?? getOrCreateAppView(activeSessionId);
  view.webContents.loadURL(url);
  if (!browserOpen) {
    browserOpen = true;
    sendToApp("devbench:browser-toggled", true);
  }
  updateLayout();
});

ipcMain.on("toolbar:back", () => {
  const wc = getActiveContentView()?.webContents;
  if (wc?.canGoBack()) wc.goBack();
});

ipcMain.on("toolbar:forward", () => {
  const wc = getActiveContentView()?.webContents;
  if (wc?.canGoForward()) wc.goForward();
});

ipcMain.on("toolbar:refresh", () => {
  getActiveContentView()?.webContents.reload();
});

ipcMain.on("toolbar:close", () => {
  browserOpen = false;
  updateLayout();
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
    sessionActiveTab.set(activeSessionId, "app");
    let av = sessionAppViews.get(activeSessionId);
    if (!av && currentDefaultUrl) {
      av = getOrCreateAppView(activeSessionId, currentDefaultUrl);
    }
    const url = av?.webContents.getURL() || currentDefaultUrl;
    sendToToolbar("toolbar:url-changed", url);
  } else {
    // MR tab
    const mrView = getOrCreateMrView(activeSessionId);
    const currentUrl = mrView.webContents.getURL();
    if (!currentUrl || currentUrl === "about:blank" || currentUrl !== tabId) {
      mrView.webContents.loadURL(tabId);
    }
    sessionActiveTab.set(activeSessionId, tabId);
    sendToToolbar("toolbar:url-changed", currentUrl && currentUrl !== "about:blank" ? currentUrl : tabId);
  }

  sendTabsToToolbar();
  updateLayout();
});

ipcMain.on("toolbar:set-view-mode", (_e, mode: string) => {
  if (activeSessionId === null) return;
  sessionViewMode.set(activeSessionId, mode);
  sendToToolbar("toolbar:view-mode-changed", mode);
  sendToApp("devbench:view-mode-changed", mode);
  updateLayout();
});

// ── Window creation ─────────────────────────────────────────────────
function createWindow() {
  win = new BaseWindow({
    width: 1400,
    height: 900,
    title: "Devbench",
    backgroundColor: "#010409",
  });

  appView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  appView.setBackgroundColor("#0d1117");
  attachView(appView);
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

  updateLayout();
  win.on("resize", updateLayout);

  appView.webContents.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown" || !input.control || !input.shift) return;
    const key = input.key.toUpperCase();
    const shortcutMap: Record<string, string> = {
      J: "next-session",
      K: "prev-session",
      B: "toggle-browser",
      N: "new-session",
      X: "kill-session",
      A: "revive-session",
      R: "rename-session",
      "?": "show-shortcuts",
    };
    const action = shortcutMap[key];
    if (action) {
      _e.preventDefault();
      sendToApp("devbench:shortcut", action);
    }
  });

  win.on("closed", () => {
    sessionAppViews.clear();
    sessionMrViews.clear();
    sessionActiveTab.clear();
    sessionMrUrls.clear();
    sessionViewMode.clear();
    attachedViews.clear();
    win = null;
    appView = null;
    toolbarView = null;
    activeSessionId = null;
  });
}

// ── App menu ────────────────────────────────────────────────────────
function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Devbench",
      submenu: [
        { label: "Next Session", accelerator: "CmdOrCtrl+Shift+J", click: () => sendToApp("devbench:shortcut", "next-session") },
        { label: "Previous Session", accelerator: "CmdOrCtrl+Shift+K", click: () => sendToApp("devbench:shortcut", "prev-session") },
        { label: "Toggle Browser", accelerator: "CmdOrCtrl+Shift+B", click: () => { browserOpen = !browserOpen; updateLayout(); sendToApp("devbench:browser-toggled", browserOpen); } },
        { label: "New Session", accelerator: "CmdOrCtrl+Shift+N", click: () => sendToApp("devbench:shortcut", "new-session") },
        { label: "Kill Session", accelerator: "CmdOrCtrl+Shift+X", click: () => sendToApp("devbench:shortcut", "kill-session") },
        { label: "Archived Sessions", accelerator: "CmdOrCtrl+Shift+A", click: () => sendToApp("devbench:shortcut", "revive-session") },
        { label: "Rename Session", accelerator: "CmdOrCtrl+Shift+R", click: () => sendToApp("devbench:shortcut", "rename-session") },
        { type: "separator" },
        { label: "Keyboard Shortcuts", accelerator: "CmdOrCtrl+Shift+/", click: () => sendToApp("devbench:shortcut", "show-shortcuts") },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" }, { role: "redo" }, { type: "separator" },
        { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Startup ─────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu();
  createWindow();
});

app.on("window-all-closed", () => app.quit());
