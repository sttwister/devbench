import { useEffect } from "react";
import type { Terminal } from "@xterm/xterm";

/** True on touch-primary devices (phones / tablets without a fine pointer). */
const isTouchDevice =
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/**
 * Auto-refocus: keep the terminal focused.
 *
 * Prevent clicks on non-interactive elements (sidebar, empty space, etc.)
 * from stealing focus away from the terminal.  Also pull focus back when
 * it moves programmatically (e.g. a popup unmounts and focus falls to body).
 *
 * Exceptions: form inputs, iframes (browser pane), contenteditable, and
 * popup/modal overlays (which rely on focus for keyboard & onBlur handling).
 * Don't interfere with drag handles — preventing mousedown breaks HTML5 DnD.
 *
 * On touch devices the hook is a no-op: focusing the terminal opens the
 * virtual keyboard, so the user must tap the terminal explicitly.
 */
export function useTerminalAutoFocus(
  containerRef: React.RefObject<HTMLDivElement | null>,
  termRef: React.RefObject<Terminal | null>
) {
  useEffect(() => {
    if (isTouchDevice) return;

    const el = containerRef.current;
    const term = termRef.current;
    if (!el || !term) return;

    const isOverlayOpen = () =>
      !!document.querySelector(
        ".popup-overlay, .new-session-popup-backdrop, .modal-overlay"
      );

    const shouldKeepTerminalFocus = (target: HTMLElement): boolean => {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "IFRAME") return false;
      if (target.isContentEditable) return false;
      if (el.contains(target)) return false;
      if (isOverlayOpen()) return false;
      if (target.closest(".drag-handle") || target.closest("[draggable]")) return false;
      return true;
    };

    // preventDefault() on mousedown stops the browser from moving focus away
    // from the terminal.  Click events still fire normally.
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || !shouldKeepTerminalFocus(target)) return;
      e.preventDefault();
      term.focus();
    };

    // Fallback: catch programmatic focus changes (e.g. popup close moves
    // focus to <body>) and pull focus back to the terminal.
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (!target || !shouldKeepTerminalFocus(target)) return;
      term.focus();
    };

    // When a popup unmounts, its focused element is removed from the DOM.
    // Browsers move focus to <body> but don't fire focusin, so the handler
    // above never runs.  Listen for focusout and, one frame later, check
    // whether focus silently fell to <body> with no popup open.
    let rafId: number | null = null;
    const handleFocusOut = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const active = document.activeElement;
        if (
          (!active || active === document.body || active === document.documentElement) &&
          !isOverlayOpen()
        ) {
          term.focus();
        }
      });
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [containerRef, termRef]);
}
