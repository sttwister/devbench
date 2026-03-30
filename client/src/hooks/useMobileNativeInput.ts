import { useRef, useCallback } from "react";

const isTouchDevice =
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/**
 * Native text input for mobile devices.
 *
 * xterm.js uses a hidden textarea for keyboard input.  On mobile this breaks
 * autocomplete and voice dictation because:
 *   1. The textarea is cleared on blur (which happens often on touch devices).
 *   2. When autocomplete / dictation re-fills the textarea, xterm diffs against
 *      an empty string and re-sends the *entire* content.
 *   3. Blur during dictation causes speech recognition to stop prematurely.
 *
 * This hook provides a visible native `<input>` whose value we control.  We
 * track what has already been sent to the terminal and only send the diff.
 * Composition events (IME, autocomplete, dictation) are handled correctly by
 * deferring the diff until composition ends.
 */
export function useMobileNativeInput(
  wsRef: React.RefObject<WebSocket | null>,
  dataTransformRef?: React.RefObject<((data: string) => string) | null>,
) {
  const inputRef = useRef<HTMLDivElement>(null);
  /** Mirror of what we've already sent to the terminal. */
  const sentRef = useRef("");
  /** True while a composition session (IME / autocomplete / dictation) is active. */
  const composingRef = useRef(false);

  const getText = () => inputRef.current?.textContent ?? "";
  const setText = (v: string) => { if (inputRef.current) inputRef.current.textContent = v; };

  // ── Helpers ──────────────────────────────────────────────────

  const send = useCallback(
    (data: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    [wsRef],
  );

  /**
   * Compute the diff between `sentRef` (what we already sent) and the
   * current input value, then send backspaces + new characters.
   */
  const flush = useCallback(() => {
    if (!inputRef.current) return;

    const cur = getText();
    const prev = sentRef.current;
    if (cur === prev) return;

    // Longest common prefix
    let i = 0;
    while (i < prev.length && i < cur.length && prev[i] === cur[i]) i++;

    const dels = prev.length - i; // characters removed after the common prefix
    const added = cur.slice(i);   // characters inserted after the common prefix

    let payload = "\x7f".repeat(dels);

    if (added) {
      const transform = dataTransformRef?.current;
      if (transform) {
        for (const ch of added) payload += transform(ch);
      } else {
        payload += added;
      }
    }

    if (payload) send(payload);
    sentRef.current = cur;
  }, [send, dataTransformRef]);

  // ── Event handlers (attached to the <input>) ────────────────

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback(() => {
    composingRef.current = false;
    flush();
  }, [flush]);

  /** Normal (non-composition) input — forward the diff immediately. */
  const onInput = useCallback(() => {
    if (composingRef.current) return;
    flush();
  }, [flush]);

  const clearInput = () => {
    setText("");
    sentRef.current = "";
  };

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // During composition (voice dictation, IME) let the browser handle
      // all keys — otherwise saying "new line" during dictation fires
      // Enter which would send + clear the input prematurely.
      if (e.nativeEvent.isComposing || composingRef.current) return;

      // ── Enter ────────────────────────────────────────────
      if (e.key === "Enter") {
        e.preventDefault();
        send("\r");
        clearInput();
        return;
      }

      // ── Tab ──────────────────────────────────────────────
      if (e.key === "Tab") {
        e.preventDefault();
        send("\t");
        clearInput();
        return;
      }

      // ── Escape ───────────────────────────────────────────
      if (e.key === "Escape") {
        e.preventDefault();
        send("\x1b");
        clearInput();
        return;
      }

      // ── ArrowUp / ArrowDown (command history) ────────────
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        send(e.key === "ArrowUp" ? "\x1b[A" : "\x1b[B");
        clearInput();
        return;
      }

      // ── Backspace when input is already empty ────────────
      if (e.key === "Backspace" && getText() === "") {
        send("\x7f");
        return;
      }

      // ── Ctrl+key on physical keyboard ────────────────────
      if (e.ctrlKey && !e.metaKey && e.key.length === 1) {
        const code = e.key.toLowerCase().charCodeAt(0);
        if (code >= 97 && code <= 122) {
          e.preventDefault();
          send(String.fromCharCode(code - 96));
          return;
        }
      }

      // ── Alt+key on physical keyboard ─────────────────────
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
        e.preventDefault();
        send("\x1b" + e.key);
        return;
      }
    },
    [send],
  );

  // ── Public API ───────────────────────────────────────────────

  /** Clear the input and sent-state (called after keyboard-bar special keys). */
  const clear = useCallback(() => {
    clearInput();
  }, []);

  const focus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  return {
    inputRef,
    onCompositionStart,
    onCompositionEnd,
    onInput,
    onKeyDown,
    clear,
    focus,
    /** True on touch-primary devices where this hook is active. */
    enabled: isTouchDevice,
  };
}
