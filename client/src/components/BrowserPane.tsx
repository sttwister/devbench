import { useState, useRef, useCallback, useEffect } from "react";
import type { ReactNode } from "react";
import { getMrLabel } from "../api";

interface Props {
  url: string;
  defaultUrl: string;
  mrUrls?: string[];
  /** When set, auto-switch to this MR tab (from sidebar click). */
  pendingMrUrl?: string | null;
  onPendingConsumed?: () => void;
  visible?: boolean;
  onClose: () => void;
  headerLeft?: ReactNode;
}

export default function BrowserPane({
  url,
  defaultUrl,
  mrUrls = [],
  pendingMrUrl = null,
  onPendingConsumed,
  visible = true,
  onClose,
  headerLeft,
}: Props) {
  // "app" or an MR URL string
  const [activeTab, setActiveTab] = useState<string>("app");
  const [appSrc, setAppSrc] = useState(url);
  const [mrSrc, setMrSrc] = useState("");
  const [inputUrl, setInputUrl] = useState(url);
  const appIframeRef = useRef<HTMLIFrameElement>(null);
  const mrIframeRef = useRef<HTMLIFrameElement>(null);

  const hasTabs = mrUrls.length > 0;

  // Reset when the initial url prop changes (session switch / remount)
  useEffect(() => {
    setAppSrc(url);
    setInputUrl(url);
    setActiveTab("app");
    setMrSrc("");
  }, [url]);

  // Handle pending MR URL from sidebar click
  useEffect(() => {
    if (pendingMrUrl) {
      setActiveTab(pendingMrUrl);
      setMrSrc(pendingMrUrl);
      setInputUrl(pendingMrUrl);
      onPendingConsumed?.();
    }
  }, [pendingMrUrl]);

  // Update URL bar when app iframe navigates (same-origin only)
  useEffect(() => {
    const iframe = appIframeRef.current;
    if (!iframe || activeTab !== "app") return;
    const handleLoad = () => {
      try {
        const u = iframe.contentWindow?.location.href;
        if (u && u !== "about:blank") setInputUrl(u);
      } catch {}
    };
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [appSrc, activeTab]);

  // Update URL bar when MR iframe navigates (same-origin only)
  useEffect(() => {
    const iframe = mrIframeRef.current;
    if (!iframe || activeTab === "app") return;
    const handleLoad = () => {
      try {
        const u = iframe.contentWindow?.location.href;
        if (u && u !== "about:blank") setInputUrl(u);
      } catch {}
    };
    iframe.addEventListener("load", handleLoad);
    return () => iframe.removeEventListener("load", handleLoad);
  }, [mrSrc, activeTab]);

  const switchToApp = useCallback(() => {
    setActiveTab("app");
    try {
      const u = appIframeRef.current?.contentWindow?.location.href;
      setInputUrl(u && u !== "about:blank" ? u : appSrc);
    } catch {
      setInputUrl(appSrc);
    }
  }, [appSrc]);

  const switchToMr = useCallback((mrUrl: string) => {
    setActiveTab(mrUrl);
    setMrSrc(mrUrl);
    setInputUrl(mrUrl);
  }, []);

  const handleNavigate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      let nav = inputUrl.trim();
      if (!nav) return;
      if (!/^https?:\/\//i.test(nav)) nav = "http://" + nav;
      if (activeTab === "app") {
        setAppSrc(nav);
      } else {
        setMrSrc(nav);
      }
      setInputUrl(nav);
    },
    [inputUrl, activeTab]
  );

  const handleHome = useCallback(() => {
    setActiveTab("app");
    setAppSrc(defaultUrl);
    setInputUrl(defaultUrl);
  }, [defaultUrl]);

  const handleRefresh = useCallback(() => {
    const iframe =
      activeTab === "app" ? appIframeRef.current : mrIframeRef.current;
    if (iframe) {
      const src = iframe.src;
      iframe.src = "";
      requestAnimationFrame(() => {
        if (iframe) iframe.src = src;
      });
    }
  }, [activeTab]);

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
          className="browser-toolbar-btn browser-close-btn"
          onClick={onClose}
          title="Close browser (Ctrl+Shift+B)"
        >
          ✕
        </button>
      </div>

      {hasTabs && (
        <div className="browser-tabs">
          <button
            className={`browser-tab ${activeTab === "app" ? "active" : ""}`}
            onClick={switchToApp}
          >
            🌐 App
          </button>
          {mrUrls.map((u) => (
            <button
              key={u}
              className={`browser-tab browser-tab-mr ${activeTab === u ? "active" : ""}`}
              onClick={() => switchToMr(u)}
              title={u}
            >
              {getMrLabel(u)}
            </button>
          ))}
        </div>
      )}

      {/* App iframe — always mounted, hidden when viewing MR */}
      <iframe
        ref={appIframeRef}
        className="browser-iframe"
        src={appSrc}
        style={{ display: activeTab === "app" ? undefined : "none" }}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
        allow="clipboard-read; clipboard-write"
      />

      {/* MR iframe — mounted only when an MR tab is active */}
      {activeTab !== "app" && mrSrc && (
        <iframe
          key={mrSrc}
          ref={mrIframeRef}
          className="browser-iframe"
          src={mrSrc}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
          allow="clipboard-read; clipboard-write"
        />
      )}
    </div>
  );
}
