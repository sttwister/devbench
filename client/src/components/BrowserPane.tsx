import { useState, useRef, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import Icon from "./Icon";

// ── Proxy URL helpers ───────────────────────────────────────────────
// When devbench is served over HTTPS, HTTP iframe targets are blocked
// (mixed content).  Route them through the server-side reverse proxy.

/** Convert an http:// URL to a /proxy/HOST/PORT/path URL (HTTPS only). */
function toProxyUrl(url: string): string {
  if (typeof window === "undefined" || window.location.protocol !== "https:") return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:") {
      return `/proxy/${parsed.hostname}/${parsed.port || "80"}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch { /* not a valid URL */ }
  return url;
}

/** Convert a /proxy/HOST/PORT/path URL back to the original http:// form. */
function fromProxyPath(path: string): string {
  const m = path.match(/^\/proxy\/([^/]+)\/(\d+)(.*)/);
  if (m) {
    const [, host, port, rest] = m;
    return `http://${host}${port !== "80" ? ":" + port : ""}${rest || "/"}`;
  }
  return path;
}

/**
 * Convert an iframe path to a full display URL for the address bar.
 * Handles both proxy paths (/proxy/HOST/PORT/...) and bare paths left
 * by SPA pushState navigation that stripped the proxy prefix.
 */
function toDisplayUrl(path: string, targetUrl: string): string {
  const decoded = fromProxyPath(path);
  if (decoded !== path) return decoded;
  // SPA pushState replaced the proxy path; reconstruct from the known target
  try {
    const u = new URL(targetUrl);
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return path;
  }
}

// ── Component ───────────────────────────────────────────────────────

interface Props {
  url: string;
  defaultUrl: string;
  viewMode: "desktop" | "mobile";
  visible?: boolean;
  fullscreen?: boolean;
  onClose: () => void;
  onViewModeChange: (mode: "desktop" | "mobile") => void;
  onToggleFullscreen?: () => void;
  headerLeft?: ReactNode;
}

export default function BrowserPane({
  url,
  defaultUrl,
  viewMode,
  visible = true,
  fullscreen,
  onClose,
  onViewModeChange,
  onToggleFullscreen,
  headerLeft,
}: Props) {
  const [appSrc, setAppSrc] = useState(toProxyUrl(url));
  const [inputUrl, setInputUrl] = useState(url);
  const appIframeRef = useRef<HTMLIFrameElement>(null);
  const editingUrlRef = useRef(false);

  // Reset when the initial url prop changes (session switch / remount)
  useEffect(() => {
    setAppSrc(toProxyUrl(url));
    setInputUrl(url);
  }, [url]);

  // Update URL bar when the iframe navigates.
  // Through the proxy the iframe is same-origin, so we can read its URL
  // and translate it back to the original http:// form for display.
  // The `load` event only fires on full page loads (works for SSR apps),
  // so we also poll for SPA apps that navigate via pushState/replaceState.
  // Polling is suppressed while the user is editing the URL input.
  useEffect(() => {
    const iframe = appIframeRef.current;
    if (!iframe) return;
    let lastPath = "";
    const syncUrl = () => {
      if (editingUrlRef.current) return;
      try {
        const loc = iframe.contentWindow?.location;
        if (!loc || loc.href === "about:blank") return;
        const path = loc.pathname + loc.search + loc.hash;
        if (path !== lastPath) {
          lastPath = path;
          setInputUrl(toDisplayUrl(path, defaultUrl));
        }
      } catch {
        // Cross-origin — keep showing the last URL we navigated to
      }
    };
    iframe.addEventListener("load", syncUrl);
    const pollId = setInterval(syncUrl, 200);
    return () => {
      iframe.removeEventListener("load", syncUrl);
      clearInterval(pollId);
    };
  }, [appSrc, defaultUrl]);

  const handleNavigate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      editingUrlRef.current = false;
      let nav = inputUrl.trim();
      if (!nav) return;
      if (!/^https?:\/\//i.test(nav)) nav = "http://" + nav;
      const proxied = toProxyUrl(nav);
      setAppSrc(proxied);
      setInputUrl(nav);
      // Force iframe navigation even if appSrc didn't change
      const iframe = appIframeRef.current;
      if (iframe) iframe.src = proxied;
    },
    [inputUrl]
  );

  const handleHome = useCallback(() => {
    const proxied = toProxyUrl(defaultUrl);
    setAppSrc(proxied);
    setInputUrl(defaultUrl);
    // Force iframe navigation even if appSrc was already the home URL
    const iframe = appIframeRef.current;
    if (iframe) iframe.src = proxied;
  }, [defaultUrl]);

  const handleRefresh = useCallback(() => {
    const iframe = appIframeRef.current;
    if (iframe) {
      const src = iframe.src;
      iframe.src = "";
      requestAnimationFrame(() => {
        if (iframe) iframe.src = src;
      });
    }
  }, []);

  // Open external uses the display URL so the user gets the real target
  const handleOpenExternal = useCallback(() => {
    const target = inputUrl.trim() || url;
    if (target) window.open(target, "_blank");
  }, [inputUrl, url]);

  return (
    <div className={`browser-pane${visible ? "" : " browser-pane-hidden"}`}>
      <div className="browser-toolbar">
        {headerLeft}
        <button
          className="browser-toolbar-btn"
          onClick={handleHome}
          title="Home"
        >
          <Icon name="home" size={15} />
        </button>
        <button
          className="browser-toolbar-btn"
          onClick={handleRefresh}
          title="Refresh"
        >
          <Icon name="rotate-cw" size={15} />
        </button>
        <form className="browser-url-form" onSubmit={handleNavigate}>
          <input
            className="browser-url-input"
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onFocus={() => { editingUrlRef.current = true; }}
            onBlur={() => { editingUrlRef.current = false; }}
            placeholder="Enter URL..."
            spellCheck={false}
          />
        </form>
        <div className="browser-view-toggle">
          <button
            className={`browser-view-toggle-btn${viewMode === "desktop" ? " active" : ""}`}
            onClick={() => onViewModeChange("desktop")}
            title="Desktop view"
          >
            <Icon name="monitor" size={14} />
          </button>
          <button
            className={`browser-view-toggle-btn${viewMode === "mobile" ? " active" : ""}`}
            onClick={() => onViewModeChange("mobile")}
            title="Mobile view"
          >
            <Icon name="smartphone" size={14} />
          </button>
        </div>
        {onToggleFullscreen && (
          <button
            className={`browser-toolbar-btn browser-fullscreen-btn${fullscreen ? " active" : ""}`}
            onClick={onToggleFullscreen}
            title={fullscreen ? "Split pane (Ctrl+Shift+F)" : "Fullscreen (Ctrl+Shift+F)"}
          >
            <Icon name={fullscreen ? "minimize-2" : "maximize-2"} size={15} />
          </button>
        )}
        <button
          className="browser-toolbar-btn"
          onClick={handleOpenExternal}
          title="Open in new tab"
        >
          <Icon name="external-link" size={15} />
        </button>
        <button
          className="browser-toolbar-btn browser-close-btn"
          onClick={onClose}
          title="Close browser (Ctrl+Shift+B)"
        >
          <Icon name="x" size={15} />
        </button>
      </div>

      <div className={`browser-viewport${viewMode === "mobile" ? " browser-viewport-mobile" : ""}`}>
        <iframe
          ref={appIframeRef}
          className="browser-iframe"
          src={appSrc}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
