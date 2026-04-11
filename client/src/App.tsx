// @lat: [[client#App Shell]]
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Sidebar from "./components/Sidebar";
import ProjectFormModal from "./components/ProjectFormModal";
import NewSessionPopup from "./components/NewSessionPopup";
import KillSessionPopup from "./components/KillSessionPopup";
import RenameSessionPopup from "./components/RenameSessionPopup";
import ShortcutsHelpPopup from "./components/ShortcutsHelpPopup";
import ArchivedSessionsPopup from "./components/ArchivedSessionsPopup";
import EditSessionPopup from "./components/EditSessionPopup";
import ConfirmPopup from "./components/ConfirmPopup";
import ErrorPopup from "./components/ErrorPopup";
import CloseSessionPopup from "./components/CloseSessionPopup";
import CloseSessionToast from "./components/CloseSessionToast";
import SettingsPane from "./components/SettingsModal";
import MainContent from "./components/MainContent";
import GitButlerDashboard from "./components/GitButlerDashboard";
import type { GitButlerDashboardHandle } from "./components/GitButlerDashboard";
import DiffViewer from "./components/DiffViewer";
import type { DiffTarget } from "./components/DiffViewer";
import OrchestrationDashboard from "./components/OrchestrationDashboard";
import { useBrowserState } from "./hooks/useBrowserState";
import { useSessionNavigation } from "./hooks/useSessionNavigation";
import { useElectronBridge } from "./hooks/useElectronBridge";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useProjectActions } from "./hooks/useProjectActions";
import { useSessionActions } from "./hooks/useSessionActions";
import { useResizer } from "./hooks/useResizer";
import { useEventSocket } from "./hooks/useEventSocket";
import {
  playNotificationSound,
  showBrowserNotification,
  getNotificationSoundEnabled,
} from "./hooks/useNotifications";
import {
  fetchProjects,
  fetchPollData,
  fetchExtensionStatuses,
  deleteSessionPermanently,
  prepareCommitPush,
  markSessionRead,
  setProjectActive,
  forkSession,
  fetchOrchestrationStatus,
} from "./api";
import type { Project, Session, AgentStatus, MrStatus } from "./api";
import { MrStatusProvider, useMrStatus } from "./contexts/MrStatusContext";
import { isElectron, devbench } from "./platform";

export default function App() {
  return (
    <MrStatusProvider>
      <AppContent />
    </MrStatusProvider>
  );
}

function AppContent() {
  // ── Core state ───────────────────────────────────────────────────
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({});
  const [orphanedSessionIds, setOrphanedSessionIds] = useState<Set<number>>(new Set());
  const [processingSourceSessionIds, setProcessingSourceSessionIds] = useState<Set<number>>(new Set());
  const [notifiedSessionIds, setNotifiedSessionIds] = useState<Set<number>>(new Set());

  // ── Events WebSocket ──────────────────────────────────────────
  const { socket: eventSocket, status: wsStatus } = useEventSocket();

  // Connection health (HTTP poll). Combined with WS status to drive the
  // connection indicator next to the sidebar header.
  const [pollHealthy, setPollHealthy] = useState(true);
  const connectionStatus: "connected" | "connecting" | "disconnected" =
    wsStatus === "disconnected" || !pollHealthy
      ? "disconnected"
      : wsStatus === "connecting"
        ? "connecting"
        : "connected";

  // ── UI state ─────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasExtensionUpdates, setHasExtensionUpdates] = useState(false);
  const [dashboardMode, setDashboardMode] = useState<null | "project" | "all">(null);
  const [orchestrationOpen, setOrchestrationOpen] = useState(false);
  const [activeOrchestrationCount, setActiveOrchestrationCount] = useState(0);
  const [diffTarget, setDiffTarget] = useState<DiffTarget | null>(null);
  const [diffFullscreen, setDiffFullscreen] = useState(false);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  /** Tracks whether the diff was opened from the dashboard (to restore on close). */
  const diffFromDashboardRef = useRef(false);
  /** Tracks the dashboard mode that was active when the diff was opened from dashboard. */
  const diffFromDashboardModeRef = useRef<null | "project" | "all">(null);
  const preDashboardSessionRef = useRef<Session | null>(null);
  const preDashboardProjectIdRef = useRef<number | null>(null);
  const gitButlerDashboardRef = useRef<GitButlerDashboardHandle>(null);


  // ── Derived state ────────────────────────────────────────────────
  const activeProject = useMemo(() => {
    if (activeProjectId === null) return null;
    return projects.find((p) => p.id === activeProjectId) ?? null;
  }, [projects, activeProjectId]);

  // ── Data loading ─────────────────────────────────────────────────
  const loadProjects = useCallback(async () => {
    try {
      setProjects(await fetchProjects());
    } catch (e) {
      console.error("Failed to load projects:", e);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // Poll for project updates (catches background session deaths)
  useEffect(() => {
    const interval = setInterval(loadProjects, 10_000);
    return () => clearInterval(interval);
  }, [loadProjects]);

  // ── Extension update check ──────────────────────────────────────
  useEffect(() => {
    fetchExtensionStatuses().then((statuses) => {
      const needsUpdate = Object.values(statuses).some(
        (s) => s.installed && !s.upToDate
      );
      setHasExtensionUpdates(needsUpdate);
    });
  }, []);

  // ── Orchestration active job count ─────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const status = await fetchOrchestrationStatus();
        setActiveOrchestrationCount(status.activeJobCount);
      } catch {
        // ignore — server may be unreachable
      }
    };
    poll();
    const interval = setInterval(poll, 5_000);
    return () => clearInterval(interval);
  }, []);

  // ── MR status store ──────────────────────────────────────────────
  const { mergeStatuses } = useMrStatus();

  // Populate the global MR status store whenever project data changes.
  // This aggregates mr_statuses from every active session so MrBadge
  // components can look up status by URL without prop-drilling.
  useEffect(() => {
    const all: Record<string, MrStatus> = {};
    for (const p of projects) {
      for (const s of p.sessions) {
        if (s.mr_statuses) {
          for (const [url, status] of Object.entries(s.mr_statuses)) {
            const existing = all[url];
            if (
              !existing ||
              !existing.last_checked ||
              (status.last_checked && status.last_checked > existing.last_checked)
            ) {
              all[url] = status;
            }
          }
        }
      }
    }
    if (Object.keys(all).length > 0) mergeStatuses(all);
  }, [projects, mergeStatuses]);

  // Keep activeSession in sync with fresh project data so the terminal
  // header reflects up-to-date MR URLs, source URLs, etc.
  // (MR statuses are handled by the global store — no comparison needed.)
  useEffect(() => {
    if (!activeSession) return;
    for (const project of projects) {
      const fresh = project.sessions.find(s => s.id === activeSession.id);
      if (fresh) {
        const changed =
          fresh.name !== activeSession.name ||
          fresh.source_url !== activeSession.source_url ||
          fresh.source_type !== activeSession.source_type ||
          fresh.mr_urls.length !== activeSession.mr_urls.length ||
          fresh.mr_urls.some((u, i) => u !== activeSession.mr_urls[i]);
        if (changed) {
          setActiveSession(fresh);
        }
        return;
      }
    }
  }, [projects]);

  // Poll agent statuses and orphaned sessions (single combined request)
  useEffect(() => {
    const poll = () => {
      fetchPollData()
        .then((data) => {
          setAgentStatuses(data.agentStatuses);
          setOrphanedSessionIds(new Set(data.orphanedSessionIds));
          setProcessingSourceSessionIds(new Set(data.processingSourceSessionIds ?? []));
          setNotifiedSessionIds(new Set(data.notifiedSessionIds ?? []));
          setPollHealthy(true);
        })
        .catch(() => {
          setPollHealthy(false);
        });
    };
    poll();
    const interval = setInterval(poll, 5_000);
    return () => clearInterval(interval);
  }, []);

  // ── Real-time updates via events WebSocket ─────────────────────
  // Agent status changes — update sidebar spinner/dot immediately
  useEffect(() => {
    return eventSocket.on("agent-status", (event) => {
      const { sessionId, status } = event as { sessionId: number; status: AgentStatus };
      setAgentStatuses((prev) => ({ ...prev, [sessionId]: status }));
    });
  }, [eventSocket]);

  // Session has-changes updates — update session data immediately
  useEffect(() => {
    return eventSocket.on("session-has-changes", (event) => {
      const { sessionId, hasChanges } = event as { sessionId: number; hasChanges: boolean };
      setProjects((prev) =>
        prev.map((p) => ({
          ...p,
          sessions: p.sessions.map((s) =>
            s.id === sessionId ? { ...s, has_changes: hasChanges } : s
          ),
        }))
      );
    });
  }, [eventSocket]);

  // Session notification — glow + sound + browser popup in ONE handler.
  //
  // React Strict Mode double-mounts effects, which can leave a stale handler
  // that races with the fresh one. To prevent the stale handler from playing
  // sound, we use a generation counter: only the latest handler instance acts.
  const activeSessionIdRef = useRef<number | null>(null);
  activeSessionIdRef.current = activeSession?.id ?? null;

  // Session lookup map for browser notification titles + click-to-navigate
  const sessionMapRef = useRef<Map<number, { session: Session; projectName: string }>>(new Map());
  useEffect(() => {
    const map = new Map<number, { session: Session; projectName: string }>();
    for (const p of projects) {
      for (const s of p.sessions) {
        map.set(s.id, { session: s, projectName: p.name });
      }
    }
    sessionMapRef.current = map;
  }, [projects]);

  const lastNotifTimeRef = useRef(0);
  const notifHandlerGenRef = useRef(0);

  // session-notified: glow + auto-mark-read (NO sound — sound is deferred server-side)
  useEffect(() => {
    const gen = ++notifHandlerGenRef.current;

    return eventSocket.on("session-notified", (event) => {
      const { sessionId } = event as { sessionId: number };

      // Only the latest handler instance should run — skip stale ones
      // left over from React Strict Mode double-mount.
      if (gen !== notifHandlerGenRef.current) return;

      // If user is viewing this session and the app is visible, mark read
      // immediately. This cancels the server’s pending sound timer.
      if (sessionId === activeSessionIdRef.current && !document.hidden) {
        markSessionRead(sessionId);
        return;
      }

      // Add glow
      setNotifiedSessionIds((prev) => {
        if (prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });
    });
  }, [eventSocket]);

  // session-notify-sound: server confirmed no client marked read within the
  // grace period — play sound + browser notification unconditionally.
  useEffect(() => {
    return eventSocket.on("session-notify-sound", (event) => {
      const { sessionId } = event as { sessionId: number };

      // Rate limit sound + browser popup (1/sec)
      const now = Date.now();
      if (now - lastNotifTimeRef.current < 1000) return;
      lastNotifTimeRef.current = now;

      // Sound
      if (getNotificationSoundEnabled()) {
        playNotificationSound();
      }

      // Browser notification
      const info = sessionMapRef.current.get(sessionId);
      showBrowserNotification(
        sessionId,
        info?.session.name ?? "",
        info?.projectName ?? "",
        (sid) => {
          const entry = sessionMapRef.current.get(sid);
          if (entry) selectSessionRef.current?.(entry.session);
        },
      );
    });
  }, [eventSocket]);

  // Notification read (from another client) — remove glow immediately
  useEffect(() => {
    return eventSocket.on("notification-read", (event) => {
      const { sessionId } = event as { sessionId: number };
      setNotifiedSessionIds((prev) => {
        if (!prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    });
  }, [eventSocket]);

  // Auto-clear notification when window regains focus/visibility on an active session.
  // Listens to both 'focus' (desktop) and 'visibilitychange' (mobile PWA) events.
  const notifiedIdsRef = useRef(notifiedSessionIds);
  notifiedIdsRef.current = notifiedSessionIds;

  useEffect(() => {
    const clearIfViewing = () => {
      if (document.hidden) return;
      const sid = activeSessionIdRef.current;
      if (sid != null && notifiedIdsRef.current.has(sid)) {
        markSessionRead(sid);
        setNotifiedSessionIds((prev) => {
          if (!prev.has(sid)) return prev;
          const next = new Set(prev);
          next.delete(sid);
          return next;
        });
      }
    };
    window.addEventListener("focus", clearIfViewing);
    document.addEventListener("visibilitychange", clearIfViewing);
    return () => {
      window.removeEventListener("focus", clearIfViewing);
      document.removeEventListener("visibilitychange", clearIfViewing);
    };
  }, []);

  // ── Service worker notification click ─────────────────────────────
  // On Android PWA, the service worker posts a message when the user taps
  // a notification. Navigate to the session that triggered it.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "notification-click" && event.data.sessionId) {
        const entry = sessionMapRef.current.get(event.data.sessionId);
        if (entry) selectSessionRef.current?.(entry.session);
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  // ── URL-based session persistence ───────────────────────────────
  // Restore session from URL on first project load (survives server restarts)
  const [urlRestored, setUrlRestored] = useState(false);

  useEffect(() => {
    if (urlRestored || projects.length === 0) return;
    setUrlRestored(true);

    const pathname = window.location.pathname;

    // Restore dashboard views
    if (pathname === "/gitbutler") {
      setDashboardMode("all");
      return;
    }
    const dashboardMatch = pathname.match(/^\/gitbutler\/project\/(\d+)$/);
    if (dashboardMatch) {
      const projId = parseInt(dashboardMatch[1], 10);
      setDashboardMode("project");
      setActiveProjectId(projId);
      return;
    }

    // Restore session
    const match = pathname.match(/^\/session\/(\d+)$/);
    if (!match) return;
    const sessionId = parseInt(match[1], 10);

    for (const project of projects) {
      const session = project.sessions.find((s) => s.id === sessionId);
      if (session) {
        setActiveSession(session);
        setActiveProjectId(session.project_id);
        return;
      }
    }
  }, [projects, urlRestored]);

  // Keep URL in sync with active session / dashboard (only after initial restore attempted)
  useEffect(() => {
    if (!urlRestored) return;
    let targetPath: string;
    if (dashboardMode === "all") {
      targetPath = "/gitbutler";
    } else if (dashboardMode === "project" && activeProjectId) {
      targetPath = `/gitbutler/project/${activeProjectId}`;
    } else if (activeSession) {
      targetPath = `/session/${activeSession.id}`;
    } else {
      targetPath = "/";
    }
    if (window.location.pathname !== targetPath) {
      window.history.replaceState(null, "", targetPath);
    }
  }, [activeSession, dashboardMode, activeProjectId, urlRestored]);

  // ── Selection ────────────────────────────────────────────────────
  const selectSession = useCallback((session: Session) => {
    setActiveSession(session);
    setActiveProjectId(session.project_id);
    setDashboardMode(null);
    setSettingsOpen(false);
    setDiffTarget(null);
    setDiffFullscreen(false);
    setBrowserFullscreen(false);
    diffFromDashboardRef.current = false;
    diffFromDashboardModeRef.current = null;
    // Clear notification for this session across all clients
    if (notifiedSessionIds.has(session.id)) {
      markSessionRead(session.id);
      setNotifiedSessionIds((prev) => {
        const next = new Set(prev);
        next.delete(session.id);
        return next;
      });
    }
  }, [notifiedSessionIds]);

  const selectSessionRef = useRef(selectSession);
  selectSessionRef.current = selectSession;

  const selectProject = useCallback((projectId: number) => {
    setActiveSession(null);
    setActiveProjectId(projectId);
    setDashboardMode(null);
    setSettingsOpen(false);
  }, []);

  // ── Browser state ────────────────────────────────────────────────
  const browser = useBrowserState(projects);

  const browserOpenForSession = isElectron
    ? browserOpen
    : activeSession
      ? browser.isOpen(activeSession.id)
      : false;

  // Register the active session's browser iframe when inline browser is shown
  useEffect(() => {
    if (isElectron || !browserOpenForSession || !activeSession || !activeProject?.browser_url) return;
    browser.ensureRegistered(activeSession.id, activeProject.browser_url);
  }, [browserOpenForSession, activeSession?.id, activeProject?.browser_url]);

  // ── Navigation ───────────────────────────────────────────────────
  const { navigate } = useSessionNavigation(
    projects, activeSession, activeProjectId, selectSession, selectProject
  );

  // ── Project actions ──────────────────────────────────────────────
  const projectActions = useProjectActions({
    projects, setProjects,
    activeProjectId, setActiveProjectId, setActiveSession,
    loadProjects,
    browserCleanup: browser.cleanup,
  });

  // ── Session actions ──────────────────────────────────────────────
  const sessionActions = useSessionActions({
    projects, setProjects,
    activeSession, setActiveSession,
    selectSession, loadProjects,
    browserCleanup: browser.cleanup,
    setOrphanedSessionIds,
  });

  // ── Resizer ──────────────────────────────────────────────────────
  const resizer = useResizer();

  // ── Terminal toggle state ──────────────────────────────────────────
  const preTerminalSessionRef = useRef<Session | null>(null);

  // ── Shortcut callbacks (stable refs for hooks) ───────────────────
  const handleToggleBrowserShortcut = useCallback(() => {
    if (!activeSession) return;
    if (isElectron) {
      devbench.toggleBrowser();
    } else if (activeProject?.browser_url) {
      // Close diff pane when opening browser (one right-side pane at a time)
      if (diffTarget && !diffFullscreen && !browser.isOpen(activeSession.id)) {
        setDiffTarget(null);
      }
      // Clear browser fullscreen when closing browser
      if (browser.isOpen(activeSession.id)) {
        setBrowserFullscreen(false);
      }
      browser.toggle(activeSession.id, activeProject.browser_url);
    }
  }, [activeSession, activeProject, diffTarget, diffFullscreen, browser]);

  const handleNewSessionShortcut = useCallback(() => {
    if (projects.length === 0) return;
    sessionActions.setNewSessionPopupProjectId(activeProject?.id ?? null);
    sessionActions.setNewSessionPopupOpen(true);
  }, [activeProject, projects]);

  const handleKillSessionShortcut = useCallback(() => {
    if (activeSession) sessionActions.setKillSessionPopupOpen(true);
  }, [activeSession]);

  const handleReviveSessionShortcut = useCallback(() => {
    if (activeProject) sessionActions.setArchivedProjectId(activeProject.id);
  }, [activeProject]);

  const handleRenameSessionShortcut = useCallback(() => {
    if (activeSession) sessionActions.setRenameSessionPopupOpen(true);
  }, [activeSession]);

  const handleToggleTerminalShortcut = useCallback(() => {
    if (!activeProject) return;
    const terminalSession = activeProject.sessions.find((s) => s.type === "terminal");
    if (!terminalSession) return;

    if (activeSession?.id === terminalSession.id) {
      // Already on the terminal — revert to previous session
      if (preTerminalSessionRef.current) {
        selectSession(preTerminalSessionRef.current);
        preTerminalSessionRef.current = null;
      }
    } else {
      // Save current session and jump to terminal
      preTerminalSessionRef.current = activeSession;
      selectSession(terminalSession);
    }
  }, [activeProject, activeSession, selectSession]);

  const gitCommitPushRef = useRef<((branchName?: string | null, staleBranch?: string | null) => void) | null>(null);
  const [gitCommitPushPending, setGitCommitPushPending] = useState(false);

  const handleGitCommitPush = useCallback(async () => {
    if (!activeSession || activeSession.type === "terminal") return;
    if (gitCommitPushPending) return; // already in flight

    // Capture the send-callback synchronously BEFORE any async work.
    // If the user switches sessions while prepareCommitPush is in flight,
    // gitCommitPushRef.current will be updated to the new session's callback.
    // Using the captured value ensures the command always targets the session
    // that originally triggered the shortcut, not whatever is active later.
    const capturedSend = gitCommitPushRef.current;

    setGitCommitPushPending(true);
    let preparedBranchName: string | null = null;
    let preparedStaleBranch: string | null = null;
    try {
      const prepared = await prepareCommitPush(activeSession.id);
      preparedBranchName = prepared.branchName;
      preparedStaleBranch = prepared.staleBranch ?? null;
      await loadProjects();
    } catch (e: any) {
      sessionActions.setErrorMessage(e.message || "Failed to prepare commit and push");
      return;
    } finally {
      setGitCommitPushPending(false);
    }

    capturedSend?.(preparedBranchName, preparedStaleBranch);
  }, [activeSession, gitCommitPushPending, loadProjects, sessionActions]);

  const handleShowShortcuts = useCallback(() => {
    setShortcutsHelpOpen(true);
  }, []);

  // ── GitButler dashboard toggle handlers ─────────────────────────
  const handleToggleProjectDashboard = useCallback(() => {
    if (dashboardMode === "project") {
      // Go back to previous view
      setDashboardMode(null);
      setSettingsOpen(false);
      if (preDashboardSessionRef.current) {
        selectSession(preDashboardSessionRef.current);
        preDashboardSessionRef.current = null;
      } else if (preDashboardProjectIdRef.current !== null) {
        selectProject(preDashboardProjectIdRef.current);
      }
    } else {
      // Save current state and show project dashboard
      preDashboardSessionRef.current = activeSession;
      preDashboardProjectIdRef.current = activeProjectId;
      setSettingsOpen(false);
      setDashboardMode("project");
    }
  }, [dashboardMode, activeSession, activeProjectId, selectSession, selectProject]);

  const handleToggleAllDashboard = useCallback(() => {
    if (dashboardMode === "all") {
      // Go back to previous view
      setDashboardMode(null);
      setSettingsOpen(false);
      if (preDashboardSessionRef.current) {
        selectSession(preDashboardSessionRef.current);
        preDashboardSessionRef.current = null;
      } else if (preDashboardProjectIdRef.current !== null) {
        selectProject(preDashboardProjectIdRef.current);
      }
    } else {
      // Save current state and show all-projects dashboard
      preDashboardSessionRef.current = activeSession;
      preDashboardProjectIdRef.current = activeProjectId;
      setSettingsOpen(false);
      setDashboardMode("all");
    }
  }, [dashboardMode, activeSession, activeProjectId, selectSession, selectProject]);

  const handleToggleOrchestration = useCallback(() => {
    if (orchestrationOpen) {
      setOrchestrationOpen(false);
    } else {
      setOrchestrationOpen(true);
      setDashboardMode(null);
      setSettingsOpen(false);
    }
  }, [orchestrationOpen]);

  const handleGitButlerPull = useCallback(() => {
    gitButlerDashboardRef.current?.triggerPull();
  }, []);

  const handleCloseSessionShortcut = useCallback(() => {
    if (activeSession) sessionActions.handleCloseSession(activeSession.id);
  }, [activeSession, sessionActions]);

  const handleForkSession = useCallback(async () => {
    if (!activeSession) return;
    if (activeSession.type === "terminal" || activeSession.type === "codex") return;
    if (!activeSession.agent_session_id) return;
    try {
      await forkSession(activeSession.id);
    } catch (e: any) {
      sessionActions.setErrorMessage(`Fork failed: ${e.message}`);
    }
  }, [activeSession, sessionActions]);

  const handleToggleDiffShortcut = useCallback(() => {
    if (!activeProject) return;
    if (diffTarget) {
      // Close the diff
      setDiffTarget(null);
      setDiffFullscreen(false);
      diffFromDashboardRef.current = false;
      diffFromDashboardModeRef.current = null;
    } else {
      // Open unassigned changes diff for the active project in split mode
      setDiffTarget({ projectId: activeProject.id, label: "Unstaged changes" });
      setDiffFullscreen(false);
      diffFromDashboardRef.current = false;
      diffFromDashboardModeRef.current = null;
      // Close browser pane if open (only one right-side pane at a time)
      if (activeSession && browser.isOpen(activeSession.id)) {
        browser.close(activeSession.id);
        setBrowserFullscreen(false);
      }
    }
  }, [activeProject, activeSession, diffTarget, browser]);

  /** Close the diff viewer. If it was opened from the dashboard, return there. */
  const handleCloseDiff = useCallback(() => {
    setDiffTarget(null);
    setDiffFullscreen(false);
    if (diffFromDashboardRef.current) {
      diffFromDashboardRef.current = false;
      // Restore the dashboard view that was active before the diff opened
      setDashboardMode(diffFromDashboardModeRef.current);
      diffFromDashboardModeRef.current = null;
    }
  }, []);

  /** Toggle fullscreen for the active right-side pane (diff or browser).
   *  If no pane is open, open the diff viewer in fullscreen directly. */
  const handleToggleFullscreen = useCallback(() => {
    if (diffTarget) {
      // Diff is open — toggle diff fullscreen
      setDiffFullscreen((prev) => {
        if (prev) {
          // Going from fullscreen → split: if dashboard was showing, temporarily hide it
          if (dashboardMode) {
            preDashboardSessionRef.current = preDashboardSessionRef.current ?? activeSession;
            preDashboardProjectIdRef.current = preDashboardProjectIdRef.current ?? activeProjectId;
            setDashboardMode(null);
          }
        }
        return !prev;
      });
    } else if (browserOpenForSession && !isElectron) {
      // Browser is open — toggle browser fullscreen
      setBrowserFullscreen((prev) => !prev);
    } else if (activeProject) {
      // No pane open — open diff viewer in fullscreen
      setDiffTarget({ projectId: activeProject.id, label: "Unstaged changes" });
      setDiffFullscreen(true);
      diffFromDashboardRef.current = false;
      diffFromDashboardModeRef.current = null;
    }
  }, [diffTarget, dashboardMode, activeSession, activeProjectId, activeProject, browserOpenForSession]);

  /** Called when the GitButler dashboard wants to show a diff. */
  const handleDashboardViewDiff = useCallback((target: DiffTarget) => {
    setDiffTarget(target);
    setDiffFullscreen(true);
    diffFromDashboardRef.current = true;
    diffFromDashboardModeRef.current = dashboardMode;
  }, [dashboardMode]);

  const handleDashboardNavigateToSession = useCallback((sessionId: number) => {
    for (const project of projects) {
      const session = project.sessions.find((s) => s.id === sessionId);
      if (session) {
        setDashboardMode(null);
        selectSession(session);
        return;
      }
    }
  }, [projects, selectSession]);

  // ── Electron bridge ──────────────────────────────────────────────
  useElectronBridge({
    activeSession,
    activeProject,
    projects,
    browserOpen,
    setBrowserOpen,
    navigate,
    loadProjects,
    onToggleBrowser: handleToggleBrowserShortcut,
    onToggleTerminal: handleToggleTerminalShortcut,
    onNewSession: handleNewSessionShortcut,
    onKillSession: handleKillSessionShortcut,
    onReviveSession: handleReviveSessionShortcut,
    onRenameSession: handleRenameSessionShortcut,
    onGitCommitPush: handleGitCommitPush,
    onShowShortcuts: handleShowShortcuts,
    onToggleProjectDashboard: handleToggleProjectDashboard,
    onToggleAllDashboard: handleToggleAllDashboard,
    onGitButlerPull: handleGitButlerPull,
    onToggleDiff: handleToggleDiffShortcut,
    onToggleFullscreen: handleToggleFullscreen,
    onForkSession: handleForkSession,
    onToggleOrchestration: handleToggleOrchestration,
    onBrowserToggled: useCallback((open: boolean) => {
      setBrowserOpen(open);
      if (activeSession) {
        browser.setOpen(activeSession.id, open);
      }
    }, [activeSession?.id]),
    onViewModeChanged: useCallback((sessionId: number, mode: string) => {
      browser.setViewMode(sessionId, mode as "desktop" | "mobile");
    }, []),
  });

  // ── Browser keyboard shortcuts (non-Electron) ───────────────────
  useKeyboardShortcuts({
    activeSession,
    activeProject,
    dashboardMode,
    navigate,
    onNewSession: handleNewSessionShortcut,
    onKillSession: handleKillSessionShortcut,
    onReviveSession: handleReviveSessionShortcut,
    onRenameSession: handleRenameSessionShortcut,
    onToggleBrowser: handleToggleBrowserShortcut,
    onToggleTerminal: handleToggleTerminalShortcut,
    onGitCommitPush: handleGitCommitPush,
    onShowShortcuts: handleShowShortcuts,
    onToggleProjectDashboard: handleToggleProjectDashboard,
    onToggleAllDashboard: handleToggleAllDashboard,
    onGitButlerPull: handleGitButlerPull,
    onCloseSession: handleCloseSessionShortcut,
    onToggleDiff: handleToggleDiffShortcut,
    onToggleFullscreen: handleToggleFullscreen,
    onForkSession: handleForkSession,
    onToggleOrchestration: handleToggleOrchestration,
  });

  // ── MR link handling ─────────────────────────────────────────────
  const handleOpenMrLink = useCallback(
    (session: Session, url: string) => {
      selectSession(session);
      if (isElectron) {
        devbench.navigateTo(session.id, url, session.mr_urls);
      } else {
        window.open(url, "_blank");
      }
    },
    [selectSession]
  );

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="app">
      <div
        className={`sidebar-backdrop ${sidebarOpen ? "visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <Sidebar
        connectionStatus={connectionStatus}
        projects={projects}
        agentStatuses={agentStatuses}
        orphanedSessionIds={orphanedSessionIds}
        processingSourceSessionIds={processingSourceSessionIds}
        notifiedSessionIds={notifiedSessionIds}
        activeSessionId={activeSession?.id ?? null}
        activeProjectId={activeProjectId}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onAddProject={projectActions.handleAddProject}
        onEditProject={projectActions.handleEditProject}
        onDeleteProject={projectActions.handleDeleteProject}
        onNewSession={(projectId, type) => {
          sessionActions.handleNewSession(projectId, type);
          setSidebarOpen(false);
        }}
        onShowNewSessionPopup={(projectId) => {
          sessionActions.setNewSessionPopupProjectId(projectId);
          sessionActions.setNewSessionPopupOpen(true);
        }}
        onDeleteSession={sessionActions.handleDeleteSession}
        onReviveSession={sessionActions.handleReviveSession}
        onShowArchivedSessions={(projectId) => sessionActions.setArchivedProjectId(projectId)}
        onSelectSession={(session) => {
          selectSession(session);
          setSidebarOpen(false);
        }}
        onSelectProject={(projectId) => {
          selectProject(projectId);
          setSidebarOpen(false);
        }}
        onRenameSession={sessionActions.handleRenameSession}
        onEditSession={(id) => sessionActions.setEditingSessionId(id)}
        onOpenMrLink={(session, url) => {
          handleOpenMrLink(session, url);
          setSidebarOpen(false);
        }}
        onReorderProjects={projectActions.handleReorderProjects}
        onReorderSessions={sessionActions.handleReorderSessions}
        hasExtensionUpdates={hasExtensionUpdates}
        activeOrchestrationCount={activeOrchestrationCount}
        onOpenSettings={() => {
          setSettingsOpen((prev) => !prev);
          setSidebarOpen(false);
        }}
        onOpenGitButler={() => {
          preDashboardSessionRef.current = activeSession;
          preDashboardProjectIdRef.current = activeProjectId;
          setSettingsOpen(false);
          setDashboardMode("all");
          setSidebarOpen(false);
        }}
        onOpenOrchestration={() => {
          setOrchestrationOpen(true);
          setDashboardMode(null);
          setSettingsOpen(false);
          setSidebarOpen(false);
        }}
        onOpenProjectDashboard={(projId) => {
          preDashboardSessionRef.current = activeSession;
          preDashboardProjectIdRef.current = activeProjectId;
          setActiveProjectId(projId);
          setSettingsOpen(false);
          setDashboardMode("project");
          setSidebarOpen(false);
        }}
        onSetProjectActive={async (projectId, active) => {
          try {
            await setProjectActive(projectId, active);
            await loadProjects();
          } catch (e: any) {
            projectActions.setErrorMessage(e.message || "Failed to update project");
          }
        }}
      />
      {projectActions.projectFormOpen && (
        <ProjectFormModal
          project={projectActions.editingProject}
          onSubmit={projectActions.handleProjectFormSubmit}
          onCancel={projectActions.handleProjectFormCancel}
        />
      )}
      {sessionActions.newSessionPopupOpen && projects.length > 0 && (
        <NewSessionPopup
          projects={projects}
          initialProjectId={sessionActions.newSessionPopupProjectId}
          onSelect={(projectId, type, sourceUrl) => {
            sessionActions.handleNewSessionFromPopup(projectId, type, sourceUrl);
            setSidebarOpen(false);
          }}
          onClose={() => {
            sessionActions.setNewSessionPopupOpen(false);
            sessionActions.setNewSessionPopupProjectId(null);
          }}
        />
      )}
      {sessionActions.killSessionPopupOpen && activeSession && (
        <KillSessionPopup
          sessionName={activeSession.name}
          hasChanges={activeSession.has_changes}
          onConfirm={sessionActions.handleKillSessionConfirm}
          onCancel={() => sessionActions.setKillSessionPopupOpen(false)}
        />
      )}
      {sessionActions.renameSessionPopupOpen && activeSession && (
        <RenameSessionPopup
          sessionName={activeSession.name}
          onConfirm={sessionActions.handleRenameSessionConfirm}
          onCancel={() => sessionActions.setRenameSessionPopupOpen(false)}
        />
      )}
      {shortcutsHelpOpen && (
        <ShortcutsHelpPopup onClose={() => setShortcutsHelpOpen(false)} activeSessionType={activeSession?.type} />
      )}

      {sessionActions.archivedProjectId !== null && (
        <ArchivedSessionsPopup
          projectId={sessionActions.archivedProjectId}
          projectName={projects.find((p) => p.id === sessionActions.archivedProjectId)?.name ?? ""}
          onRevive={sessionActions.handleReviveSession}
          onDelete={(id) => deleteSessionPermanently(id)}
          onClose={() => sessionActions.setArchivedProjectId(null)}
        />
      )}
      {sessionActions.editingSessionId !== null && (() => {
        const editSession = projects.flatMap(p => p.sessions).find(s => s.id === sessionActions.editingSessionId);
        return editSession ? (
          <EditSessionPopup
            session={editSession}
            onClose={() => sessionActions.setEditingSessionId(null)}
            onUpdated={loadProjects}
          />
        ) : null;
      })()}
      {sessionActions.confirmDeleteSessionId !== null && (() => {
        const s = projects.flatMap(p => p.sessions).find(s => s.id === sessionActions.confirmDeleteSessionId);
        return (
          <ConfirmPopup
            title="Archive this session?"
            message={s?.has_changes ? "This session has unsaved changes that haven't been committed." : undefined}
            warning={!!s?.has_changes}
            danger
            confirmLabel="Yes, archive it"
            showPermanentDelete
            onConfirm={sessionActions.handleConfirmDeleteSession}
            onCancel={() => sessionActions.setConfirmDeleteSessionId(null)}
          />
        );
      })()}
      {projectActions.confirmDeleteProjectId !== null && (
        <ConfirmPopup
          title="Delete this project?"
          message="This will delete the project and kill all its sessions."
          danger
          confirmLabel="Yes, delete"
          onConfirm={projectActions.handleConfirmDeleteProject}
          onCancel={() => projectActions.setConfirmDeleteProjectId(null)}
        />
      )}
      {projectActions.errorMessage && (
        <ErrorPopup
          message={projectActions.errorMessage}
          onClose={() => projectActions.setErrorMessage(null)}
        />
      )}
      {sessionActions.errorMessage && (
        <ErrorPopup
          message={sessionActions.errorMessage}
          onClose={() => sessionActions.setErrorMessage(null)}
        />
      )}
      {sessionActions.closingSessionId !== null && (() => {
        const closeSession = projects.flatMap(p => p.sessions).find(s => s.id === sessionActions.closingSessionId);
        return closeSession ? (
          <CloseSessionPopup
            session={closeSession}
            onClose={() => sessionActions.setClosingSessionId(null)}
            onConfirmClose={sessionActions.handleConfirmClose}
          />
        ) : null;
      })()}
      {sessionActions.closeToast && (
        <CloseSessionToast
          toast={sessionActions.closeToast}
          onDismiss={sessionActions.dismissCloseToast}
        />
      )}
      {diffTarget && diffFullscreen ? (
        <main className="main-content">
          <DiffViewer
            diffTarget={diffTarget}
            onClose={handleCloseDiff}
            fullscreen
            onToggleFullscreen={handleToggleFullscreen}
            onChangeDiffTarget={setDiffTarget}
          />
        </main>
      ) : settingsOpen ? (
        <SettingsPane
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          onClose={() => {
            setSettingsOpen(false);
            // Re-check extension statuses (user may have updated)
            fetchExtensionStatuses().then((statuses) => {
              setHasExtensionUpdates(Object.values(statuses).some((s) => s.installed && !s.upToDate));
            });
          }}
          hasUnreadNotifications={notifiedSessionIds.size > 0}
          onExtensionsChanged={() => {
            fetchExtensionStatuses().then((statuses) => {
              setHasExtensionUpdates(Object.values(statuses).some((s) => s.installed && !s.upToDate));
            });
          }}
        />
      ) : orchestrationOpen ? (
        <OrchestrationDashboard
          projects={projects}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          onClose={() => setOrchestrationOpen(false)}
          onNavigateToSession={(sessionId) => {
            // Find the session across all projects and navigate to it
            for (const p of projects) {
              const s = p.sessions.find((s) => s.id === sessionId);
              if (s) {
                setOrchestrationOpen(false);
                selectSession(s);
                return;
              }
            }
          }}
          hasUnreadNotifications={notifiedSessionIds.size > 0}
        />
      ) : dashboardMode ? (
        <GitButlerDashboard
          ref={gitButlerDashboardRef}
          mode={dashboardMode}
          projectId={activeProjectId}
          projects={projects}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          onClose={() => {
            setDashboardMode(null);
            if (preDashboardSessionRef.current) {
              selectSession(preDashboardSessionRef.current);
              preDashboardSessionRef.current = null;
            }
          }}
          onNavigateToSession={handleDashboardNavigateToSession}
          hasUnreadNotifications={notifiedSessionIds.size > 0}
          onViewDiff={handleDashboardViewDiff}
        />
      ) : (
        <MainContent
          activeSession={activeSession}
          activeProject={activeProject}
          projects={projects}
          orphanedSessionIds={orphanedSessionIds}
          browserOpenForSession={browserOpenForSession}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          browser={browser}
          resizer={resizer}
          onSessionEnded={sessionActions.handleSessionEnded}
          onSessionRenamed={(newName) => {
            setActiveSession((prev) => prev ? { ...prev, name: newName } : prev);
            loadProjects();
          }}
          onMrLinkFound={() => loadProjects()}
          onReviveSession={sessionActions.handleReviveSession}
          onDeleteSession={sessionActions.handleDeleteSession}
          navigate={navigate}
          gitCommitPushRef={gitCommitPushRef}
          gitCommitPushPending={gitCommitPushPending}
          onGitCommitPush={handleGitCommitPush}
          onOpenGitButlerDashboard={handleToggleProjectDashboard}
          onCloseSession={sessionActions.handleCloseSession}
          splitDiffTarget={diffTarget && !diffFullscreen ? diffTarget : null}
          onSetSplitDiffTarget={(target) => {
            setDiffTarget(target);
            if (target) {
              setDiffFullscreen(false);
              diffFromDashboardRef.current = false;
              diffFromDashboardModeRef.current = null;
            }
          }}
          onToggleFullscreen={handleToggleFullscreen}
          browserFullscreen={browserFullscreen}
          hasUnreadNotifications={notifiedSessionIds.size > 0}
          onForkSession={handleForkSession}
        />
      )}
    </div>
  );
}
