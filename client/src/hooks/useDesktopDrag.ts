import { useCallback } from "react";
import type { useDragCore } from "./useDragCore";

/**
 * Desktop HTML5 drag-and-drop — handles dragstart, dragover, drop, and
 * dragend events.  The entire row is draggable (no grip handle needed).
 */
export function useDesktopDrag(
  core: ReturnType<typeof useDragCore>
) {
  const handleProjectDragStart = useCallback((e: React.DragEvent, projectId: number) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    core.setActiveDrag({ kind: "project", id: projectId });
    requestAnimationFrame(() => {
      (e.target as HTMLElement).classList.add("drag-source");
    });
  }, [core.setActiveDrag]);

  const handleSessionDragStart = useCallback((e: React.DragEvent, sessionId: number, projectId: number) => {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    core.setActiveDrag({ kind: "session", id: sessionId, projectId });
    requestAnimationFrame(() => {
      (e.target as HTMLElement).classList.add("drag-source");
    });
  }, [core.setActiveDrag]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!core.activeDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    core.updateDropIndicator(e.clientY);
  }, [core.activeDrag, core.updateDropIndicator]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!core.activeDrag) return;
    core.commitDrop(core.activeDrag, e.clientY);
    core.cleanupDrag();
  }, [core.activeDrag, core.commitDrop, core.cleanupDrag]);

  const handleDragEnd = useCallback(() => {
    core.cleanupDrag();
  }, [core.cleanupDrag]);

  return {
    handleProjectDragStart,
    handleSessionDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  };
}
