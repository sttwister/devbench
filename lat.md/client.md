# Client

React 18 frontend built with Vite, providing the web-based UI for devbench. Entry point: [[client/src/App.tsx]].

## App Shell

The [[client/src/App.tsx]] component is the main application shell. It manages:

- Core state: projects, active session, agent statuses, orphaned session IDs
- UI state: sidebar visibility, popups/modals, dashboard mode, browser pane
- Polling: fetches project data and agent statuses every 3 seconds via [[client/src/api.ts#fetchPollData]]
- Wraps everything in a [[client/src/contexts/MrStatusContext.tsx#MrStatusProvider]] for MR status distribution

## Sidebar

The [[client/src/components/Sidebar.tsx]] renders the project and session navigation panel. Projects are rendered as collapsible groups via [[client/src/components/ProjectGroup.tsx]], each containing its active sessions as [[client/src/components/SessionItem.tsx]] entries.

Features:

- Drag-and-drop reordering for projects and sessions (via [[client/src/hooks/useSidebarDragAndDrop.ts]])
- Source URL badges and MR/PR status badges on sessions
- Agent status indicators (spinner for working, idle for waiting)
- Notification indicators for sessions needing attention (green left-border glow, pulsing dot) — see [[monitoring#Notifications]]
- Orphaned session indicators with revive buttons
- New session, settings, and archived sessions buttons per project

## Terminal

The [[client/src/components/TerminalPane.tsx]] renders the xterm.js terminal emulator. Terminal setup and WebSocket connection are managed by [[client/src/hooks/useTerminal.ts]] and [[client/src/hooks/useTerminalWebSocket.ts]].

Terminal features:

- Auto-focus when switching sessions ([[client/src/hooks/useTerminalAutoFocus.ts]])
- File upload via paste, drag-and-drop, and mobile button ([[client/src/hooks/useTerminalFileUpload.ts]])
- Touch scrolling on mobile ([[client/src/hooks/useTerminalTouchScroll.ts]])
- Swipe navigation between sessions ([[client/src/hooks/useSwipeNavigation.ts]])
- Mobile-responsive header: wraps into two rows on touch devices — session name and action buttons on row 1, source/MR badges on row 2

## Components

Key UI components:

- [[client/src/components/MainContent.tsx]] — central area containing terminal, browser pane, and diff pane
- [[client/src/components/BrowserPane.tsx]] — side-by-side browser panel (see [[browser-pane]])
- [[client/src/components/GitButlerDashboard.tsx]] — branch dashboard (see [[gitbutler#Dashboard UI]])
- [[client/src/components/DiffViewer.tsx]] — diff viewer with unified and side-by-side views, usable as dashboard overlay or split pane alongside terminal (see [[gitbutler#Diff Viewer]])
- [[client/src/components/MrBadge.tsx]] — color-coded MR/PR status badge
- [[client/src/components/NewSessionPopup.tsx]] — session creation dialog with type selection and source URL
- [[client/src/components/EditSessionPopup.tsx]] — session name, source URL, and MR link editor
- [[client/src/components/CloseSessionPopup.tsx]] — merge MRs + mark issue done + archive flow
- [[client/src/components/ArchivedSessionsPopup.tsx]] — browse and revive archived sessions
- [[client/src/components/SettingsModal.tsx]] — API token configuration for GitLab, GitHub, Linear
- [[client/src/components/MobileKeyboardBar.tsx]] — touch keyboard bar with special keys
- [[client/src/components/ShortcutsHelpPopup.tsx]] — keyboard shortcuts reference

## Hooks

Custom hooks organize reusable logic:

- [[client/src/hooks/useKeyboardShortcuts.ts]] — global keyboard shortcut handler
- [[client/src/hooks/useSessionNavigation.ts]] — next/previous session navigation
- [[client/src/hooks/useSessionActions.ts]] — session CRUD operations
- [[client/src/hooks/useProjectActions.ts]] — project CRUD operations
- [[client/src/hooks/useBrowserState.ts]] — browser pane open/close state per session
- [[client/src/hooks/useResizer.ts]] — draggable split resizer between terminal and browser
- [[client/src/hooks/useElectronBridge.ts]] — IPC bridge for Electron-specific features
- [[client/src/hooks/useMobileKeyboard.ts]] — mobile keyboard detection and management
- [[client/src/hooks/useMobileNativeInput.ts]] — native mobile input with dictation support. Defers composition flush for iOS Safari where `compositionend` fires before the DOM is updated, and flushes pending text at `compositionstart` to avoid losing characters between composition sessions.
- [[client/src/hooks/useEventSocket.ts]] — global events WebSocket connection with auto-reconnect (see [[client#Events WebSocket]])
- [[client/src/hooks/useNotifications.ts]] — notification utility functions: Web Audio ding sound, browser popup display, and localStorage preference helpers (see [[monitoring#Notifications]]). Event handling lives in [[client/src/App.tsx]].

## Events WebSocket

The [[client/src/hooks/useEventSocket.ts]] hook maintains a persistent WebSocket to `/ws/events` for real-time server push events with auto-reconnect.

Callers subscribe via `eventSocket.on(type, handler)`. Current event types: `agent-status`, `session-notified`, `notification-read`. Designed to absorb more poll data over time.

## Notifications

The [[client/src/hooks/useNotifications.ts]] module exports notification utility functions: sound playback, browser popup display, and localStorage preference helpers.

Two event handlers in [[client/src/App.tsx]] manage notifications. The `session-notified` handler adds sidebar glow; if the app is visible and the user is viewing the session, it marks read immediately — cancelling the server’s pending sound timer. The `session-notify-sound` handler (deferred 2s server-side, only sent if no client marked read) plays sound and shows native notifications unconditionally. Notifications use `ServiceWorkerRegistration.showNotification()` when available (required for Android PWA), falling back to `new Notification()` for desktop browsers. Clicking a notification navigates directly to the notified session — the service worker's `notificationclick` handler focuses the app window and sends a `postMessage` with the session ID; App.tsx listens for this message and calls `selectSession()`. If no window exists, `openWindow("/session/:id")` opens a fresh one. A generation counter guards against React Strict Mode duplicate handlers. A `visibilitychange` + `focus` listener auto-clears notifications when the app regains visibility. Preferences (sound, browser notifications) are stored in `localStorage` and toggled via the Notifications section in [[client/src/components/SettingsModal.tsx]].

## API Client

The [[client/src/api.ts]] module provides typed fetch wrappers for all REST API endpoints. It also re-exports shared types and utilities from `@devbench/shared` for convenient client-side imports.

## Platform Detection

The [[client/src/platform.ts]] module detects the runtime environment (web vs Electron) and provides the `devbench` bridge object for Electron IPC communication.
