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
export function playNotificationSound(): void {
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

/** Show a browser Notification popup for a session. */
export function showBrowserNotification(
  sessionId: number,
  sessionName: string,
  projectName: string,
  onClick?: (sessionId: number) => void,
): void {
  if (
    !getBrowserNotificationsEnabled() ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) return;

  const title = sessionName
    ? `✉️ ${sessionName}`
    : `✉️ Session #${sessionId}`;

  const body = projectName
    ? `${projectName} — waiting for input`
    : "Waiting for input";

  const notification = new Notification(title, {
    body,
    tag: `devbench-session-${sessionId}`,
    icon: "/icon-192.png",
  });

  notification.onclick = () => {
    window.focus();
    onClick?.(sessionId);
    notification.close();
  };
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
