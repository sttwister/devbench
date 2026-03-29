import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("devbench", {
  isElectron: true,

  /** Tell main process to toggle the browser panel. */
  toggleBrowser: () => ipcRenderer.send("devbench:toggle-browser"),

  /** Notify main process of active session change. */
  sessionChanged: (sessionId: number, projectId: number, browserUrl: string | null, defaultViewMode?: string, browserOpen?: boolean, viewMode?: string | null) =>
    ipcRenderer.send("devbench:session-changed", sessionId, projectId, browserUrl, defaultViewMode, browserOpen, viewMode),

  /** Notify main process that a session was deleted. */
  sessionDestroyed: (sessionId: number) =>
    ipcRenderer.send("devbench:session-destroyed", sessionId),

  /** Navigate a session's browser view to a specific URL (e.g. MR link). */
  navigateTo: (sessionId: number, url: string, mrUrls: string[]) =>
    ipcRenderer.send("devbench:navigate-to-url", sessionId, url, mrUrls),

  /** Send current MR URLs so the toolbar can render tabs. */
  updateMrUrls: (sessionId: number, mrUrls: string[]) =>
    ipcRenderer.send("devbench:update-mr-urls", sessionId, mrUrls),

  // ── Split-pane resize ─────────────────────────────────────────────

  /** Start resize — main process expands appView to full width. */
  resizeStart: () => ipcRenderer.send("devbench:resize-start"),

  /** Finish resize — main process applies the new split from clientX. */
  resizeEnd: (clientX: number) => ipcRenderer.send("devbench:resize-end", clientX),

  // ── Events from main → renderer ───────────────────────────────────

  /** Browser panel was toggled. */
  onBrowserToggled: (cb: (open: boolean) => void) => {
    const handler = (_e: unknown, open: boolean) => cb(open);
    ipcRenderer.on("devbench:browser-toggled", handler);
    return () => { ipcRenderer.removeListener("devbench:browser-toggled", handler); };
  },

  /** View mode changed from toolbar. */
  onViewModeChanged: (cb: (mode: string) => void) => {
    const handler = (_e: unknown, mode: string) => cb(mode);
    ipcRenderer.on("devbench:view-mode-changed", handler);
    return () => { ipcRenderer.removeListener("devbench:view-mode-changed", handler); };
  },

  /** Keyboard shortcut triggered. */
  onShortcut: (cb: (action: string) => void) => {
    const handler = (_e: unknown, action: string) => cb(action);
    ipcRenderer.on("devbench:shortcut", handler);
    return () => { ipcRenderer.removeListener("devbench:shortcut", handler); };
  },

  /** Server-side projects changed (e.g. browser URL saved from toolbar). */
  onProjectsChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("devbench:projects-changed", handler);
    return () => { ipcRenderer.removeListener("devbench:projects-changed", handler); };
  },
});
