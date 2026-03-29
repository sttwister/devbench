import { useState, useRef, useCallback, useEffect } from "react";
import type { ReactNode } from "react";

interface Props {
  url: string;
  defaultUrl: string;
  visible?: boolean;
  onClose: () => void;
  headerLeft?: ReactNode;
}

export default function BrowserPane({
  url,
  defaultUrl,
  visible = true,
  onClose,
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
          🏠
        </button>
        <button
          className="browser-toolbar-btn"
          onClick={handleRefresh}
          title="Refresh"
        >
          ↻
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
        <button
          className="browser-toolbar-btn"
          onClick={handleOpenExternal}
          title="Open in new tab"
        >
          ↗
        </button>
        <button
          className="browser-toolbar-btn browser-close-btn"
          onClick={onClose}
          title="Close browser (Ctrl+Shift+B)"
        >
          ✕
        </button>
      </div>

      <iframe
        ref={appIframeRef}
        className="browser-iframe"
        src={appSrc}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
