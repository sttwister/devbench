// @lat: [[client#Notifications]]
import { useEffect, useRef, useCallback, useState } from "react";
import type { AgentStatus } from "../api";

/** localStorage key for the notification sound preference. */
const SOUND_ENABLED_KEY = "devbench:notification-sound";
/** localStorage key for the notifications enabled preference. */
const NOTIFICATIONS_ENABLED_KEY = "devbench:notifications-enabled";

/** Generate a short ding sound using the Web Audio API. */
function playDing(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);

    // Clean up after playback
    osc.onended = () => ctx.close();
  } catch {
    // AudioContext not available — silently ignore
  }
}

/** Show a native browser notification. */
function showBrowserNotification(sessionName: string): void {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    new Notification("Session ready", {
      body: `${sessionName} is waiting for input`,
      tag: `devbench-session-ready`,
      // Reuse tag so multiple quick notifications collapse into one
    });
  } catch {
    // Some mobile browsers throw even after permission checks — ignore
  }
}

export interface NotificationState {
  /** Session IDs that have triggered a notification and haven't been acknowledged. */
  notifiedSessionIds: Set<number>;
  /** Whether notification sound is enabled. */
  soundEnabled: boolean;
  /** Whether notifications are enabled at all. */
  notificationsEnabled: boolean;
  /** Toggle sound on/off (persisted to localStorage). */
  setSoundEnabled: (enabled: boolean) => void;
  /** Toggle notifications on/off (persisted to localStorage). */
  setNotificationsEnabled: (enabled: boolean) => void;
  /** Mark a session ID to suppress the next notification (e.g. after Ctrl+Shift+G). */
  suppressNext: (sessionId: number) => void;
  /** Clear the notification indicator for a session (e.g. when user selects it). */
  acknowledgeSession: (sessionId: number) => void;
}

/**
 * Tracks agent status transitions and fires notifications when a session
 * goes from "working" to "waiting". Suppresses notifications for sessions
 * where the user explicitly triggered work (e.g. Ctrl+Shift+G commit-push)
 * and for the currently active session.
 */
export function useNotifications(
  agentStatuses: Record<string, AgentStatus>,
  projects: { sessions: { id: number; name: string; type: string }[] }[],
  activeSessionId: number | null,
): NotificationState {
  const prevStatuses = useRef<Record<string, AgentStatus>>({});
  const suppressSet = useRef<Set<number>>(new Set());
  const [notifiedSessionIds, setNotifiedSessionIds] = useState<Set<number>>(new Set());

  const [soundEnabled, setSoundEnabledState] = useState<boolean>(() => {
    const stored = localStorage.getItem(SOUND_ENABLED_KEY);
    return stored === null ? true : stored === "true";
  });

  const [notificationsEnabled, setNotificationsEnabledState] = useState<boolean>(() => {
    const stored = localStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
    return stored === null ? true : stored === "true";
  });

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setSoundEnabledState(enabled);
    localStorage.setItem(SOUND_ENABLED_KEY, String(enabled));
  }, []);

  const setNotificationsEnabled = useCallback((enabled: boolean) => {
    setNotificationsEnabledState(enabled);
    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, String(enabled));
    // Request permission when enabling
    if (enabled && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const suppressNext = useCallback((sessionId: number) => {
    suppressSet.current.add(sessionId);
  }, []);

  const acknowledgeSession = useCallback((sessionId: number) => {
    setNotifiedSessionIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  // Request notification permission on mount if notifications are enabled
  useEffect(() => {
    if (notificationsEnabled && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // Detect status transitions
  useEffect(() => {
    if (!notificationsEnabled) {
      prevStatuses.current = { ...agentStatuses };
      return;
    }

    const prev = prevStatuses.current;
    const newNotified: number[] = [];

    for (const [idStr, status] of Object.entries(agentStatuses)) {
      const id = Number(idStr);
      const prevStatus = prev[idStr];

      // Only notify on working → waiting transitions
      if (prevStatus === "working" && status === "waiting") {
        if (suppressSet.current.has(id)) {
          // This transition was expected (e.g. after commit-push) — skip
          suppressSet.current.delete(id);
          continue;
        }
        // Never notify for the session the user is currently looking at
        if (id === activeSessionId) continue;
        newNotified.push(id);
      }
    }

    prevStatuses.current = { ...agentStatuses };

    if (newNotified.length > 0) {
      // Find session names for notification text
      const sessionMap = new Map<number, string>();
      for (const p of projects) {
        for (const s of p.sessions) {
          sessionMap.set(s.id, s.name);
        }
      }

      // Update notified set
      setNotifiedSessionIds((prev) => {
        const next = new Set(prev);
        for (const id of newNotified) next.add(id);
        return next;
      });

      // Fire notification for each session
      for (const id of newNotified) {
        const name = sessionMap.get(id) ?? "Session";
        showBrowserNotification(name);
      }

      // Play sound once for the batch
      if (soundEnabled) {
        playDing();
      }
    }
  }, [agentStatuses, notificationsEnabled, soundEnabled, projects, activeSessionId]);

  return {
    notifiedSessionIds,
    soundEnabled,
    notificationsEnabled,
    setSoundEnabled,
    setNotificationsEnabled,
    suppressNext,
    acknowledgeSession,
  };
}
