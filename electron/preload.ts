import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("devbench", {
  isElectron: true,

  /** Tell main process to toggle the browser panel. */
  toggleBrowser: () => ipcRenderer.send("devbench:toggle-browser"),

  /** Notify main process of active session change. */
  sessionChanged: (sessionId: number, projectId: number, browserUrl: string | null) =>
    ipcRenderer.send("devbench:session-changed", sessionId, projectId, browserUrl),

  /** Notify main process that a session was deleted. */
  sessionDestroyed: (sessionId: number) =>
    ipcRenderer.send("devbench:session-destroyed", sessionId),

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
