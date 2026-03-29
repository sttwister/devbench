import { useState, useRef, useCallback, useEffect } from "react";

// ── Reorder helper ──────────────────────────────────────────────
function computeReorder(items: number[], fromId: number, toIndex: number): number[] {
  const fromIndex = items.indexOf(fromId);
  if (fromIndex === -1 || fromIndex === toIndex) return items;
  const result = [...items];
  result.splice(fromIndex, 1);
  const adjustedTo = toIndex > fromIndex ? toIndex - 1 : toIndex;
  result.splice(Math.max(0, Math.min(result.length, adjustedTo)), 0, fromId);
  return result;
}

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
  name: string;
  sessions: { id: number; name: string }[];
}

interface DnDCallbacks {
  onReorderProjects: (orderedIds: number[]) => void;
  onReorderSessions: (projectId: number, orderedIds: number[]) => void;
}

/**
 * Encapsulates all drag-and-drop logic (desktop HTML5 DnD + touch DnD)
 * for the sidebar.
 */
export function useSidebarDragAndDrop(
  projects: ProjectData[],
  callbacks: DnDCallbacks
) {
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);

  const gripInitiated = useRef(false);
  const sidebarContentRef = useRef<HTMLDivElement>(null);

  // Refs for stable access in touch handlers (avoid stale closures)
  const projectsRef = useRef(projects);
  const callbacksRef = useRef(callbacks);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);

  // Touch DnD refs
  const touchDragRef = useRef<{
    kind: "project" | "session";
    id: number;
    projectId: number | null;
    ghost: HTMLElement;
    originEl: HTMLElement;
  } | null>(null);

  // Reset grip flag on mouseup
  useEffect(() => {
    const reset = () => { gripInitiated.current = false; };
    document.addEventListener("mouseup", reset);
    return () => document.removeEventListener("mouseup", reset);
  }, []);

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

  // ── Commit reorder ────────────────────────────────────────────
  const commitDrop = useCallback((
    dragInfo: { kind: string; id: number; projectId?: number | null },
    dropIdx: { kind: string; index: number; projectId?: number }
  ) => {
    const projs = projectsRef.current;
    if (dragInfo.kind === "project") {
      const ids = projs.map(p => p.id);
      const newOrder = computeReorder(ids, dragInfo.id, dropIdx.index);
      if (newOrder.join(",") !== ids.join(",")) {
        callbacksRef.current.onReorderProjects(newOrder);
      }
    } else if (dragInfo.kind === "session" && dragInfo.projectId) {
      const project = projs.find(p => p.id === dragInfo.projectId);
      if (!project) return;
      const ids = project.sessions.map(s => s.id);
      const newOrder = computeReorder(ids, dragInfo.id, dropIdx.index);
      if (newOrder.join(",") !== ids.join(",")) {
        callbacksRef.current.onReorderSessions(dragInfo.projectId, newOrder);
      }
    }
  }, []);

  // ── DnD cleanup ───────────────────────────────────────────────
  const cleanupDrag = useCallback(() => {
    document.querySelectorAll(".drag-source").forEach(el => el.classList.remove("drag-source"));
    setActiveDrag(null);
    setDropIndicator(null);
    gripInitiated.current = false;
    if (touchDragRef.current) {
      touchDragRef.current.ghost.remove();
      touchDragRef.current.originEl.classList.remove("drag-source");
      touchDragRef.current = null;
    }
  }, []);

  // ── Desktop DnD: grip mousedown ───────────────────────────────
  const handleGripMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    gripInitiated.current = true;
  }, []);

  // ── Desktop DnD: project drag ─────────────────────────────────
  const handleProjectDragStart = useCallback((e: React.DragEvent, projectId: number) => {
    if (!gripInitiated.current) {
      e.preventDefault();
      return;
    }
    gripInitiated.current = false;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    setActiveDrag({ kind: "project", id: projectId });
    requestAnimationFrame(() => {
      (e.target as HTMLElement).classList.add("drag-source");
    });
  }, []);

  // ── Desktop DnD: session drag ─────────────────────────────────
  const handleSessionDragStart = useCallback((e: React.DragEvent, sessionId: number, projectId: number) => {
    if (!gripInitiated.current) {
      e.preventDefault();
      return;
    }
    gripInitiated.current = false;
    e.stopPropagation(); // don't trigger project drag
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    setActiveDrag({ kind: "session", id: sessionId, projectId });
    requestAnimationFrame(() => {
      (e.target as HTMLElement).classList.add("drag-source");
    });
  }, []);

  // ── Desktop DnD: dragover on sidebar content ──────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!activeDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    if (activeDrag.kind === "project") {
      setDropIndicator({ kind: "project", index: computeProjectDropIndex(e.clientY) });
    } else if (activeDrag.kind === "session" && activeDrag.projectId) {
      setDropIndicator({
        kind: "session",
        index: computeSessionDropIndex(e.clientY, activeDrag.projectId),
        projectId: activeDrag.projectId,
      });
    }
  }, [activeDrag, computeProjectDropIndex, computeSessionDropIndex]);

  // ── Desktop DnD: drop ─────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!activeDrag) return;
    let dropIdx;
    if (activeDrag.kind === "project") {
      dropIdx = { kind: "project", index: computeProjectDropIndex(e.clientY) };
    } else if (activeDrag.kind === "session" && activeDrag.projectId) {
      dropIdx = {
        kind: "session",
        index: computeSessionDropIndex(e.clientY, activeDrag.projectId),
        projectId: activeDrag.projectId,
      };
    }
    if (dropIdx) commitDrop(activeDrag, dropIdx);
    cleanupDrag();
  }, [activeDrag, computeProjectDropIndex, computeSessionDropIndex, commitDrop, cleanupDrag]);

  const handleDragEnd = useCallback(() => {
    cleanupDrag();
  }, [cleanupDrag]);

  // ── Touch DnD: start ──────────────────────────────────────────
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
    setActiveDrag({ kind, id, projectId });
  }, []);

  // ── Touch DnD: move & end (document-level listeners) ──────────
  useEffect(() => {
    if (!activeDrag || !touchDragRef.current) return;

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const drag = touchDragRef.current;
      if (!drag) return;

      drag.ghost.style.top = `${touch.clientY - 20}px`;

      if (drag.kind === "project") {
        setDropIndicator({ kind: "project", index: computeProjectDropIndex(touch.clientY) });
      } else if (drag.kind === "session" && drag.projectId !== null) {
        setDropIndicator({
          kind: "session",
          index: computeSessionDropIndex(touch.clientY, drag.projectId),
          projectId: drag.projectId,
        });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const drag = touchDragRef.current;
      if (!drag) { cleanupDrag(); return; }

      const lastTouch = e.changedTouches[0];
      let dropIdx;
      if (drag.kind === "project") {
        dropIdx = { kind: "project", index: computeProjectDropIndex(lastTouch.clientY) };
      } else if (drag.kind === "session" && drag.projectId !== null) {
        dropIdx = {
          kind: "session",
          index: computeSessionDropIndex(lastTouch.clientY, drag.projectId),
          projectId: drag.projectId,
        };
      }
      if (dropIdx) {
        commitDrop(
          { kind: drag.kind, id: drag.id, projectId: drag.projectId },
          dropIdx,
        );
      }
      cleanupDrag();
    };

    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd);
    document.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [activeDrag, computeProjectDropIndex, computeSessionDropIndex, commitDrop, cleanupDrag]);

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
    sidebarContentRef,
    handleGripMouseDown,
    handleProjectDragStart,
    handleSessionDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
    handleTouchGripStart,
    getProjectDropClass,
    getSessionDropClass,
  };
}
