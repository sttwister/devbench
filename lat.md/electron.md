# Electron

Optional Electron desktop wrapper providing native browser views and system integration. Entry point: [[electron/main.ts]].

## Main Process

The [[electron/main.ts]] module creates a `BaseWindow` with two `WebContentsView` layers:

- **App view** — loads the devbench web UI (from `DEVBOX_URL`, defaulting to `http://localhost:3001`)
- **Toolbar view** — loads `browser-toolbar.html` for the browser pane's address bar and tab navigation

IPC handlers bridge communication between the renderer and the main process for browser pane control, navigation, tab management, and session state. When the browser is toggled open, the main process ensures the session's `WebContentsView` is created and loaded with the project's default URL so content is visible immediately.

## View Manager

The [[electron/view-manager.ts]] module manages the browser `WebContentsView` lifecycle:

- Creates and destroys browser views on demand
- Handles URL navigation, back/forward, reload
- Manages tab state (project URL tab + MR/PR URL tabs)
- Handles new-window requests by routing them to the appropriate view

## Layout

The [[electron/layout.ts]] module calculates view positions and sizes based on window dimensions, sidebar width, and split percentage between terminal and browser panes.

## Keyboard Shortcuts

The [[electron/shortcuts.ts]] module defines the Electron-specific keyboard shortcut map. Shortcuts are registered as global accelerators on the window and forwarded to the app view via IPC.

## Menu

The [[electron/menu.ts]] module builds the application menu with standard entries (Edit, View, Window) and devbench-specific actions.

## Preload Scripts

Two preload scripts provide the context bridge:

- [[electron/preload.ts]] — main app preload, exposes the `devbench` API object to the renderer
- [[electron/toolbar-preload.ts]] — toolbar preload, exposes toolbar-specific IPC methods
