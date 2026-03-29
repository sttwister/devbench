import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("toolbarAPI", {
  navigate: (url: string) => ipcRenderer.send("toolbar:navigate", url),
  goBack: () => ipcRenderer.send("toolbar:back"),
  goForward: () => ipcRenderer.send("toolbar:forward"),
  refresh: () => ipcRenderer.send("toolbar:refresh"),
  close: () => ipcRenderer.send("toolbar:close"),
  saveUrl: (url: string) => ipcRenderer.send("toolbar:save-url", url),
  switchTab: (tabId: string) => ipcRenderer.send("toolbar:switch-tab", tabId),

  onUrlChanged: (cb: (url: string) => void) => {
    ipcRenderer.on("toolbar:url-changed", (_e, url) => cb(url));
  },
  onLoadingChanged: (cb: (loading: boolean) => void) => {
    ipcRenderer.on("toolbar:loading-changed", (_e, loading) => cb(loading));
  },
  onDefaultUrlChanged: (cb: (url: string) => void) => {
    ipcRenderer.on("toolbar:default-url-changed", (_e, url) => cb(url));
  },
  onTabsChanged: (cb: (tabs: Array<{id: string, label: string, active: boolean}>) => void) => {
    ipcRenderer.on("toolbar:tabs-changed", (_e, tabs) => cb(tabs));
  },
});
