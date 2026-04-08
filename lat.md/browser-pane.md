# Browser Pane

Side-by-side browser panel for previewing web apps alongside the terminal. Supports two modes depending on the runtime environment.

## Web Mode

In the browser, the [[client/src/components/BrowserPane.tsx]] renders an `<iframe>` with an address bar, back/forward navigation, reload button, and a draggable split resizer.

The iframe URL is routed through the [[browser-pane#Reverse Proxy]] to avoid mixed-content issues and to enable [[browser-pane#Mobile Device Emulation]]. The address bar tracks the iframe's current URL via two mechanisms: `load` events for full page navigations (SSR apps) and a 200ms poll of `contentWindow.location` for SPA client-side navigations via `pushState`/`replaceState`. When a SPA's `pushState` strips the `/proxy/` (or `/proxy-mobile/`) prefix, `toDisplayUrl` reconstructs the full `http://host:port/path` URL from the known target origin (`defaultUrl` prop). Polling is suppressed while the URL input is focused so the user can type freely.

Home and manual address-bar navigation force `iframe.src` directly to ensure the iframe reloads even when `appSrc` React state is unchanged (e.g. SPA navigated away then Home is pressed). Supports fullscreen mode (`Ctrl+Shift+F` or toolbar button) which hides the terminal and gives the browser the full content area; the same shortcut toggles back to split pane.

The toolbar exposes a Desktop/Mobile view-mode toggle. In mobile mode, the `.browser-viewport-mobile` CSS class constrains the iframe to a 375×844 frame and the iframe src switches from the `/proxy/` prefix to the `/proxy-mobile/` prefix, which activates server-side [[browser-pane#Mobile Device Emulation]]. Toggling the mode reloads the iframe so the emulation script runs before page bootstrap.

## Electron Mode

In Electron, the browser pane uses a native `WebContentsView` managed by [[electron/view-manager.ts]].

This provides a real browser engine with full DevTools support. The toolbar (address bar, tabs, navigation) is rendered in a separate `WebContentsView` using `browser-toolbar.html` and communicates with the main process via IPC. Tabs include the project's browser URL and any MR/PR URLs detected for the active session.

## Reverse Proxy

The [[server/proxy.ts]] module proxies HTTP requests from `/proxy/<host>/<port>/...` or `/proxy-mobile/<host>/<port>/...` to `http://<host>:<port>/...`, solving the HTTPS mixed-content problem and providing a distinct entry point for mobile emulation.

For HTML responses, the proxy injects a script that patches `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource` to route requests through the proxy. The script also calls `history.replaceState` on load to strip the `/proxy/<host>/<port>` (or `/proxy-mobile/<host>/<port>`) prefix from `location.pathname`, so SPA routers (e.g. React Router) see clean paths like `/dashboard` instead of `/proxy/localhost/7770/dashboard`. URL rewrites preserve the current mode root so navigations stay in the same (desktop or mobile) emulation. The [[server/proxy.ts#parseProxyUrl]] function extracts host, port, path, and a `mobile` flag from either prefix.

When rewriting HTML, the proxy strips `content-length`, `content-encoding`, **and** `transfer-encoding` from the forwarded response headers before setting its own `content-length`. Stripping `transfer-encoding` is essential: if the upstream sent `transfer-encoding: chunked` and we only set `content-length`, Node's HTTP parser rejects the response with `HPE_INVALID_CONTENT_LENGTH` ("Content-Length can't be present with Transfer-Encoding") and the iframe silently fails to load.

The proxy also handles WebSocket upgrades for the same URL patterns, managed in [[server/websocket.ts#attachWebSocketServer]].

The [[client/public/sw.js]] service worker complements the proxy by intercepting same-origin subresource requests from a proxied iframe and redirecting them back through the appropriate proxy prefix. It detects the proxy context from the request's referrer (`getProxyPrefix` recognizes both `/proxy/` and `/proxy-mobile/`), preserves the mode root when rewriting cross-origin HTTP requests, and lets direct `/proxy/` and `/proxy-mobile/` URLs fall through to the network so the server reverse proxy can handle them. Both prefixes must be listed in the [[client#Client#Vite Dev Server]] proxy config so they reach the backend in development.

## Mobile Device Emulation

When the browser pane is toggled to Mobile view, the iframe src uses the `/proxy-mobile/` prefix and the server injects a device-emulation script that mirrors Chrome DevTools' device toolbar with touch enabled.

The server detects the mobile mode via the `mobile` flag on the parsed [[server/proxy.ts#parseProxyUrl]] result and, for HTML responses, injects the emulation script *before* the URL-rewriter patch so `navigator` mutations happen before the page's own bootstrap JS reads them.

The emulation script, built by [[server/proxy.ts#buildMobileEmulationScript]], covers six concerns:

* Overrides `navigator.userAgent`, `navigator.platform`, `navigator.vendor`, and `navigator.maxTouchPoints` to report an iPhone running mobile Safari, and assigns `null` to `window.ontouchstart`/`ontouchmove`/`ontouchend`/`ontouchcancel` so `'ontouchstart' in window` feature detection passes.
* Wraps `window.matchMedia` to force `(hover: none)`, `(any-hover: none)`, `(pointer: coarse)`, and `(any-pointer: coarse)` to match, and the opposite queries (`hover: hover`, `pointer: fine`) to not match.
* Injects a `<style data-devbench-mobile>` element that disables `user-select`, `-webkit-touch-callout`, and `-webkit-tap-highlight-color` site-wide, then re-enables `user-select` on `input`, `textarea`, `select`, and `[contenteditable]` so form editing still works. This is what prevents desktop mouse drags from highlighting text inside the emulated viewport.
* Installs capture-phase `mousedown`/`mousemove`/`mouseup`/`mouseleave` listeners that dispatch `PointerEvent`s with `pointerType: "touch"` and synthesize matching `TouchEvent`s (`touchstart`, `touchmove`, `touchend`, `touchcancel`) with one `Touch` point tracking the cursor. Only the left mouse button triggers synthesis, and drag state is tracked so subsequent `touchmove`/`touchend` events keep targeting the original `touchstart` target even if the cursor crosses into other elements. The originating mouse events have `preventDefault()` called on them (except when the target is a form field) so native drag-selection, focus-stealing, and HTML5 drag-and-drop ghosting stay out of the way.
* Because desktop Chromium typically throws "Illegal constructor" for `new Touch({…})` and `new TouchEvent(…)` when the native touch feature flag is off, the script probes the constructors once on startup and, if they refuse, falls back to `document.createEvent("UIEvent")` + `initUIEvent(…)` with `touches`/`targetTouches`/`changedTouches` attached via `Object.defineProperty`. Handlers registered via `addEventListener('touchstart', …)` still fire for these fallback events.
* Implements drag-to-scroll with inertia in JS, because synthetic touch events are not user gestures and Chromium's compositor won't translate them into native scroll the way it does for real finger input. On `mousedown` the script walks up from the target looking for the nearest scrollable ancestor per-axis (checking `getComputedStyle` `overflowX`/`overflowY` ∈ `{auto, scroll, overlay}` and `scrollHeight > clientHeight` / `scrollWidth > clientWidth`), falling back to `document.scrollingElement`. Each `mousemove` applies the inverse delta to the scroller's `scrollTop`/`scrollLeft` so dragging down reveals content above — matching mobile conventions. Recent deltas are buffered in a 100 ms window; on `mouseup` the averaged velocity drives a `requestAnimationFrame` inertia loop with exponential decay (time constant ≈ 325 ms), cut short by any subsequent `wheel` event.
* Axis-locks each gesture after the pointer moves more than 10 px from its start position, using a **1.5× dominance ratio** rather than picking whichever component is larger at the moment of the crossing. Lock to `x` requires `|dx| > 1.5 × |dy|`; lock to `y` requires `|dy| > 1.5 × |dx|`. When neither ratio is met — a near-diagonal drag, or a horizontal drag that begins with a few pixels of incidental downward motion (common on a real mouse) — the lock **tie-breaks toward whichever axis the innermost scrollable ancestor of the start target can actually scroll in**: `innerDirX && !innerDirY` locks `x`, `innerDirY && !innerDirX` locks `y`, otherwise the larger component wins. This is what makes horizontal scrolling work on e.g. a tab strip with `overflow-x: auto; overflow-y: hidden` even when the drag is not perfectly horizontal. The innermost scroll direction is captured at `mousedown` time by `detectInnerDir(target)`, which walks up the DOM and reports both axes of the first scrollable ancestor it finds. When the lock first engages, the cumulative movement up to that point is applied as a single jump so the scroller catches up without visible lag. Inertia is clamped to the locked axis by zeroing `vx` or `vy` before the momentum loop starts, so a horizontal flick on the tab strip never triggers vertical momentum on the body.
* If the page calls `preventDefault()` on the dispatched `touchmove` — the standard mobile opt-out for carousels, sliders, pull-to-refresh, custom swipe handlers — a `pageHandling` latch is set and auto-scroll plus inertia are skipped for the remainder of the gesture, so the page's own gesture logic wins. `dispatchTouch` returns the event's `defaultPrevented` flag to the handler for this purpose. The UIEvent fallback path uses `initUIEvent(type, true, true, …)` so it is cancelable, and `preventDefault()` propagates through `defaultPrevented` there as well.
* Suppresses the ghost `click` event that the browser would otherwise synthesize from `mousedown`+`mouseup` at the end of a drag gesture. A capture-phase `click` listener on `window` sets a `suppressClick` latch at `mouseup` time whenever the pointer moved more than 10 px from its start; the next `click` to arrive is swallowed with `stopImmediatePropagation()` + `preventDefault()` and the latch is cleared. A 500 ms `setTimeout` fallback clears the latch in case no click ever fires, so genuine taps (movement ≤ 10 px) continue to navigate normally.
* Adds capture-phase `selectstart` and `dragstart` listeners that call `preventDefault()` (form fields are exempt for `selectstart`) as a belt-and-braces defense against any text selection or HTML5 drag that slips past the CSS and mouse-event guards.
* Wraps each `Object.defineProperty` in `try`/`catch` so a single failure (e.g. a non-configurable property on a hardened page) doesn't abort the rest of the setup.

Toggling Mobile/Desktop in [[client/src/components/BrowserPane.tsx]] changes `viewMode`, which is a dependency of the iframe `src` effect — swapping the prefix reloads the iframe so the emulation script runs at the new document's initial parse. `toProxyUrl(url, mobile)` always proxies when `mobile` is true, even on HTTP origins where desktop mode would otherwise leave the URL unchanged, because emulation can only be injected by the proxy.

## Browser State Persistence

Each session stores its browser pane state (`browser_open`, `view_mode`) in the database. When switching sessions, the client restores the browser pane state. The state is managed by the [[client/src/hooks/useBrowserState.ts]] hook.

Toggling the browser open for a session that has no prior state requires the project's `browser_url` so the pane navigates to the homepage immediately. The `toggle` method accepts an optional default URL for this purpose; without it, a new entry would lack a URL and show a blank page.
