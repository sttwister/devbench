import { useEffect } from "react";
import type { Terminal } from "@xterm/xterm";

/**
 * Enables touch scrolling on the terminal pane.
 *
 * All sessions run inside tmux which uses the alternate screen buffer,
 * so xterm.js's own scrollback is always empty.  On desktop, mouse-
 * wheel events are forwarded by xterm.js as SGR mouse reports that
 * tmux understands.  Touch events don't generate wheel events.
 *
 * We use Pointer Events with setPointerCapture() instead of touch
 * events.  xterm.js's DOM renderer replaces child elements when tmux
 * redraws the screen; if the original touch-target element is removed
 * the browser fires touchcancel and stops delivering events.  Pointer
 * capture locks all subsequent pointer events to our stable container
 * element regardless of DOM mutations underneath.
 *
 * The pointermove handler only accumulates the pixel delta (O(1)).
 * Actual scrolling is deferred to requestAnimationFrame so all deltas
 * within one display frame are batched into a single operation:
 *
 *  • Mouse-mode active (tmux): batched SGR mouse-wheel escape
 *    sequences sent in one WebSocket message.
 *  • Mouse-mode inactive: term.scrollLines().
 */
export function useTerminalTouchScroll(
  containerRef: React.RefObject<HTMLDivElement | null>,
  termRef: React.RefObject<Terminal | null>,
  wsRef: React.RefObject<WebSocket | null>
) {
  useEffect(() => {
    const el = containerRef.current;
    const term = termRef.current;
    if (!el || !term) return;

    let pointerStartY: number | null = null;
    let accumulatedDelta = 0;
    let scrollRafId: number | null = null;
    let wasTap = true;
    const xtermEl = el.querySelector(".xterm") as HTMLElement | null;

    const flushScroll = () => {
      scrollRafId = null;
      const ws = wsRef.current;
      const lineHeight = term.options.fontSize ?? 14;
      const lines = Math.trunc(accumulatedDelta / lineHeight);
      if (lines === 0) return;

      const mouseActive = xtermEl?.classList.contains("enable-mouse-events");
      if (mouseActive && ws && ws.readyState === WebSocket.OPEN) {
        const button = lines > 0 ? 65 : 64;
        const col = Math.max(1, Math.floor((term.cols || 80) / 2));
        const row = Math.max(1, Math.floor((term.rows || 24) / 2));
        const seq = `\x1b[<${button};${col};${row}M`;
        ws.send(seq.repeat(Math.abs(lines)));
      } else {
        term.scrollLines(lines);
      }
      accumulatedDelta -= lines * lineHeight;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      el.setPointerCapture(e.pointerId);
      pointerStartY = e.clientY;
      accumulatedDelta = 0;
      wasTap = true;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || pointerStartY === null) return;

      accumulatedDelta += pointerStartY - e.clientY;
      pointerStartY = e.clientY;
      wasTap = false;

      if (scrollRafId === null) {
        scrollRafId = requestAnimationFrame(flushScroll);
      }

      e.preventDefault();
    };

    const handlePointerUpOrCancel = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;

      if (wasTap) term.focus();

      pointerStartY = null;
      if (scrollRafId !== null) {
        cancelAnimationFrame(scrollRafId);
        scrollRafId = null;
      }
      flushScroll();
      accumulatedDelta = 0;
    };

    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove, { passive: false });
    el.addEventListener("pointerup", handlePointerUpOrCancel);
    el.addEventListener("pointercancel", handlePointerUpOrCancel);

    return () => {
      if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUpOrCancel);
      el.removeEventListener("pointercancel", handlePointerUpOrCancel);
    };
  }, [containerRef, termRef, wsRef]);
}
