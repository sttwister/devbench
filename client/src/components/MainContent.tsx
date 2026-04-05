import { useRef } from "react";
import type { Session, Project } from "../api";
import { getSessionIcon } from "../api";
import TerminalPane from "./TerminalPane";
import BrowserPane from "./BrowserPane";
import DiffViewer from "./DiffViewer";
import type { DiffTarget } from "./DiffViewer";
import Icon from "./Icon";
import MrBadge from "./MrBadge";
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
  /** Ref populated by TerminalPane with the git-commit-push action. */
  gitCommitPushRef?: React.MutableRefObject<((branchName?: string | null) => void) | null>;
  /** True while prepare-commit-push is in flight (shows loading indicator). */
  gitCommitPushPending?: boolean;
  onOpenGitButlerDashboard?: () => void;
  /** Close session action (merge PRs + mark issue done + archive). */
  onCloseSession?: (sessionId: number) => void;
  /** Split-view diff target (shown alongside terminal). */
  splitDiffTarget?: DiffTarget | null;
  /** Callback to update or clear the split diff target. */
  onSetSplitDiffTarget?: (target: DiffTarget | null) => void;
  /** Callback to toggle fullscreen mode (diff or browser). */
  onToggleFullscreen?: () => void;
  /** Whether the browser pane is in fullscreen mode. */
  browserFullscreen?: boolean;
  /** Whether any session has an unread notification (for hamburger badge). */
  hasUnreadNotifications?: boolean;
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
  gitCommitPushRef,
  gitCommitPushPending,
  onOpenGitButlerDashboard,
  onCloseSession,
  splitDiffTarget,
  onSetSplitDiffTarget,
  onToggleFullscreen,
  browserFullscreen,
  hasUnreadNotifications,
}: Props) {
  const hamburgerClass = `sidebar-open-btn${hasUnreadNotifications ? " has-notifications" : ""}`;
  const mainRef = useRef<HTMLElement>(null);
  useSwipeNavigation(mainRef, navigate);
  const showInlineBrowser =
    !isElectron && browserOpenForSession && !!activeProject?.browser_url;
  const showDiffPane = !!splitDiffTarget && !showInlineBrowser;

  // ── Orphaned session ──────────────────────────────────────────
  if (activeSession && orphanedSessionIds.has(activeSession.id)) {
    return (
      <main className="main-content" ref={mainRef}>
        <div className="orphaned-session-panel">
          <button
            className={`${hamburgerClass} empty-state-toggle`}
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
                  <MrBadge
                    key={url}
                    url={url}
                    className="orphaned-mr-badge"
                  />
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
    const isBrowserFullscreen = browserFullscreen && showInlineBrowser;
    const splitStyle = isBrowserFullscreen
      ? undefined
      : showInlineBrowser
        ? ({ "--split": `${resizer.inlineSplitPercent}%` } as React.CSSProperties)
        : showDiffPane
          ? ({ "--split": `${resizer.diffSplitPercent}%` } as React.CSSProperties)
          : undefined;
    const hasSplit = (showInlineBrowser && !isBrowserFullscreen) || showDiffPane;
    const isDraggingSplit = resizer.inlineDragging || resizer.diffDragging;
    return (
      <main className="main-content" ref={mainRef}>
        <div
          className={`session-area${hasSplit ? " inline-browser" : ""}${isDraggingSplit ? " inline-dragging" : ""}${isBrowserFullscreen ? " browser-fullscreen" : ""}`}
          ref={resizer.sessionAreaRef}
          style={splitStyle}
        >
          {!isBrowserFullscreen && <TerminalPane
            key={activeSession.id}
            sessionId={activeSession.id}
            sessionName={activeSession.name}
            sessionType={activeSession.type}
            gitBranch={activeSession.git_branch}
            mrUrls={activeSession.mr_urls}
            sourceUrl={activeSession.source_url}
            sourceType={activeSession.source_type}
            onSessionEnded={() => onSessionEnded(activeSession.id)}
            onSessionRenamed={onSessionRenamed}
            onMrLinkFound={onMrLinkFound}
            gitCommitPushRef={gitCommitPushRef}
            gitCommitPushPending={gitCommitPushPending}
            onOpenGitButlerDashboard={onOpenGitButlerDashboard}
            onCloseSession={onCloseSession ? () => onCloseSession(activeSession.id) : undefined}
            headerLeft={
              <button
                className={hamburgerClass}
                onClick={() => setSidebarOpen(true)}
                title="Open sidebar"
              >
                <Icon name="menu" size={20} />
              </button>
            }
            headerActions={
              <>
                {onSetSplitDiffTarget && activeProject && (
                  <button
                    className={`icon-btn diff-toggle ${showDiffPane ? "active" : ""}`}
                    onClick={() => {
                      if (showDiffPane) {
                        onSetSplitDiffTarget(null);
                      } else {
                        // Close browser if open (one right-side pane at a time)
                        if (browser.isOpen(activeSession.id)) {
                          browser.close(activeSession.id);
                        }
                        onSetSplitDiffTarget({ projectId: activeProject.id, label: "Unstaged changes" });
                      }
                    }}
                    title={
                      showDiffPane
                        ? "Close diff (Ctrl+Shift+E)"
                        : "View diff (Ctrl+Shift+E)"
                    }
                  >
                    <Icon name="file-diff" size={16} />
                  </button>
                )}
                {isElectron ? (
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
                    onClick={() => {
                      // Close diff pane if open (one right-side pane at a time)
                      if (splitDiffTarget) onSetSplitDiffTarget?.(null);
                      browser.toggle(activeSession.id);
                    }}
                    title={
                      browserOpenForSession
                        ? "Close browser (Ctrl+Shift+B)"
                        : "Open browser (Ctrl+Shift+B)"
                    }
                  >
                    <Icon name="globe" size={16} />
                  </button>
                ) : null}
              </>
            }
          />}
          {showInlineBrowser && !isBrowserFullscreen && (
            <div
              className={`pane-resizer ${resizer.inlineDragging ? "active" : ""}`}
              onPointerDown={resizer.handleInlineResizerDown}
              onPointerMove={resizer.handleInlineResizerMove}
              onPointerUp={resizer.handleInlineResizerUp}
            />
          )}
          {showDiffPane && (
            <div
              className={`pane-resizer ${resizer.diffDragging ? "active" : ""}`}
              onPointerDown={resizer.handleDiffResizerDown}
              onPointerMove={resizer.handleDiffResizerMove}
              onPointerUp={resizer.handleDiffResizerUp}
            />
          )}
          {showDiffPane && splitDiffTarget && (
            <div className="diff-pane-stack">
              <DiffViewer
                diffTarget={splitDiffTarget}
                onClose={() => onSetSplitDiffTarget?.(null)}
                onChangeDiffTarget={onSetSplitDiffTarget ?? undefined}
                onToggleFullscreen={onToggleFullscreen}
              />
            </div>
          )}
          {browser.sessions.size > 0 && (
            <div
              className="browser-stack"
              style={(showInlineBrowser || isBrowserFullscreen) ? undefined : { display: "none" }}
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
                    visible={(showInlineBrowser || isBrowserFullscreen) && sid === activeSession?.id}
                    fullscreen={isBrowserFullscreen}
                    onClose={() => browser.close(sid)}
                    onViewModeChange={(mode) => browser.setViewMode(sid, mode)}
                    onToggleFullscreen={onToggleFullscreen}
                    headerLeft={
                      <button
                        className={hamburgerClass}
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
          className={`${hamburgerClass} empty-state-toggle`}
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
