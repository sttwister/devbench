import { useState, useRef, useCallback, useEffect } from "react";
import { computeReorder } from "../utils/reorder.ts";

// ── Types ───────────────────────────────────────────────────────

export interface ActiveDrag {
  kind: "project" | "session";
  id: number;
  projectId?: number;
}

export interface DropIndicator {
  kind: "project" | "session";
  index: number;
  projectId?: number;
}

interface ProjectData {
  id: number;
  sessions: { id: number }[];
}

export interface DnDCallbacks {
  onReorderProjects: (orderedIds: number[]) => void;
  onReorderSessions: (projectId: number, orderedIds: number[]) => void;
}

/**
 * Core drag-and-drop logic shared by desktop and touch DnD.
 * Manages state, drop index computation, and commit logic.
 */
export function useDragCore(
  projects: ProjectData[],
  callbacks: DnDCallbacks
) {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const sidebarContentRef = useRef<HTMLDivElement>(null);

  // Refs for stable access in event handlers (avoid stale closures)
  const projectsRef = useRef(projects);
  const callbacksRef = useRef(callbacks);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);

  // ── Drop index computation ────────────────────────────────────

  const computeProjectDropIndex = useCallback((clientY: number): number => {
    const container = sidebarContentRef.current;
    if (!container) return 0;
    const headers = container.querySelectorAll("[data-project-drag-id] > .project-header");
    for (let i = 0; i < headers.length; i++) {
      const rect = headers[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return headers.length;
  }, []);

  const computeSessionDropIndex = useCallback((clientY: number, projectId: number): number => {
    const container = sidebarContentRef.current;
    if (!container) return 0;
    const items = container.querySelectorAll(
      `[data-session-drag-id][data-session-project-id="${projectId}"]`
    );
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return items.length;
  }, []);

  // ── Compute drop indicator from clientY ───────────────────────

  const updateDropIndicator = useCallback((clientY: number) => {
    if (!activeDrag) return;
    if (activeDrag.kind === "project") {
      setDropIndicator({ kind: "project", index: computeProjectDropIndex(clientY) });
    } else if (activeDrag.kind === "session" && activeDrag.projectId) {
      setDropIndicator({
        kind: "session",
        index: computeSessionDropIndex(clientY, activeDrag.projectId),
        projectId: activeDrag.projectId,
      });
    }
  }, [activeDrag, computeProjectDropIndex, computeSessionDropIndex]);

  // ── Commit reorder ────────────────────────────────────────────

  const commitDrop = useCallback((
    dragInfo: { kind: string; id: number; projectId?: number | null },
    clientY: number
  ) => {
    const projs = projectsRef.current;
    if (dragInfo.kind === "project") {
      const ids = projs.map(p => p.id);
      const dropIdx = computeProjectDropIndex(clientY);
      const newOrder = computeReorder(ids, dragInfo.id, dropIdx);
      if (newOrder.join(",") !== ids.join(",")) {
        callbacksRef.current.onReorderProjects(newOrder);
      }
    } else if (dragInfo.kind === "session" && dragInfo.projectId) {
      const project = projs.find(p => p.id === dragInfo.projectId);
      if (!project) return;
      const ids = project.sessions.map(s => s.id);
      const dropIdx = computeSessionDropIndex(clientY, dragInfo.projectId);
      const newOrder = computeReorder(ids, dragInfo.id, dropIdx);
      if (newOrder.join(",") !== ids.join(",")) {
        callbacksRef.current.onReorderSessions(dragInfo.projectId, newOrder);
      }
    }
  }, [computeProjectDropIndex, computeSessionDropIndex]);

  // ── Cleanup ───────────────────────────────────────────────────

  const cleanupDrag = useCallback(() => {
    document.querySelectorAll(".drag-source").forEach(el => el.classList.remove("drag-source"));
    setActiveDrag(null);
    setDropIndicator(null);
  }, []);

  // ── Drop indicator helpers ────────────────────────────────────

  const getProjectDropClass = useCallback((index: number): string => {
    if (!dropIndicator || dropIndicator.kind !== "project" || !activeDrag || activeDrag.kind !== "project") return "";
    if (dropIndicator.index === index) return "drop-before";
    if (dropIndicator.index === projectsRef.current.length && index === projectsRef.current.length - 1) return "drop-after";
    return "";
  }, [dropIndicator, activeDrag]);

  const getSessionDropClass = useCallback((projectId: number, index: number, totalSessions: number): string => {
    if (!dropIndicator || dropIndicator.kind !== "session" || dropIndicator.projectId !== projectId) return "";
    if (!activeDrag || activeDrag.kind !== "session") return "";
    if (dropIndicator.index === index) return "drop-before";
    if (dropIndicator.index === totalSessions && index === totalSessions - 1) return "drop-after";
    return "";
  }, [dropIndicator, activeDrag]);

  return {
    activeDrag,
    setActiveDrag,
    dropIndicator,
    setDropIndicator,
    sidebarContentRef,
    projectsRef,
    computeProjectDropIndex,
    computeSessionDropIndex,
    updateDropIndicator,
    commitDrop,
    cleanupDrag,
    getProjectDropClass,
    getSessionDropClass,
  };
}
