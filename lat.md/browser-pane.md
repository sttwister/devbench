# Browser Pane

Side-by-side browser panel for previewing web apps alongside the terminal. Supports two modes depending on the runtime environment.

## Web Mode

In the browser, the [[client/src/components/BrowserPane.tsx]] renders an `<iframe>` with an address bar, back/forward navigation, reload button, and a draggable split resizer.

The iframe URL is routed through the [[browser-pane#Reverse Proxy]] to avoid mixed-content issues. The address bar tracks the iframe's current URL via two mechanisms: `load` events for full page navigations (SSR apps) and a 200ms poll of `contentWindow.location` for SPA client-side navigations via `pushState`/`replaceState`. When a SPA's `pushState` strips the `/proxy/` prefix, `toDisplayUrl` reconstructs the full `http://host:port/path` URL from the known target origin (`defaultUrl` prop). Polling is suppressed while the URL input is focused so the user can type freely.

Home and manual address-bar navigation force `iframe.src` directly to ensure the iframe reloads even when `appSrc` React state is unchanged (e.g. SPA navigated away then Home is pressed). Supports fullscreen mode (`Ctrl+Shift+F` or toolbar button) which hides the terminal and gives the browser the full content area; the same shortcut toggles back to split pane.

## Electron Mode

In Electron, the browser pane uses a native `WebContentsView` managed by [[electron/view-manager.ts]].

This provides a real browser engine with full DevTools support. The toolbar (address bar, tabs, navigation) is rendered in a separate `WebContentsView` using `browser-toolbar.html` and communicates with the main process via IPC. Tabs include the project's browser URL and any MR/PR URLs detected for the active session.

## Reverse Proxy

The [[server/proxy.ts]] module proxies HTTP requests from `/proxy/<host>/<port>/...` to `http://<host>:<port>/...`. This solves the mixed-content problem when devbench is served over HTTPS and browser-pane targets are plain HTTP dev servers.

For HTML responses, the proxy injects a script that patches `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource` to route requests through the proxy. The script also calls `history.replaceState` on load to strip the `/proxy/<host>/<port>` prefix from `location.pathname`, so SPA routers (e.g. React Router) see clean paths like `/dashboard` instead of `/proxy/localhost/7770/dashboard`. The [[server/proxy.ts#parseProxyUrl]] function extracts host, port, and path from the proxy URL pattern.

The proxy also handles WebSocket upgrades for the same URL pattern, managed in [[server/websocket.ts#attachWebSocketServer]].

## Browser State Persistence

Each session stores its browser pane state (`browser_open`, `view_mode`) in the database. When switching sessions, the client restores the browser pane state. The state is managed by the [[client/src/hooks/useBrowserState.ts]] hook.

Toggling the browser open for a session that has no prior state requires the project's `browser_url` so the pane navigates to the homepage immediately. The `toggle` method accepts an optional default URL for this purpose; without it, a new entry would lack a URL and show a blank page.
