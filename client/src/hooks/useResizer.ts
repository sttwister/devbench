import { useState, useCallback, useRef } from "react";
import { devbench } from "../platform";

/**
 * Manages split-pane resizing for both Electron (IPC-based)
 * and inline browser (percentage-based) modes.
 */
export function useResizer() {
  // ── Electron resizer state ───────────────────────────────────
  const [dragX, setDragX] = useState<number | null>(null);

  // ── Inline browser resizer (non-Electron) ────────────────────
  const [inlineSplitPercent, setInlineSplitPercent] = useState(50);
  const [inlineDragging, setInlineDragging] = useState(false);
  const sessionAreaRef = useRef<HTMLDivElement>(null);

  // ── Electron resizer handlers ────────────────────────────────
  const handleResizerPointerDown = useCallback((e: React.PointerEvent) => {
    if (!devbench) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragX(e.clientX);
    devbench.resizeStart();
  }, []);

  const handleResizerPointerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0) return;
    setDragX(e.clientX);
  }, []);

  const handleResizerPointerUp = useCallback((e: React.PointerEvent) => {
    if (!devbench) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    devbench.resizeEnd(e.clientX);
    setDragX(null);
  }, []);

  // ── Inline resizer handlers ──────────────────────────────────
  const handleInlineResizerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setInlineDragging(true);
  }, []);

  const handleInlineResizerMove = useCallback((e: React.PointerEvent) => {
    if (e.buttons === 0 || !sessionAreaRef.current) return;
    const rect = sessionAreaRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = (x / rect.width) * 100;
    setInlineSplitPercent(Math.max(20, Math.min(80, pct)));
  }, []);

  const handleInlineResizerUp = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setInlineDragging(false);
  }, []);

  return {
    // Electron resizer
    dragX,
    isDragging: dragX !== null,
    handleResizerPointerDown,
    handleResizerPointerMove,
    handleResizerPointerUp,
    // Inline resizer
    inlineSplitPercent,
    inlineDragging,
    sessionAreaRef,
    handleInlineResizerDown,
    handleInlineResizerMove,
    handleInlineResizerUp,
  };
}
