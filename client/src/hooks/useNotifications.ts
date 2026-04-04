// @lat: [[client#Notifications]]
import { useEffect, useRef } from "react";
import type { Project } from "../api";
import type { EventSocket } from "./useEventSocket";

// ── Notification sound via Web Audio API ────────────────────────────

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

/** Play a short "ding" notification sound. */
function playNotificationSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Resume if suspended (autoplay policy)
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;

  // Oscillator: short sine wave at 800Hz
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(800, now);
  osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);

  // Gain envelope: quick attack, smooth decay
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.3);
}

// ── Local storage preferences ───────────────────────────────────────

const PREF_SOUND = "devbench:notification-sound";
const PREF_BROWSER = "devbench:notification-browser";

export function getNotificationSoundEnabled(): boolean {
  return localStorage.getItem(PREF_SOUND) !== "false";
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  localStorage.setItem(PREF_SOUND, enabled ? "true" : "false");
}

export function getBrowserNotificationsEnabled(): boolean {
  return localStorage.getItem(PREF_BROWSER) !== "false";
}

export function setBrowserNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(PREF_BROWSER, enabled ? "true" : "false");
}

// ── Rate limiting ───────────────────────────────────────────────────

const MIN_NOTIFICATION_INTERVAL_MS = 1000;

// ── Hook ────────────────────────────────────────────────────────────

interface UseNotificationsOptions {
  eventSocket: EventSocket;
  activeSessionId: number | null;
  projects: Project[];
}

/**
 * Fires browser notifications and plays sounds when the server pushes
 * a `session-notified` event via the events WebSocket.
 *
 * Because notifications are triggered by real-time push events (not poll
 * diffs), they only fire for live transitions — opening the app with
 * existing unread notifications does NOT trigger sound or popups.
 */
export function useNotifications({
  eventSocket,
  activeSessionId,
  projects,
}: UseNotificationsOptions): void {
  const lastNotificationTime = useRef<number>(0);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Build a session lookup map for notification titles
  const sessionMapRef = useRef<Map<number, { name: string; projectName: string }>>(new Map());
  useEffect(() => {
    const map = new Map<number, { name: string; projectName: string }>();
    for (const project of projects) {
      for (const session of project.sessions) {
        map.set(session.id, { name: session.name, projectName: project.name });
      }
    }
    sessionMapRef.current = map;
  }, [projects]);

  // Subscribe to session-notified events from the WebSocket
  useEffect(() => {
    const unsub = eventSocket.on("session-notified", (event) => {
      const sessionId = event.sessionId as number;

      // Don't notify for the session the user is currently looking at
      if (sessionId === activeSessionIdRef.current) return;

      // Rate limiting
      const now = Date.now();
      if (now - lastNotificationTime.current < MIN_NOTIFICATION_INTERVAL_MS) return;
      lastNotificationTime.current = now;

      // Play sound
      if (getNotificationSoundEnabled()) {
        playNotificationSound();
      }

      // Browser notification (only if tab is hidden or not focused)
      if (
        getBrowserNotificationsEnabled() &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        (document.hidden || !document.hasFocus())
      ) {
        const info = sessionMapRef.current.get(sessionId);
        const title = info
          ? `${info.name} — ${info.projectName}`
          : `Session #${sessionId}`;

        const notification = new Notification("Devbench — Waiting for input", {
          body: title,
          tag: `devbench-session-${sessionId}`,
          icon: "/icon-192.png",
        });

        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      }
    });

    return unsub;
  }, [eventSocket]);
}

/** Request notification permission (must be called from a user gesture). */
export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return Promise.resolve("denied" as NotificationPermission);
  return Notification.requestPermission();
}

/** Get current notification permission state. */
export function getNotificationPermission(): NotificationPermission {
  if (typeof Notification === "undefined") return "denied";
  return Notification.permission;
}
