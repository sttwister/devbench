import { useRef } from "react";
import type { Session, Project } from "../api";
import { getSessionIcon } from "../api";
import TerminalPane from "./TerminalPane";
import BrowserPane from "./BrowserPane";
import Icon from "./Icon";
import type { useBrowserState } from "../hooks/useBrowserState";
import type { useResizer } from "../hooks/useResizer";
import { useSwipeNavigation } from "../hooks/useSwipeNavigation";
import { isElectron, devbench } from "../platform";

interface Props {
  activeSession: Session | null;
  activeProject: Project | null;
  projects: Project[];
  orphanedSessionIds: Set<number>;
  browserOpenForSession: boolean;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  browser: ReturnType<typeof useBrowserState>;
  resizer: ReturnType<typeof useResizer>;
  onSessionEnded: (sessionId: number) => void;
  onSessionRenamed: (newName: string) => void;
  onMrLinkFound: () => void;
  onReviveSession: (id: number) => void;
  onDeleteSession: (id: number) => void;
  navigate: (delta: number) => void;
}

export default function MainContent({
  activeSession,
  activeProject,
  projects,
  orphanedSessionIds,
  browserOpenForSession,
  sidebarOpen,
  setSidebarOpen,
  browser,
  resizer,
  onSessionEnded,
  onSessionRenamed,
  onMrLinkFound,
  onReviveSession,
  onDeleteSession,
  navigate,
}: Props) {
  const mainRef = useRef<HTMLElement>(null);
  useSwipeNavigation(mainRef, navigate);
  const showInlineBrowser =
    !isElectron && browserOpenForSession && !!activeProject?.browser_url;

  // ── Orphaned session ──────────────────────────────────────────
  if (activeSession && orphanedSessionIds.has(activeSession.id)) {
    return (
      <main className="main-content" ref={mainRef}>
        <div className="orphaned-session-panel">
          <button
            className="sidebar-open-btn empty-state-toggle"
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
          >
            <Icon name="menu" size={20} />
          </button>
          <div className="orphaned-session-content">
            <span className="orphaned-icon">
              <Icon name={getSessionIcon(activeSession.type)} size={32} />
            </span>
            <h2>{activeSession.name}</h2>
            <p className="orphaned-description">
              This session's terminal was lost (server restart / power failure).
              {activeSession.type !== "terminal" && activeSession.agent_session_id
                ? " The agent conversation can be resumed."
                : activeSession.type !== "terminal"
                  ? " A fresh agent session will be started."
                  : " A new terminal will be created."}
            </p>
            <div className="orphaned-actions">
              <button
                className="orphaned-revive-btn"
                onClick={() => onReviveSession(activeSession.id)}
              >
                <Icon name="refresh-cw" size={14} /> Revive Session
              </button>
              <button
                className="orphaned-remove-btn"
                onClick={() => onDeleteSession(activeSession.id)}
              >
                × Remove
              </button>
            </div>
            {activeSession.mr_urls.length > 0 && (
              <div className="orphaned-mr-links">
                <span>MR links: </span>
                {activeSession.mr_urls.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  // ── Active session ────────────────────────────────────────────
  if (activeSession) {
    return (
      <main className="main-content" ref={mainRef}>
        <div
          className={`session-area${showInlineBrowser ? " inline-browser" : ""}${resizer.inlineDragging ? " inline-dragging" : ""}`}
          ref={resizer.sessionAreaRef}
          style={
            showInlineBrowser
              ? ({ "--split": `${resizer.inlineSplitPercent}%` } as React.CSSProperties)
              : undefined
          }
        >
          <TerminalPane
            key={activeSession.id}
            sessionId={activeSession.id}
            sessionName={activeSession.name}
            sessionType={activeSession.type}
            mrUrls={activeSession.mr_urls}
            mrStatuses={activeSession.mr_statuses}
            sourceUrl={activeSession.source_url}
            sourceType={activeSession.source_type}
            onSessionEnded={() => onSessionEnded(activeSession.id)}
            onSessionRenamed={onSessionRenamed}
            onMrLinkFound={onMrLinkFound}
            headerLeft={
              <button
                className="sidebar-open-btn"
                onClick={() => setSidebarOpen(true)}
                title="Open sidebar"
              >
                <Icon name="menu" size={20} />
              </button>
            }
            headerActions={
              isElectron ? (
                <button
                  className={`icon-btn browser-toggle ${browserOpenForSession ? "active" : ""}`}
                  onClick={() => devbench!.toggleBrowser()}
                  title={
                    browserOpenForSession
                      ? "Close browser (Ctrl+Shift+B)"
                      : "Open browser (Ctrl+Shift+B)"
                  }
                >
                  <Icon name="globe" size={16} />
                </button>
              ) : activeProject?.browser_url ? (
                <button
                  className={`icon-btn browser-toggle ${browserOpenForSession ? "active" : ""}`}
                  onClick={() => browser.toggle(activeSession.id)}
                  title={
                    browserOpenForSession
                      ? "Close browser (Ctrl+Shift+B)"
                      : "Open browser (Ctrl+Shift+B)"
                  }
                >
                  <Icon name="globe" size={16} />
                </button>
              ) : undefined
            }
          />
          {showInlineBrowser && (
            <div
              className={`pane-resizer ${resizer.inlineDragging ? "active" : ""}`}
              onPointerDown={resizer.handleInlineResizerDown}
              onPointerMove={resizer.handleInlineResizerMove}
              onPointerUp={resizer.handleInlineResizerUp}
            />
          )}
          {browser.sessions.size > 0 && (
            <div
              className="browser-stack"
              style={showInlineBrowser ? undefined : { display: "none" }}
            >
              {Array.from(browser.sessions).map(([sid, state]) => {
                const proj = projects.find((p) =>
                  p.sessions.some((s) => s.id === sid)
                );
                return (
                  <BrowserPane
                    key={sid}
                    url={state.url}
                    defaultUrl={proj?.browser_url ?? state.url}
                    viewMode={browser.getViewMode(sid)}
                    visible={showInlineBrowser && sid === activeSession?.id}
                    onClose={() => browser.close(sid)}
                    onViewModeChange={(mode) => browser.setViewMode(sid, mode)}
                    headerLeft={
                      <button
                        className="sidebar-open-btn"
                        onClick={() => setSidebarOpen(true)}
                        title="Open sidebar"
                      >
                        <Icon name="menu" size={20} />
                      </button>
                    }
                  />
                );
              })}
            </div>
          )}
          {isElectron && browserOpenForSession && (
            <div
              className={`pane-resizer ${resizer.isDragging ? "active" : ""}`}
              onPointerDown={resizer.handleResizerPointerDown}
              onPointerMove={resizer.handleResizerPointerMove}
              onPointerUp={resizer.handleResizerPointerUp}
            />
          )}
          {resizer.isDragging && (
            <div
              className="resize-preview-line"
              style={{ left: resizer.dragX! }}
            />
          )}
        </div>
      </main>
    );
  }

  // ── Empty state ───────────────────────────────────────────────
  return (
    <main className="main-content" ref={mainRef}>
      <div className="empty-state">
        <button
          className="sidebar-open-btn empty-state-toggle"
          onClick={() => setSidebarOpen(true)}
          title="Open sidebar"
        >
          <Icon name="menu" size={20} />
        </button>
        <div className="empty-state-content">
          {activeProject ? (
            <>
              <h2>{activeProject.name}</h2>
              <p>
                No active session. Press{" "}
                <kbd className="empty-state-kbd">Ctrl+Shift+N</kbd> to
                create one.
              </p>
            </>
          ) : (
            <>
              <h2>Devbench</h2>
              <p>
                Select a session from the sidebar, or create a new one to
                get started.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
