/**
 * Shared module-level lock that coordinates horizontal swipe navigation
 * with the terminal's vertical touch scroll.
 *
 * Touch events fire before pointer events for the same gesture, so the
 * swipe-navigation hook (touch events) decides first and the terminal
 * scroll hook (pointer events) checks the lock before processing.
 */
let locked = false;

export const swipeLock = {
  /** Called by useSwipeNavigation when a horizontal swipe is detected. */
  lock() { locked = true; },
  /** Called when the gesture ends (touchend / touchcancel). */
  unlock() { locked = false; },
  /** Checked by useTerminalTouchScroll before scrolling. */
  isLocked() { return locked; },
};
