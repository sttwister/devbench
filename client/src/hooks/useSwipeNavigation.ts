import { useEffect, useRef, useCallback } from "react";

const SWIPE_MIN_DISTANCE = 50; // px
const SWIPE_MAX_DURATION = 500; // ms
const SWIPE_HORIZONTAL_RATIO = 1.5; // deltaX must be this × deltaY

/**
 * Detects horizontal swipe gestures on a container element.
 * Calls `navigate(-1)` on swipe-right (previous) and `navigate(1)` on swipe-left (next).
 *
 * Uses touch events (not pointer events) so it doesn't conflict with the
 * terminal's pointer-capture-based vertical scroll.  The detector is passive:
 * it watches the gesture and only acts when touchend reveals a clear horizontal swipe.
 */
export function useSwipeNavigation(
  containerRef: React.RefObject<HTMLElement | null>,
  navigate: (delta: number) => void
) {
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);

  const stableNavigate = useRef(navigate);
  useEffect(() => {
    stableNavigate.current = navigate;
  }, [navigate]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      startRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const start = startRef.current;
      startRef.current = null;
      if (!start) return;

      const touch = e.changedTouches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const dt = Date.now() - start.t;

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (
        dt <= SWIPE_MAX_DURATION &&
        absDx >= SWIPE_MIN_DISTANCE &&
        absDx >= absDy * SWIPE_HORIZONTAL_RATIO
      ) {
        // Swipe right → previous session, swipe left → next session
        stableNavigate.current(dx > 0 ? -1 : 1);
      }
    };

    const handleTouchCancel = () => {
      startRef.current = null;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [containerRef]);
}
