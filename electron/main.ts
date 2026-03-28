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
const TOOLBAR_HEIGHT = 41;
const RESIZER_WIDTH = 4;
const SIDEBAR_WIDTH = 260;       // must match CSS --sidebar-w
const MIN_PANEL_WIDTH = 200;     // min terminal / browser content width

// ── State ───────────────────────────────────────────────────────────
let win: BaseWindow | null = null;
let appView: WebContentsView | null = null;
let toolbarView: WebContentsView | null = null;

const sessionViews = new Map<number, WebContentsView>();
let activeSessionId: number | null = null;
let activeProjectId: number | null = null;
let currentDefaultUrl = "";
let browserOpen = false;
let splitPercent = 50;           // % of content area (excl. sidebar) for terminal
let isResizing = false;

// Track which views are currently attached to the window
const attachedViews = new Set<WebContentsView>();

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

// ── Layout ──────────────────────────────────────────────────────────
// splitPercent is the fraction of the *content area* (window minus sidebar)
// that goes to the terminal. The sidebar is always SIDEBAR_WIDTH.
function updateLayout() {
  if (!win || !appView) return;
  const [winW, winH] = win.getContentSize();

  const activeContentView =
    activeSessionId !== null ? sessionViews.get(activeSessionId) : null;

  if (!browserOpen || !activeContentView) {
    // App fills entire window
    appView.setBounds({ x: 0, y: 0, width: winW, height: winH });
    // Detach browser views
    if (toolbarView) detachView(toolbarView);
    for (const v of sessionViews.values()) detachView(v);
    return;
  }

  const contentW = winW - SIDEBAR_WIDTH;

  // Clamp so both terminal and browser panels have minimum width
  const minPct = (MIN_PANEL_WIDTH / contentW) * 100;
  const maxPct = ((contentW - MIN_PANEL_WIDTH - RESIZER_WIDTH) / contentW) * 100;
  const clamped = Math.max(minPct, Math.min(maxPct, splitPercent));

  const terminalW = Math.round(contentW * clamped / 100);
  const appW = SIDEBAR_WIDTH + terminalW;
  const rightX = appW + RESIZER_WIDTH;
  const rightW = Math.max(0, winW - rightX);

  // Left panel: React app (sidebar + terminal + resizer at right edge)
  appView.setBounds({ x: 0, y: 0, width: appW, height: winH });

  // Right panel: toolbar + content
  if (toolbarView) {
    attachView(toolbarView);
    toolbarView.setBounds({ x: rightX, y: 0, width: rightW, height: TOOLBAR_HEIGHT });
  }

  // Detach all content views, then attach only the active one
  for (const v of sessionViews.values()) detachView(v);
  attachView(activeContentView);
  activeContentView.setBounds({
    x: rightX,
    y: TOOLBAR_HEIGHT,
    width: rightW,
    height: Math.max(0, winH - TOOLBAR_HEIGHT),
  });
}

// ── Toolbar helpers ─────────────────────────────────────────────────
function sendToToolbar(channel: string, ...args: unknown[]) {
  toolbarView?.webContents.send(channel, ...args);
}

function sendToApp(channel: string, ...args: unknown[]) {
  appView?.webContents.send(channel, ...args);
}

// ── Content view lifecycle ──────────────────────────────────────────
function getOrCreateContentView(sessionId: number, url?: string): WebContentsView {
  let view = sessionViews.get(sessionId);
  if (view) return view;

  view = new WebContentsView({
    webPreferences: { sandbox: true },
  });
  view.setBackgroundColor("#0d1117");
  sessionViews.set(sessionId, view);

  const wc = view.webContents;

  // Navigation tracking → update toolbar URL bar
  const onNavigate = (_e: unknown, navUrl: string) => {
    if (sessionId === activeSessionId) {
      sendToToolbar("toolbar:url-changed", navUrl);
    }
  };
  wc.on("did-navigate", onNavigate as any);
  wc.on("did-navigate-in-page", onNavigate as any);

  // Loading state → update toolbar spinner
  wc.on("did-start-loading", () => {
    if (sessionId === activeSessionId) sendToToolbar("toolbar:loading-changed", true);
  });
  wc.on("did-stop-loading", () => {
    if (sessionId === activeSessionId) sendToToolbar("toolbar:loading-changed", false);
  });

  // Block new-window, navigate in-place
  wc.setWindowOpenHandler(({ url: openUrl }) => {
    wc.loadURL(openUrl);
    return { action: "deny" };
  });

  // Forward keyboard shortcuts from browser content to app
  wc.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown" || !input.control || !input.shift) return;
    const key = input.key.toUpperCase();
    const shortcutMap: Record<string, string> = {
      J: "next-session",
      K: "prev-session",
      B: "toggle-browser",
      N: "new-session",
      X: "kill-session",
      R: "rename-session",
      "?": "show-shortcuts",
    };
    const action = shortcutMap[key];
    if (action) {
      _e.preventDefault();
      sendToApp("devbench:shortcut", action);
    }
  });

  if (url) wc.loadURL(url);
  return view;
}

function destroyContentView(sessionId: number) {
  const view = sessionViews.get(sessionId);
  if (!view) return;
  detachView(view);
  (view.webContents as any).destroy?.();
  sessionViews.delete(sessionId);
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
  (_e, sessionId: number, projectId: number, browserUrl: string | null) => {
    activeSessionId = sessionId;
    activeProjectId = projectId;
    currentDefaultUrl = browserUrl || "";

    if (browserUrl && browserOpen) {
      getOrCreateContentView(sessionId, browserUrl);
    }

    // Update toolbar with new session's URL
    const wc = sessionViews.get(sessionId)?.webContents;
    const currentUrl = wc?.getURL() || browserUrl || "";
    sendToToolbar("toolbar:url-changed", currentUrl);
    sendToToolbar("toolbar:default-url-changed", currentDefaultUrl);
    sendToToolbar("toolbar:loading-changed", wc?.isLoading() ?? false);

    updateLayout();
  }
);

ipcMain.on("devbench:session-destroyed", (_e, sessionId: number) => {
  destroyContentView(sessionId);
  updateLayout();
});

// ── IPC: App → Main (resize) ────────────────────────────────────────

ipcMain.on("devbench:resize-start", () => {
  isResizing = true;
  if (!win || !appView) return;
  // Expand appView to full width so pointer capture keeps working
  const [winW, winH] = win.getContentSize();
  appView.setBounds({ x: 0, y: 0, width: winW, height: winH });
  // Detach browser views so they don't steal mouse events
  if (toolbarView) detachView(toolbarView);
  for (const v of sessionViews.values()) detachView(v);
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
  const view = getOrCreateContentView(activeSessionId);
  view.webContents.loadURL(url);
  if (!browserOpen) {
    browserOpen = true;
    sendToApp("devbench:browser-toggled", true);
  }
  updateLayout();
});

ipcMain.on("toolbar:back", () => {
  if (activeSessionId === null) return;
  const wc = sessionViews.get(activeSessionId)?.webContents;
  if (wc?.canGoBack()) wc.goBack();
});

ipcMain.on("toolbar:forward", () => {
  if (activeSessionId === null) return;
  const wc = sessionViews.get(activeSessionId)?.webContents;
  if (wc?.canGoForward()) wc.goForward();
});

ipcMain.on("toolbar:refresh", () => {
  if (activeSessionId === null) return;
  sessionViews.get(activeSessionId)?.webContents.reload();
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

// ── Window creation ─────────────────────────────────────────────────
function createWindow() {
  win = new BaseWindow({
    width: 1400,
    height: 900,
    title: "Devbench",
  });

  // App view (React UI from server)
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

  // Browser toolbar view (local HTML)
  toolbarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "toolbar-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  toolbarView.setBackgroundColor("#161b22");
  toolbarView.webContents.loadFile(path.join(__dirname, "browser-toolbar.html"));

  // Initial layout (app fills window)
  updateLayout();

  // Re-layout on window resize
  win.on("resize", updateLayout);

  // Keyboard shortcuts from the app view
  appView.webContents.on("before-input-event", (_e, input) => {
    if (input.type !== "keyDown" || !input.control || !input.shift) return;
    const key = input.key.toUpperCase();
    const shortcutMap: Record<string, string> = {
      J: "next-session",
      K: "prev-session",
      B: "toggle-browser",
      N: "new-session",
      X: "kill-session",
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
    sessionViews.clear();
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
        {
          label: "Next Session",
          accelerator: "CmdOrCtrl+Shift+J",
          click: () => sendToApp("devbench:shortcut", "next-session"),
        },
        {
          label: "Previous Session",
          accelerator: "CmdOrCtrl+Shift+K",
          click: () => sendToApp("devbench:shortcut", "prev-session"),
        },
        {
          label: "Toggle Browser",
          accelerator: "CmdOrCtrl+Shift+B",
          click: () => {
            browserOpen = !browserOpen;
            updateLayout();
            sendToApp("devbench:browser-toggled", browserOpen);
          },
        },
        {
          label: "New Session",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => sendToApp("devbench:shortcut", "new-session"),
        },
        {
          label: "Kill Session",
          accelerator: "CmdOrCtrl+Shift+X",
          click: () => sendToApp("devbench:shortcut", "kill-session"),
        },
        {
          label: "Rename Session",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => sendToApp("devbench:shortcut", "rename-session"),
        },
        { type: "separator" },
        {
          label: "Keyboard Shortcuts",
          accelerator: "CmdOrCtrl+Shift+/",
          click: () => sendToApp("devbench:shortcut", "show-shortcuts"),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
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
