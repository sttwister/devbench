import { useState, useRef, useCallback } from "react";
import type { Terminal } from "@xterm/xterm";

const isTouchDevice =
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export type ModifierState = "off" | "armed" | "locked";

/**
 * Arrow key escape sequences with modifier parameters.
 *
 * Base:     \x1b[A
 * Ctrl:     \x1b[1;5A
 * Alt:      \x1b[1;3A
 * Ctrl+Alt: \x1b[1;7A
 */
function arrowSequence(
  dir: "up" | "down" | "left" | "right",
  ctrl: boolean,
  alt: boolean
): string {
  const suffix = { up: "A", down: "B", right: "C", left: "D" }[dir];
  if (ctrl && alt) return `\x1b[1;7${suffix}`;
  if (ctrl) return `\x1b[1;5${suffix}`;
  if (alt) return `\x1b[1;3${suffix}`;
  return `\x1b[${suffix}`;
}

/**
 * Mobile keyboard bar state and key-sending logic.
 *
 * Manages Ctrl / Alt sticky modifiers and sends escape sequences
 * for special keys (Esc, Tab, arrows) directly via the WebSocket.
 *
 * Also exposes a `dataTransformRef` that `useTerminalWebSocket`
 * applies to every regular keystroke — when a modifier is armed or
 * locked the transform converts the character (e.g. 'c' → \x03
 * for Ctrl+C).
 */
export function useMobileKeyboard(
  termRef: React.RefObject<Terminal | null>,
  wsRef: React.RefObject<WebSocket | null>
) {
  const [ctrlState, setCtrlState] = useState<ModifierState>("off");
  const [altState, setAltState] = useState<ModifierState>("off");

  // Refs mirror React state so callbacks always read the latest value
  // without needing to re-subscribe.
  const ctrlRef = useRef<ModifierState>("off");
  const altRef = useRef<ModifierState>("off");
  ctrlRef.current = ctrlState;
  altRef.current = altState;

  /** Deactivate armed (not locked) modifiers after a keypress. */
  const consumeModifiers = useCallback(() => {
    if (ctrlRef.current === "armed") {
      ctrlRef.current = "off";
      setCtrlState("off");
    }
    if (altRef.current === "armed") {
      altRef.current = "off";
      setAltState("off");
    }
  }, []);

  // ── Modifier toggles: off → armed → locked → off ────────────
  const toggleCtrl = useCallback(() => {
    setCtrlState((prev) => {
      const next = prev === "off" ? "armed" : prev === "armed" ? "locked" : "off";
      ctrlRef.current = next;
      return next;
    });
  }, []);

  const toggleAlt = useCallback(() => {
    setAltState((prev) => {
      const next = prev === "off" ? "armed" : prev === "armed" ? "locked" : "off";
      altRef.current = next;
      return next;
    });
  }, []);

  // ── Send a named key (Esc / Tab / arrows) ───────────────────
  const sendKey = useCallback(
    (key: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const ctrl = ctrlRef.current !== "off";
      const alt = altRef.current !== "off";

      switch (key) {
        case "esc":
          ws.send("\x1b");
          break;
        case "tab":
          ws.send("\t");
          break;
        case "slash":
          ws.send("/");
          break;
        case "up":
        case "down":
        case "left":
        case "right":
          ws.send(arrowSequence(key, ctrl, alt));
          break;
      }

      consumeModifiers();
      // On desktop, refocus the terminal.  On mobile the native <input> should
      // keep focus so the virtual keyboard stays open; the keyboard bar already
      // uses preventDefault on mouseDown to avoid stealing focus.
      if (!isTouchDevice) termRef.current?.focus();
    },
    [wsRef, termRef, consumeModifiers]
  );

  // ── Data transform for regular keyboard input ────────────────
  // Assigned directly (not via useEffect) so it's always the
  // latest closure.  useTerminalWebSocket reads .current at
  // call-time inside its onData handler.
  const dataTransformRef = useRef<((data: string) => string) | null>(null);

  dataTransformRef.current = (data: string): string => {
    const ctrl = ctrlRef.current !== "off";
    const alt = altRef.current !== "off";

    if (!ctrl && !alt) return data;

    let result = data;

    if (ctrl && data.length === 1) {
      const code = data.charCodeAt(0);
      // a-z / A-Z → control character  (Ctrl+A = 0x01 … Ctrl+Z = 0x1A)
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
        result = String.fromCharCode(code & 0x1f);
      } else {
        switch (data) {
          case " ":  result = "\x00"; break; // Ctrl+Space
          case "[":  result = "\x1b"; break; // Ctrl+[  = Esc
          case "\\": result = "\x1c"; break;
          case "]":  result = "\x1d"; break;
          case "^":  result = "\x1e"; break;
          case "_":  result = "\x1f"; break;
          case "?":  result = "\x7f"; break; // Ctrl+? = DEL
        }
      }
    }

    if (alt) {
      result = "\x1b" + result;
    }

    consumeModifiers();
    return result;
  };

  return {
    ctrlState,
    altState,
    toggleCtrl,
    toggleAlt,
    sendKey,
    dataTransformRef,
  };
}
