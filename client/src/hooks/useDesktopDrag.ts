import { useRef, useCallback, useEffect } from "react";
import type { useDragCore } from "./useDragCore";

/**
 * Desktop HTML5 drag-and-drop — handles grip mousedown, dragstart,
 * dragover, drop, and dragend events.
 */
export function useDesktopDrag(
  core: ReturnType<typeof useDragCore>
) {
  const gripInitiated = useRef(false);

  // Reset grip flag on mouseup
  useEffect(() => {
    const reset = () => { gripInitiated.current = false; };
    document.addEventListener("mouseup", reset);
    return () => document.removeEventListener("mouseup", reset);
  }, []);

  const handleGripMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    gripInitiated.current = true;
  }, []);

  const handleProjectDragStart = useCallback((e: React.DragEvent, projectId: number) => {
    if (!gripInitiated.current) {
      e.preventDefault();
      return;
    }
    gripInitiated.current = false;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    core.setActiveDrag({ kind: "project", id: projectId });
    requestAnimationFrame(() => {
      (e.target as HTMLElement).classList.add("drag-source");
    });
  }, [core.setActiveDrag]);

  const handleSessionDragStart = useCallback((e: React.DragEvent, sessionId: number, projectId: number) => {
    if (!gripInitiated.current) {
      e.preventDefault();
      return;
    }
    gripInitiated.current = false;
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
    handleGripMouseDown,
    handleProjectDragStart,
    handleSessionDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  };
}
