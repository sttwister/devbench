import { useEffect, useRef } from "react";

const DIRECTION_LOCK_THRESHOLD = 10; // px before we decide horizontal vs vertical
const SWIPE_COMMIT_THRESHOLD = 50; // px horizontal to trigger navigation
const DAMPING = 0.35; // content moves at 35% of finger movement
const SNAP_BACK_MS = 250; // ms for the snap-back transition
const ENTER_ANIMATION_MS = 200; // ms for the slide-in animation

/**
 * Detects horizontal swipe gestures on a container element and animates
 * the transition between sessions.
 *
 * During the swipe the content follows the finger (dampened).  On a
 * successful swipe the old content fades, navigate() is called, and the
 * new content slides in from the opposite edge.  On a cancelled swipe
 * the content springs back.
 *
 * Uses touch events (not pointer events) so it doesn't conflict with
 * the terminal's pointer-capture-based vertical scroll.
 */
export function useSwipeNavigation(
  containerRef: React.RefObject<HTMLElement | null>,
  navigate: (delta: number) => void
) {
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let tracking = false; // we're watching touches
    let locked: "horizontal" | "vertical" | null = null; // direction decision
    let currentDx = 0;

    // ── helpers ───────────────────────────────────────────────────
    const applyTransform = (dx: number, opacity: number) => {
      el.style.transform = `translateX(${dx}px)`;
      el.style.opacity = String(opacity);
    };

    const clearInlineStyles = () => {
      el.style.transform = "";
      el.style.opacity = "";
      el.style.transition = "";
    };

    // ── touch handlers ────────────────────────────────────────────
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
      locked = null;
      currentDx = 0;
      // Remove any leftover animation class / inline styles
      el.classList.remove("swipe-enter-from-left", "swipe-enter-from-right");
      clearInlineStyles();
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      // Decide direction once we pass the lock threshold
      if (locked === null) {
        if (Math.abs(dx) >= DIRECTION_LOCK_THRESHOLD || Math.abs(dy) >= DIRECTION_LOCK_THRESHOLD) {
          locked = Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
        }
        if (locked !== "horizontal") return;
      }
      if (locked !== "horizontal") return;

      currentDx = dx;
      const dampedDx = dx * DAMPING;
      const progress = Math.min(Math.abs(dampedDx) / el.offsetWidth, 1);
      const opacity = 1 - progress * 0.4; // fade to 60% at most
      applyTransform(dampedDx, opacity);
    };

    const handleTouchEnd = () => {
      if (!tracking) return;
      tracking = false;

      if (locked !== "horizontal") {
        clearInlineStyles();
        return;
      }

      const absDx = Math.abs(currentDx);

      if (absDx >= SWIPE_COMMIT_THRESHOLD) {
        // ── Successful swipe ────────────────────────────────────
        const direction = currentDx > 0 ? -1 : 1; // right→prev, left→next
        const enterClass = currentDx > 0 ? "swipe-enter-from-left" : "swipe-enter-from-right";

        // Reset styles immediately, then apply the slide-in animation
        clearInlineStyles();
        navigateRef.current(direction);

        // The new content just rendered — animate it in
        requestAnimationFrame(() => {
          el.classList.add(enterClass);
          const onEnd = () => {
            el.classList.remove(enterClass);
            el.removeEventListener("animationend", onEnd);
          };
          el.addEventListener("animationend", onEnd);
          // Safety fallback in case animationend doesn't fire
          setTimeout(() => el.classList.remove(enterClass), ENTER_ANIMATION_MS + 50);
        });
      } else {
        // ── Cancelled swipe — snap back ─────────────────────────
        el.style.transition = `transform ${SNAP_BACK_MS}ms cubic-bezier(.2,.8,.4,1), opacity ${SNAP_BACK_MS}ms cubic-bezier(.2,.8,.4,1)`;
        applyTransform(0, 1);
        const onEnd = () => {
          clearInlineStyles();
          el.removeEventListener("transitionend", onEnd);
        };
        el.addEventListener("transitionend", onEnd);
        setTimeout(clearInlineStyles, SNAP_BACK_MS + 50);
      }

      locked = null;
      currentDx = 0;
    };

    const handleTouchCancel = () => {
      tracking = false;
      locked = null;
      currentDx = 0;
      clearInlineStyles();
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [containerRef]);
}
