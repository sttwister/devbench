import { useMemo, useCallback } from "react";
import type { Project, Session } from "../api";

type NavItem =
  | { kind: "session"; session: Session; projectId: number }
  | { kind: "project"; projectId: number };

/**
 * Navigation logic: ordered list of navigable items and delta-based movement.
 */
export function useSessionNavigation(
  projects: Project[],
  activeSession: Session | null,
  activeProjectId: number | null,
  selectSession: (session: Session) => void,
  selectProject: (projectId: number) => void
) {
  const navItems = useMemo<NavItem[]>(
    () =>
      projects.flatMap((p): NavItem[] =>
        p.sessions.length > 0
          ? p.sessions.map((s) => ({ kind: "session", session: s, projectId: p.id }))
          : [{ kind: "project", projectId: p.id }]
      ),
    [projects]
  );

  const navigate = useCallback(
    (delta: number) => {
      if (navItems.length === 0) return;
      let curIdx = navItems.findIndex((item) => {
        if (activeSession && item.kind === "session")
          return item.session.id === activeSession.id;
        if (!activeSession && activeProjectId !== null && item.kind === "project")
          return item.projectId === activeProjectId;
        return false;
      });
      // If no exact match but we have an activeProjectId, find the first item
      // belonging to that project (handles project-with-sessions selected)
      if (curIdx < 0 && activeProjectId !== null) {
        curIdx = navItems.findIndex(
          (item) => item.projectId === activeProjectId
        );
      }
      let next: number;
      if (delta > 0) {
        next = curIdx < 0 ? 0 : Math.min(curIdx + 1, navItems.length - 1);
      } else {
        next = curIdx < 0 ? navItems.length - 1 : Math.max(curIdx - 1, 0);
      }
      const item = navItems[next];
      if (item.kind === "session") {
        selectSession(item.session);
      } else {
        selectProject(item.projectId);
      }
    },
    [navItems, activeSession, activeProjectId, selectSession, selectProject]
  );

  return { navItems, navigate };
}
