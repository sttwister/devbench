import { useEffect, useState, useCallback, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import { swipeLock } from "./swipeLock";

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_THRESHOLD = 10; // px
const ADJUST_DRAG_THRESHOLD = 5; // px before adjustment drag begins
const HANDLE_OFFSET_Y = 34; // px — shift touch up during adjustment to account for handle below text

/** Convert touch pixel position to terminal cell coordinates (viewport-relative). */
function pixelToCell(
  touchX: number,
  touchY: number,
  screenEl: Element,
  term: Terminal,
): { col: number; row: number } {
  const rect = screenEl.getBoundingClientRect();
  const cellWidth = rect.width / term.cols;
  const cellHeight = rect.height / term.rows;
  return {
    col: Math.min(Math.max(Math.floor((touchX - rect.left) / cellWidth), 0), term.cols - 1),
    row: Math.min(Math.max(Math.floor((touchY - rect.top) / cellHeight), 0), term.rows - 1),
  };
}

/** Apply a selection range in xterm, handling reversed (upward/leftward) drags. */
function applySelection(
  term: Terminal,
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
) {
  let sCol = startCol, sRow = startRow, eCol = endCol, eRow = endRow;
  if (sRow > eRow || (sRow === eRow && sCol > eCol)) {
    [sCol, sRow, eCol, eRow] = [eCol, eRow, sCol, sRow];
  }
  const length = (eRow - sRow) * term.cols + (eCol - sCol) + 1;
  term.select(sCol, sRow, length);
}

/** Read the text content of a terminal viewport row. */
function getLineText(term: Terminal, viewportRow: number): string {
  const buffer = term.buffer.active;
  const line = buffer.getLine(viewportRow + buffer.viewportY);
  if (!line) return "";
  let text = "";
  for (let c = 0; c < term.cols; c++) {
    const cell = line.getCell(c);
    text += cell?.getChars() || " ";
  }
  return text;
}

/** Check whether a cell falls inside the current selection range. */
function isCellInSelection(
  col: number,
  row: number,
  anchorCol: number,
  anchorRow: number,
  endCol: number,
  endRow: number,
): boolean {
  let sCol = anchorCol, sRow = anchorRow, eCol = endCol, eRow = endRow;
  if (sRow > eRow || (sRow === eRow && sCol > eCol)) {
    [sCol, sRow, eCol, eRow] = [eCol, eRow, sCol, sRow];
  }
  if (row < sRow || row > eRow) return false;
  if (row === sRow && col < sCol) return false;
  if (row === eRow && col > eCol) return false;
  return true;
}

/** Find word boundaries around a column position in a line of text. */
function getWordBounds(text: string, col: number): { start: number; end: number } {
  const isWordChar = (c: string) => /[\w\-\.\/\:\@\~]/.test(c);

  if (col >= text.length || !isWordChar(text[col])) {
    return { start: col, end: col };
  }

  let start = col;
  while (start > 0 && isWordChar(text[start - 1])) start--;

  let end = col;
  while (end < text.length - 1 && isWordChar(text[end + 1])) end++;

  return { start, end };
}

/**
 * Enables touch scrolling and long-press text selection on the terminal pane.
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
 *
 * Long-press (500 ms) enters selection mode:
 *  1. The word under the finger is auto-selected.
 *  2. Dragging while still holding extends the selection.
 *  3. After lifting, touch + drag adjusts the nearest edge.
 *  4. The keyboard bar shows Copy / Select All / Cancel.
 *  5. Tapping the terminal while in selection mode is a no-op
 *     (use the Cancel button to exit).
 */
/**
 * @param onTap  Optional callback invoked on a tap (non-scroll) gesture.
 *               When provided the handler also calls `preventDefault()` on
 *               `pointerdown` to stop the browser from blurring the native
 *               mobile input (which would dismiss the virtual keyboard).
 *               When omitted the terminal is focused on tap (desktop default).
 */
export function useTerminalTouchScroll(
  containerRef: React.RefObject<HTMLDivElement | null>,
  termRef: React.RefObject<Terminal | null>,
  wsRef: React.RefObject<WebSocket | null>,
  onTap?: () => void,
) {
  const [selectionMode, setSelectionMode] = useState(false);
  const selectionModeRef = useRef(false);
  const [copiedFeedback, setCopiedFeedback] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showCopiedFeedback = useCallback(() => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    setCopiedFeedback(true);
    copiedTimerRef.current = setTimeout(() => setCopiedFeedback(false), 1500);
  }, []);

  // ── Selection handle refs (positioned via direct DOM access) ──
  const startHandleRef = useRef<HTMLDivElement>(null);
  const endHandleRef = useRef<HTMLDivElement>(null);

  /** Position the two teardrop handles at the edges of the selection. */
  const positionHandles = useCallback((
    sCol: number, sRow: number, eCol: number, eRow: number,
  ) => {
    const el = containerRef.current;
    const term = termRef.current;
    if (!el || !term) return;
    const screenEl = el.querySelector(".xterm-screen");
    if (!screenEl) return;

    // Normalize so start is before end
    if (sRow > eRow || (sRow === eRow && sCol > eCol)) {
      [sCol, sRow, eCol, eRow] = [eCol, eRow, sCol, sRow];
    }

    const sr = screenEl.getBoundingClientRect();
    const cr = el.getBoundingClientRect();
    const cw = sr.width / term.cols;
    const ch = sr.height / term.rows;
    const ox = sr.left - cr.left;
    const oy = sr.top - cr.top;

    const sh = startHandleRef.current;
    const eh = endHandleRef.current;
    if (sh) {
      sh.style.display = "";
      sh.style.left = `${ox + sCol * cw}px`;
      sh.style.top = `${oy + (sRow + 1) * ch}px`;
    }
    if (eh) {
      eh.style.display = "";
      eh.style.left = `${ox + (eCol + 1) * cw}px`;
      eh.style.top = `${oy + (eRow + 1) * ch}px`;
    }
  }, [containerRef, termRef]);

  const hideHandles = useCallback(() => {
    if (startHandleRef.current) startHandleRef.current.style.display = "none";
    if (endHandleRef.current) endHandleRef.current.style.display = "none";
  }, []);

  const copySelection = useCallback(() => {
    const term = termRef.current;
    if (term) {
      const text = term.getSelection();
      if (text) {
        navigator.clipboard.writeText(text);
        showCopiedFeedback();
      }
      term.clearSelection();
    }
    hideHandles();
    selectionModeRef.current = false;
    setSelectionMode(false);
  }, [termRef, showCopiedFeedback, hideHandles]);

  const cancelSelection = useCallback(() => {
    termRef.current?.clearSelection();
    hideHandles();
    selectionModeRef.current = false;
    setSelectionMode(false);
  }, [termRef, hideHandles]);

  const selectAllText = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    term.selectAll();
    selectionModeRef.current = true;
    setSelectionMode(true);
    positionHandles(0, 0, term.cols - 1, term.rows - 1);
  }, [termRef, positionHandles]);

  useEffect(() => {
    const el = containerRef.current;
    const term = termRef.current;
    if (!el || !term) return;

    let pointerStartX: number | null = null;
    let pointerStartY: number | null = null;
    let accumulatedDelta = 0;
    let scrollRafId: number | null = null;
    let wasTap = true;
    /** null = undecided, true = vertical (scroll), false = horizontal (ignore) */
    let directionVertical: boolean | null = null;
    const DIRECTION_THRESHOLD = 10; // px before deciding direction
    const xtermEl = el.querySelector(".xterm") as HTMLElement | null;

    // ── Selection state (within gesture) ───────────────────────
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    /** True while the user is dragging to create / adjust a selection. */
    let activelySelecting = false;
    /**
     * True when already in selection mode and a new touch started but
     * hasn't moved enough to begin adjusting yet.  A tap (no drag)
     * while pendingAdjust is a no-op — keeps the existing selection.
     */
    let pendingAdjust = false;
    /** The fixed end of the selection (doesn't move during drag). */
    let selAnchorCol = 0;
    let selAnchorRow = 0;
    /** The moving end of the selection (follows the finger). */
    let selEndCol = 0;
    let selEndRow = 0;
    /** True when the current drag started from touching a handle (adjustment). */
    let isAdjusting = false;

    const cancelLongPress = () => {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

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
      // When a native input is active (mobile), prevent the browser from
      // blurring it – that would dismiss the virtual keyboard on every
      // scroll or tap.
      if (onTap) e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pointerStartX = e.clientX;
      pointerStartY = e.clientY;
      accumulatedDelta = 0;
      wasTap = true;
      directionVertical = null;
      activelySelecting = false;
      pendingAdjust = false;
      isAdjusting = false;

      if (selectionModeRef.current) {
        // ── Already in selection mode → prepare to adjust ──────
        // Determine which end of the selection is closer to the
        // touch.  The farther end becomes the new anchor and the
        // closer end will follow the finger once the user drags.
        const screenEl = el.querySelector(".xterm-screen");
        if (screenEl) {
          const cell = pixelToCell(e.clientX, e.clientY, screenEl, term);
          const distToAnchor =
            Math.abs(cell.row - selAnchorRow) * 1000 +
            Math.abs(cell.col - selAnchorCol);
          const distToEnd =
            Math.abs(cell.row - selEndRow) * 1000 +
            Math.abs(cell.col - selEndCol);

          if (distToAnchor < distToEnd) {
            // Touch is closer to anchor → swap so anchor = far end
            const tmpCol = selAnchorCol, tmpRow = selAnchorRow;
            selAnchorCol = selEndCol;
            selAnchorRow = selEndRow;
            selEndCol = tmpCol;
            selEndRow = tmpRow;
          }
          pendingAdjust = true;
        }
        // No long-press timer needed — drag starts immediately.
      } else {
        // ── Not in selection mode → start long-press timer ─────
        const startX = e.clientX;
        const startY = e.clientY;
        cancelLongPress();
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          const screenEl = el.querySelector(".xterm-screen");
          if (!screenEl) return;

          const cell = pixelToCell(startX, startY, screenEl, term);

          // Auto-select the whole word under the finger
          const lineText = getLineText(term, cell.row);
          const wb = getWordBounds(lineText, cell.col);

          selAnchorCol = wb.start;
          selAnchorRow = cell.row;
          selEndCol = wb.end;
          selEndRow = cell.row;
          activelySelecting = true;

          // Dismiss the virtual keyboard before updating React state
          // so the keyboard closes before the toolbar switches to
          // selection-mode controls, avoiding a layout shift.
          (document.activeElement as HTMLElement)?.blur?.();

          selectionModeRef.current = true;
          setSelectionMode(true);

          applySelection(term, selAnchorCol, selAnchorRow, selEndCol, selEndRow);
          positionHandles(selAnchorCol, selAnchorRow, selEndCol, selEndRow);

          // Haptic feedback (Android; no-op on iOS)
          navigator.vibrate?.(50);
        }, LONG_PRESS_MS);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || pointerStartY === null || pointerStartX === null) return;

      // ── Actively selecting / adjusting → extend selection ────
      if (activelySelecting) {
        const screenEl = el.querySelector(".xterm-screen");
        if (screenEl) {
          const yOffset = isAdjusting ? HANDLE_OFFSET_Y : 0;
          const cell = pixelToCell(e.clientX, e.clientY - yOffset, screenEl, term);
          selEndCol = cell.col;
          selEndRow = cell.row;
          applySelection(term, selAnchorCol, selAnchorRow, selEndCol, selEndRow);
          positionHandles(selAnchorCol, selAnchorRow, selEndCol, selEndRow);
        }
        e.preventDefault();
        return;
      }

      // ── Pending adjustment → start adjusting once moved enough ─
      if (pendingAdjust) {
        const dx = Math.abs(e.clientX - pointerStartX);
        const dy = Math.abs(e.clientY - pointerStartY);
        if (dx > ADJUST_DRAG_THRESHOLD || dy > ADJUST_DRAG_THRESHOLD) {
          pendingAdjust = false;
          activelySelecting = true;
          isAdjusting = true;
          // Immediately update the selection to the current position
          const screenEl = el.querySelector(".xterm-screen");
          if (screenEl) {
            const cell = pixelToCell(e.clientX, e.clientY - HANDLE_OFFSET_Y, screenEl, term);
            selEndCol = cell.col;
            selEndRow = cell.row;
            applySelection(term, selAnchorCol, selAnchorRow, selEndCol, selEndRow);
            positionHandles(selAnchorCol, selAnchorRow, selEndCol, selEndRow);
          }
        }
        e.preventDefault();
        return;
      }

      // ── Cancel long-press if finger moved too far ────────────
      if (longPressTimer !== null) {
        const dx = Math.abs(e.clientX - pointerStartX);
        const dy = Math.abs(e.clientY - pointerStartY);
        if (dx > LONG_PRESS_MOVE_THRESHOLD || dy > LONG_PRESS_MOVE_THRESHOLD) {
          cancelLongPress();
        }
      }

      // ── Direction detection (runs once per gesture) ──────────
      if (directionVertical === null) {
        // If the swipe-navigation hook already locked horizontal, bail out
        if (swipeLock.isLocked()) {
          directionVertical = false;
          return;
        }
        const dx = Math.abs(e.clientX - pointerStartX);
        const dy = Math.abs(e.clientY - pointerStartY);
        if (dx < DIRECTION_THRESHOLD && dy < DIRECTION_THRESHOLD) return; // wait
        directionVertical = dy >= dx;
        if (!directionVertical) return; // horizontal → ignore
      }

      if (!directionVertical) return; // horizontal gesture — don't scroll

      // ── Vertical scroll (existing logic) ─────────────────────
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

      cancelLongPress();

      if (activelySelecting) {
        // Finalize selection — keep it highlighted, wait for Copy/Cancel
        activelySelecting = false;
      } else if (pendingAdjust && wasTap) {
        // Tap in selection mode without dragging.
        // If tap is inside the selection → copy.  Outside → cancel.
        pendingAdjust = false;
        const screenEl = el.querySelector(".xterm-screen");
        if (screenEl) {
          const cell = pixelToCell(e.clientX, e.clientY, screenEl, term);
          if (isCellInSelection(cell.col, cell.row, selAnchorCol, selAnchorRow, selEndCol, selEndRow)) {
            const text = term.getSelection();
            if (text) {
              navigator.clipboard.writeText(text);
              showCopiedFeedback();
            }
            term.clearSelection();
            hideHandles();
            selectionModeRef.current = false;
            setSelectionMode(false);
          } else {
            term.clearSelection();
            hideHandles();
            selectionModeRef.current = false;
            setSelectionMode(false);
          }
        }
      } else if (pendingAdjust) {
        pendingAdjust = false;
      } else if (wasTap && !selectionModeRef.current) {
        // Normal tap outside selection mode
        if (onTap) onTap();
        else term.focus();
      }

      pointerStartX = null;
      pointerStartY = null;
      directionVertical = null;
      if (scrollRafId !== null) {
        cancelAnimationFrame(scrollRafId);
        scrollRafId = null;
      }
      flushScroll();
      accumulatedDelta = 0;
    };

    // Suppress all default touch behaviour on the terminal container.
    // Mobile browsers can trigger focus on the nearest contenteditable
    // (the native input in the keyboard bar) from touchstart, which
    // opens the virtual keyboard.  Since we handle every touch gesture
    // ourselves via pointer events, the browser defaults are not needed.
    // Also suppress contextmenu (long-press menu) for the same reason.
    const preventNative = (e: Event) => e.preventDefault();

    el.addEventListener("pointerdown", handlePointerDown);
    el.addEventListener("pointermove", handlePointerMove, { passive: false });
    el.addEventListener("pointerup", handlePointerUpOrCancel);
    el.addEventListener("pointercancel", handlePointerUpOrCancel);
    el.addEventListener("touchstart", preventNative, { passive: false });
    el.addEventListener("contextmenu", preventNative);

    return () => {
      cancelLongPress();
      if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
      el.removeEventListener("pointerdown", handlePointerDown);
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", handlePointerUpOrCancel);
      el.removeEventListener("pointercancel", handlePointerUpOrCancel);
      el.removeEventListener("touchstart", preventNative);
      el.removeEventListener("contextmenu", preventNative);
    };
  }, [containerRef, termRef, wsRef]);

  return {
    selectionMode, copySelection, cancelSelection, selectAllText,
    copiedFeedback, startHandleRef, endHandleRef,
  };
}
