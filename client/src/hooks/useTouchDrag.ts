import { useRef, useCallback, useEffect } from "react";
import type { useDragCore } from "./useDragCore";

interface ProjectData {
  id: number;
  name: string;
  sessions: { id: number; name: string }[];
}

/**
 * Touch drag-and-drop via long-press on the entire row.
 *
 * A 400 ms long-press initiates the drag.  Normal taps and short
 * touches pass through to the row's click/tap handler.  Creates a
 * visual "ghost" element that follows the user's finger.
 */
export function useTouchDrag(
  core: ReturnType<typeof useDragCore>,
  projects: ProjectData[]
) {
  const touchDragRef = useRef<{
    kind: "project" | "session";
    id: number;
    projectId: number | null;
    ghost: HTMLElement;
    originEl: HTMLElement;
  } | null>(null);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTouchRef = useRef<{
    kind: "project" | "session";
    id: number;
    projectId: number | null;
    touch: { clientX: number; clientY: number };
    target: HTMLElement;
  } | null>(null);

  // Keep a fresh ref to projects for label lookup
  const projectsRef = useRef(projects);
  useEffect(() => { projectsRef.current = projects; }, [projects]);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pendingTouchRef.current = null;
  }, []);

  const cleanupTouch = useCallback(() => {
    clearLongPress();
    if (touchDragRef.current) {
      touchDragRef.current.ghost.remove();
      touchDragRef.current.originEl.classList.remove("drag-source");
      touchDragRef.current = null;
    }
    core.cleanupDrag();
  }, [core.cleanupDrag, clearLongPress]);

  /** Actually start the drag (called after long-press fires). */
  const initiateDrag = useCallback((
    kind: "project" | "session",
    id: number,
    projectId: number | null,
    clientX: number,
    clientY: number,
    target: HTMLElement
  ) => {
    const itemSelector = kind === "project" ? ".project-group" : ".session-item";
    const itemEl = target.closest(itemSelector) as HTMLElement;
    if (!itemEl) return;

    // Create ghost
    const ghost = document.createElement("div");
    ghost.className = "touch-drag-ghost";
    const label = kind === "project"
      ? projectsRef.current.find(p => p.id === id)?.name ?? "Project"
      : projectsRef.current.flatMap(p => p.sessions).find(s => s.id === id)?.name ?? "Session";
    ghost.textContent = label;
    ghost.style.position = "fixed";
    ghost.style.left = `${itemEl.getBoundingClientRect().left}px`;
    ghost.style.top = `${clientY - 20}px`;
    ghost.style.width = `${itemEl.offsetWidth}px`;
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "10000";
    document.body.appendChild(ghost);

    itemEl.classList.add("drag-source");
    touchDragRef.current = { kind, id, projectId, ghost, originEl: itemEl };
    core.setActiveDrag({ kind, id, projectId: projectId ?? undefined });
  }, [core.setActiveDrag]);

  /**
   * Returns onTouchStart / onTouchMove / onTouchEnd props for a row.
   * A 400 ms long-press initiates the drag; shorter touches are ignored
   * (allowing normal tap-to-select to fire).
   */
  const getTouchDragProps = useCallback((
    kind: "project" | "session",
    id: number,
    projectId?: number
  ) => ({
    onTouchStart: (e: React.TouchEvent) => {
      // Don't start drag from buttons/inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "BUTTON" || tag === "INPUT" || tag === "A") return;
      // Don't interfere if already dragging
      if (touchDragRef.current) return;

      const touch = e.touches[0];
      pendingTouchRef.current = {
        kind,
        id,
        projectId: projectId ?? null,
        touch: { clientX: touch.clientX, clientY: touch.clientY },
        target: e.currentTarget as HTMLElement,
      };
      longPressTimerRef.current = setTimeout(() => {
        const p = pendingTouchRef.current;
        if (!p) return;
        initiateDrag(p.kind, p.id, p.projectId, p.touch.clientX, p.touch.clientY, p.target);
        pendingTouchRef.current = null;
      }, 400);
    },
    onTouchMove: (e: React.TouchEvent) => {
      // If drag already started, don't clear (document listeners handle move)
      if (touchDragRef.current) return;
      // If finger moved too far before long-press fired, cancel
      if (pendingTouchRef.current) {
        const dx = e.touches[0].clientX - pendingTouchRef.current.touch.clientX;
        const dy = e.touches[0].clientY - pendingTouchRef.current.touch.clientY;
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
          clearLongPress();
        }
      }
    },
    onTouchEnd: () => {
      // If the long-press hasn't fired, just clear it (normal tap)
      if (!touchDragRef.current) {
        clearLongPress();
      }
    },
  }), [initiateDrag, clearLongPress]);

  // ── Touch move & end (document-level listeners) ───────────────
  useEffect(() => {
    if (!core.activeDrag || !touchDragRef.current) return;

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const drag = touchDragRef.current;
      if (!drag) return;

      drag.ghost.style.top = `${touch.clientY - 20}px`;
      core.updateDropIndicator(touch.clientY);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const drag = touchDragRef.current;
      if (!drag) { cleanupTouch(); return; }

      const lastTouch = e.changedTouches[0];
      core.commitDrop(
        { kind: drag.kind, id: drag.id, projectId: drag.projectId },
        lastTouch.clientY,
      );
      cleanupTouch();
    };

    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [core.activeDrag, core.updateDropIndicator, core.commitDrop, cleanupTouch]);

  return {
    getTouchDragProps,
  };
}
