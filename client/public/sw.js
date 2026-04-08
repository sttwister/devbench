// Devbench Service Worker
// Provides PWA installability, basic network-first caching for app shell
// assets, and proxy URL rewriting for browser-pane iframes.

const CACHE_NAME = "devbench-v5";

// App shell assets to pre-cache on install
const APP_SHELL = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

// ── Install: pre-cache app shell ──────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Proxy helper: extract /proxy(-mobile)/HOST/PORT prefix from a referrer ──
// Returns the full prefix including the mode root so the caller can preserve
// desktop vs. mobile emulation across rewritten subresource requests.
function getProxyPrefix(referrer) {
  if (!referrer) return null;
  try {
    var url = new URL(referrer);
    var m = url.pathname.match(/^(\/proxy(?:-mobile)?\/[^/]+\/\d+)/);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

// Return the mode root ("/proxy" or "/proxy-mobile") for a parsed prefix.
function getModeRoot(prefix) {
  return prefix.indexOf("/proxy-mobile/") === 0 ? "/proxy-mobile" : "/proxy";
}

/**
 * Respond with a redirect to the proxied URL.
 * Using a redirect (rather than a transparent fetch) ensures the browser
 * updates the resource's identity URL so that subsequent Referer headers
 * keep the /proxy/ prefix — this preserves the rewrite chain for ES
 * module imports, CSS sub-resources, etc.
 *
 * 307 is used to preserve the HTTP method (important for POST forms).
 */
function proxyRedirect(event, targetPath) {
  var targetUrl = new URL(targetPath, self.location.origin).href;
  event.respondWith(Response.redirect(targetUrl, 307));
}

// ── Notification click: open/focus app and navigate to session ────
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var sessionId = event.notification.data && event.notification.data.sessionId;
  var targetUrl = sessionId ? "/session/" + sessionId : "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        // Try to find and focus an existing app window
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ("focus" in client) {
            return client.focus().then(function () {
              // Tell the app to navigate to the session
              client.postMessage({
                type: "notification-click",
                sessionId: sessionId,
              });
            });
          }
        }
        // No existing window — open a new one at the session URL
        return self.clients.openWindow(targetUrl);
      })
  );
});

// ── Fetch: proxy rewriting + caching ──────────────────────────────
self.addEventListener("fetch", (event) => {
  var request = event.request;
  var url = new URL(request.url);

  // ── 1. Direct proxy requests → let the server handle them ──────
  // Both /proxy/ and /proxy-mobile/ are reverse-proxy entry points; the
  // server distinguishes them and injects mobile device emulation for the
  // latter.  See [[browser-pane#Mobile Device Emulation]].
  if (
    url.pathname.startsWith("/proxy/") ||
    url.pathname.startsWith("/proxy-mobile/")
  ) {
    return; // fall through to network
  }

  // ── 2. Requests from a proxied iframe → rewrite URL ───────────
  var proxyPrefix = getProxyPrefix(request.referrer);
  if (proxyPrefix) {
    // Same-origin absolute path (e.g. /src/main.tsx from the iframe)
    if (url.origin === self.location.origin) {
      proxyRedirect(event, proxyPrefix + url.pathname + url.search);
      return;
    }
    // HTTP cross-origin URL from a proxy context → route through proxy.
    // Preserve the mode root so a mobile-emulated iframe stays in mobile
    // mode when it loads a sibling http:// origin.
    if (url.protocol === "http:") {
      var prefix =
        getModeRoot(proxyPrefix) + "/" + url.hostname + "/" + (url.port || "80");
      proxyRedirect(event, prefix + url.pathname + url.search);
      return;
    }
    // Anything else (https cross-origin, data:, blob:) → pass through
  }

  // ── 3. Original devbench caching logic ─────────────────────────

  // Skip non-GET, WebSocket upgrade, and API requests
  if (
    request.method !== "GET" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws")
  ) {
    return;
  }

  // Hashed assets (e.g. /assets/index-C1yqtY6F.js) — cache-first
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            var clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          })
      )
    );
    return;
  }

  // Everything else (HTML, icons, manifest) — network-first with cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        var clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
