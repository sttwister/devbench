import { useState, useRef, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import Icon from "./Icon";

interface Props {
  url: string;
  defaultUrl: string;
  viewMode: "desktop" | "mobile";
  visible?: boolean;
  onClose: () => void;
  onViewModeChange: (mode: "desktop" | "mobile") => void;
  headerLeft?: ReactNode;
}

export default function BrowserPane({
  url,
  defaultUrl,
  viewMode,
  visible = true,
  onClose,
  onViewModeChange,
  headerLeft,
}: Props) {
  const [appSrc, setAppSrc] = useState(url);
  const [inputUrl, setInputUrl] = useState(url);
  const appIframeRef = useRef<HTMLIFrameElement>(null);

  // Reset when the initial url prop changes (session switch / remount)
  useEffect(() => {
    setAppSrc(url);
    setInputUrl(url);
  }, [url]);

  // Update URL bar when app iframe navigates (same-origin only)
  useEffect(() => {
    const iframe = appIframeRef.current;
    if (!iframe) return;
    const handleLoad = () => {
      try {
        const u = iframe.contentWindow?.location.href;
        if (u && u !== "about:blank") setInputUrl(u);
      } catch {
        // Cross-origin — keep showing the last URL we navigated to
      }
    };
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [appSrc]);

  const handleNavigate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      let nav = inputUrl.trim();
      if (!nav) return;
      if (!/^https?:\/\//i.test(nav)) nav = "http://" + nav;
      setAppSrc(nav);
      setInputUrl(nav);
    },
    [inputUrl]
  );

  const handleHome = useCallback(() => {
    setAppSrc(defaultUrl);
    setInputUrl(defaultUrl);
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

  const handleOpenExternal = useCallback(() => {
    const target = inputUrl.trim() || appSrc;
    if (target) window.open(target, "_blank");
  }, [inputUrl, appSrc]);

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
