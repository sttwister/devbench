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
- Notification glow indicator for sessions that finished work and need attention
- Orphaned session indicators with revive buttons
- New session, settings, and archived sessions buttons per project

## Terminal

The [[client/src/components/TerminalPane.tsx]] renders the xterm.js terminal emulator. Terminal setup and WebSocket connection are managed by [[client/src/hooks/useTerminal.ts]] and [[client/src/hooks/useTerminalWebSocket.ts]].

Terminal features:

- Auto-focus when switching sessions ([[client/src/hooks/useTerminalAutoFocus.ts]])
- File upload via paste, drag-and-drop, and mobile button ([[client/src/hooks/useTerminalFileUpload.ts]])
- Touch scrolling on mobile ([[client/src/hooks/useTerminalTouchScroll.ts]])
- Swipe navigation between sessions ([[client/src/hooks/useSwipeNavigation.ts]])

## Components

Key UI components:

- [[client/src/components/MainContent.tsx]] — central area containing terminal and browser pane
- [[client/src/components/BrowserPane.tsx]] — side-by-side browser panel (see [[browser-pane]])
- [[client/src/components/GitButlerDashboard.tsx]] — branch dashboard (see [[gitbutler#Dashboard UI]])
- [[client/src/components/DiffViewer.tsx]] — unified diff viewer for commits, branches, and unstaged changes (see [[gitbutler#Diff Viewer]])
- [[client/src/components/MrBadge.tsx]] — color-coded MR/PR status badge
- [[client/src/components/NewSessionPopup.tsx]] — session creation dialog with type selection and source URL
- [[client/src/components/EditSessionPopup.tsx]] — source URL and MR link editor
- [[client/src/components/CloseSessionPopup.tsx]] — merge MRs + mark issue done + archive flow
- [[client/src/components/ArchivedSessionsPopup.tsx]] — browse and revive archived sessions
- [[client/src/components/SettingsModal.tsx]] — API token configuration and notification preferences
- [[client/src/components/MobileKeyboardBar.tsx]] — touch keyboard bar with special keys
- [[client/src/components/ShortcutsHelpPopup.tsx]] — keyboard shortcuts reference

## Hooks

Custom hooks organize reusable logic:

- [[client/src/hooks/useKeyboardShortcuts.ts]] — global keyboard shortcut handler
- [[client/src/hooks/useSessionNavigation.ts]] — next/previous session navigation
- [[client/src/hooks/useSessionActions.ts]] — session CRUD operations
- [[client/src/hooks/useProjectActions.ts]] — project CRUD operations
- [[client/src/hooks/useBrowserState.ts]] — browser pane open/close state per session
- [[client/src/hooks/useNotifications.ts]] — agent status transition tracking, browser notifications, and sound
- [[client/src/hooks/useResizer.ts]] — draggable split resizer between terminal and browser
- [[client/src/hooks/useElectronBridge.ts]] — IPC bridge for Electron-specific features
- [[client/src/hooks/useMobileKeyboard.ts]] — mobile keyboard detection and management
- [[client/src/hooks/useMobileNativeInput.ts]] — native mobile input with dictation support

## API Client

The [[client/src/api.ts]] module provides typed fetch wrappers for all REST API endpoints. It also re-exports shared types and utilities from `@devbench/shared` for convenient client-side imports.

## Notifications

The [[client/src/hooks/useNotifications.ts]] hook tracks agent status transitions and fires native browser notifications when a session changes from "working" to "waiting". It also plays a short ding sound via the Web Audio API.

The currently active session is always excluded from notifications — the user is already looking at it. Notifications are also suppressed after explicit user actions like Ctrl+Shift+G (commit-push) via the `suppressNext(sessionId)` method. Sessions that triggered a notification show a pulsing glow indicator in the [[client#Sidebar]] until the user selects them.

On mobile (where the sidebar is hidden), the hamburger menu button in [[client/src/components/MainContent.tsx]] pulses green when any session has a pending notification, signaling there's work to review in other sessions. The ding sound also plays on mobile when the app is in the foreground.

Both notification and sound toggles are stored in localStorage and configurable in [[client/src/components/SettingsModal.tsx]].

## Platform Detection

The [[client/src/platform.ts]] module detects the runtime environment (web vs Electron) and provides the `devbench` bridge object for Electron IPC communication.
