import { Menu } from "electron";

/**
 * Build the application menu.
 * @param sendToApp  Send an IPC message to the renderer.
 * @param toggleBrowser  Toggle the browser panel (updates state + layout).
 */
export function buildMenu(
  sendToApp: (channel: string, ...args: unknown[]) => void,
  toggleBrowser: () => void
) {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Devbench",
      submenu: [
        { label: "Next Session", accelerator: "CmdOrCtrl+Shift+J", click: () => sendToApp("devbench:shortcut", "next-session") },
        { label: "Previous Session", accelerator: "CmdOrCtrl+Shift+K", click: () => sendToApp("devbench:shortcut", "prev-session") },
        { label: "Toggle Browser", accelerator: "CmdOrCtrl+Shift+B", click: toggleBrowser },
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
