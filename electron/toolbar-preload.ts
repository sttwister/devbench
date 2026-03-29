import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("toolbarAPI", {
  navigate: (url: string) => ipcRenderer.send("toolbar:navigate", url),
  goBack: () => ipcRenderer.send("toolbar:back"),
  goForward: () => ipcRenderer.send("toolbar:forward"),
  refresh: () => ipcRenderer.send("toolbar:refresh"),
  close: () => ipcRenderer.send("toolbar:close"),
  saveUrl: (url: string) => ipcRenderer.send("toolbar:save-url", url),
  switchTab: (tabId: string) => ipcRenderer.send("toolbar:switch-tab", tabId),
  setViewMode: (mode: string) => ipcRenderer.send("toolbar:set-view-mode", mode),

  onUrlChanged: (cb: (url: string) => void) => {
    const handler = (_e: unknown, url: string) => cb(url);
    ipcRenderer.on("toolbar:url-changed", handler);
    return () => { ipcRenderer.removeListener("toolbar:url-changed", handler); };
  },
  onLoadingChanged: (cb: (loading: boolean) => void) => {
    const handler = (_e: unknown, loading: boolean) => cb(loading);
    ipcRenderer.on("toolbar:loading-changed", handler);
    return () => { ipcRenderer.removeListener("toolbar:loading-changed", handler); };
  },
  onDefaultUrlChanged: (cb: (url: string) => void) => {
    const handler = (_e: unknown, url: string) => cb(url);
    ipcRenderer.on("toolbar:default-url-changed", handler);
    return () => { ipcRenderer.removeListener("toolbar:default-url-changed", handler); };
  },
  onTabsChanged: (cb: (tabs: Array<{id: string, label: string, active: boolean}>) => void) => {
    const handler = (_e: unknown, tabs: Array<{id: string, label: string, active: boolean}>) => cb(tabs);
    ipcRenderer.on("toolbar:tabs-changed", handler);
    return () => { ipcRenderer.removeListener("toolbar:tabs-changed", handler); };
  },
  onViewModeChanged: (cb: (mode: string) => void) => {
    const handler = (_e: unknown, mode: string) => cb(mode);
    ipcRenderer.on("toolbar:view-mode-changed", handler);
    return () => { ipcRenderer.removeListener("toolbar:view-mode-changed", handler); };
  },
});
