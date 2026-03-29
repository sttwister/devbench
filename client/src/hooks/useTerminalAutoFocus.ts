import { useEffect } from "react";
import type { Terminal } from "@xterm/xterm";

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
 */
export function useTerminalAutoFocus(
  containerRef: React.RefObject<HTMLDivElement | null>,
  termRef: React.RefObject<Terminal | null>
) {
  useEffect(() => {
    const el = containerRef.current;
    const term = termRef.current;
    if (!el || !term) return;

    const shouldKeepTerminalFocus = (target: HTMLElement): boolean => {
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "IFRAME") return false;
      if (target.isContentEditable) return false;
      if (el.contains(target)) return false;
      if (document.querySelector(".popup-overlay, .new-session-popup-backdrop, .modal-overlay")) return false;
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

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [containerRef, termRef]);
}
