import { useRef, useCallback, useEffect } from "react";
import type { useDragCore } from "./useDragCore";

interface ProjectData {
  id: number;
  name: string;
  sessions: { id: number; name: string }[];
}

/**
 * Touch drag-and-drop — handles touch grip start, touchmove, and touchend.
 * Creates a visual "ghost" element that follows the user's finger.
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

  // Keep a fresh ref to projects for label lookup
  const projectsRef = useRef(projects);
  useEffect(() => { projectsRef.current = projects; }, [projects]);

  const cleanupTouch = useCallback(() => {
    if (touchDragRef.current) {
      touchDragRef.current.ghost.remove();
      touchDragRef.current.originEl.classList.remove("drag-source");
      touchDragRef.current = null;
    }
    core.cleanupDrag();
  }, [core.cleanupDrag]);

  const handleTouchGripStart = useCallback((
    e: React.TouchEvent,
    kind: "project" | "session",
    id: number,
    projectId?: number
  ) => {
    const touch = e.touches[0];
    const itemSelector = kind === "project" ? ".project-group" : ".session-item";
    const itemEl = (e.currentTarget as HTMLElement).closest(itemSelector) as HTMLElement;
    if (!itemEl) return;
    e.preventDefault();
    e.stopPropagation();

    // Create ghost
    const ghost = document.createElement("div");
    ghost.className = "touch-drag-ghost";
    const label = kind === "project"
      ? projectsRef.current.find(p => p.id === id)?.name ?? "Project"
      : projectsRef.current.flatMap(p => p.sessions).find(s => s.id === id)?.name ?? "Session";
    ghost.textContent = label;
    ghost.style.position = "fixed";
    ghost.style.left = `${itemEl.getBoundingClientRect().left}px`;
    ghost.style.top = `${touch.clientY - 20}px`;
    ghost.style.width = `${itemEl.offsetWidth}px`;
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "10000";
    document.body.appendChild(ghost);

    itemEl.classList.add("drag-source");
    touchDragRef.current = { kind, id, projectId: projectId ?? null, ghost, originEl: itemEl };
    core.setActiveDrag({ kind, id, projectId });
  }, [core.setActiveDrag]);

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
    handleTouchGripStart,
  };
}
