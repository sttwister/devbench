import { useDragCore } from "./useDragCore";
import { useDesktopDrag } from "./useDesktopDrag";
import { useTouchDrag } from "./useTouchDrag";
import type { DnDCallbacks } from "./useDragCore";

// Re-export types for existing consumers
export type { ActiveDrag, DropIndicator } from "./useDragCore";

interface ProjectData {
  id: number;
  name: string;
  sessions: { id: number; name: string }[];
}

/**
 * Encapsulates all drag-and-drop logic (desktop HTML5 DnD + touch DnD)
 * for the sidebar.
 *
 * Composes three focused hooks:
 *  - useDragCore: shared state, drop-index computation, commit logic
 *  - useDesktopDrag: HTML5 DnD event handlers
 *  - useTouchDrag: touch event handlers with ghost element
 */
export function useSidebarDragAndDrop(
  projects: ProjectData[],
  callbacks: DnDCallbacks
) {
  const core = useDragCore(projects, callbacks);
  const desktop = useDesktopDrag(core);
  const touch = useTouchDrag(core, projects);

  return {
    activeDrag: core.activeDrag,
    sidebarContentRef: core.sidebarContentRef,
    handleGripMouseDown: desktop.handleGripMouseDown,
    handleProjectDragStart: desktop.handleProjectDragStart,
    handleSessionDragStart: desktop.handleSessionDragStart,
    handleDragOver: desktop.handleDragOver,
    handleDrop: desktop.handleDrop,
    handleDragEnd: desktop.handleDragEnd,
    handleTouchGripStart: touch.handleTouchGripStart,
    getProjectDropClass: core.getProjectDropClass,
    getSessionDropClass: core.getSessionDropClass,
  };
}
