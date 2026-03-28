import { useState, useRef, useCallback, useEffect } from "react";
import type { ReactNode } from "react";

interface Props {
  url: string;
  defaultUrl: string;
  onUrlChange?: (url: string) => void;
  onClose: () => void;
  headerLeft?: ReactNode;
}

export default function BrowserPane({ url, defaultUrl, onUrlChange, onClose, headerLeft }: Props) {
  const [currentUrl, setCurrentUrl] = useState(url);
  const [inputUrl, setInputUrl] = useState(url);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // When the project URL changes (e.g. session/project switch), update
  useEffect(() => {
    setCurrentUrl(url);
    setInputUrl(url);
  }, [url]);

  // Best-effort: update address bar when iframe navigates (same-origin only)
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handleLoad = () => {
      try {
        const newUrl = iframe.contentWindow?.location.href;
        if (newUrl && newUrl !== "about:blank") {
          setInputUrl(newUrl);
          onUrlChange?.(newUrl);
        }
      } catch {
        // Cross-origin — can't read URL
      }
    };
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [currentUrl, onUrlChange]);

  const handleNavigate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      let nav = inputUrl.trim();
      if (!nav) return;
      if (!/^https?:\/\//i.test(nav)) nav = "http://" + nav;
      setCurrentUrl(nav);
      setInputUrl(nav);
      onUrlChange?.(nav);
    },
    [inputUrl, onUrlChange]
  );

  const handleHome = useCallback(() => {
    setCurrentUrl(defaultUrl);
    setInputUrl(defaultUrl);
    onUrlChange?.(defaultUrl);
  }, [defaultUrl, onUrlChange]);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current) {
      const src = iframeRef.current.src;
      iframeRef.current.src = "";
      requestAnimationFrame(() => {
        if (iframeRef.current) iframeRef.current.src = src;
      });
    }
  }, []);

  return (
    <div className="browser-pane">
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
          className="browser-toolbar-btn browser-close-btn"
          onClick={onClose}
          title="Close browser (Ctrl+Shift+B)"
        >
          ✕
        </button>
      </div>
      <iframe
        ref={iframeRef}
        className="browser-iframe"
        src={currentUrl}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}
