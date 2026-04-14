import { useState, useCallback } from "react";
import type { Project, Session } from "../api";
import {
  createProject,
  updateProject,
  deleteProject,
  reorderProjects as apiReorderProjects,
  setProjectLinearAssociation,
  removeProjectLinearAssociation,
} from "../api";
import { isElectron, devbench } from "../platform";

interface ProjectActionsDeps {
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  activeProjectId: number | null;
  setActiveProjectId: React.Dispatch<React.SetStateAction<number | null>>;
  setActiveSession: React.Dispatch<React.SetStateAction<Session | null>>;
  loadProjects: () => Promise<void>;
  browserCleanup: (sessionId: number) => void;
}

export function useProjectActions(deps: ProjectActionsDeps) {
  const {
    projects, setProjects,
    activeProjectId, setActiveProjectId, setActiveSession,
    loadProjects, browserCleanup,
  } = deps;

  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  /** Project ID pending delete confirmation. */
  const [confirmDeleteProjectId, setConfirmDeleteProjectId] = useState<number | null>(null);
  /** Error message to show in a popup (replaces alert()). */
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleAddProject = useCallback(() => {
    setEditingProject(null);
    setProjectFormOpen(true);
  }, []);

  const handleEditProject = useCallback((project: Project) => {
    setEditingProject(project);
    setProjectFormOpen(true);
  }, []);

  const handleProjectFormSubmit = useCallback(async (data: {
    name: string;
    path: string;
    browser_url?: string;
    default_view_mode?: string;
    linear_project_id?: string | null;
  }) => {
    try {
      let projectId: number;
      if (editingProject) {
        await updateProject(editingProject.id, {
          name: data.name,
          path: data.path,
          browser_url: data.browser_url || null,
          default_view_mode: data.default_view_mode || "desktop",
        });
        projectId = editingProject.id;
      } else {
        const created = await createProject(data.name, data.path, data.browser_url, data.default_view_mode);
        projectId = created.id;
      }

      // Update Linear project association if changed
      const oldLinearId = editingProject?.linear_project_id ?? null;
      const newLinearId = data.linear_project_id ?? null;
      if (newLinearId !== oldLinearId) {
        if (newLinearId) {
          await setProjectLinearAssociation(projectId, newLinearId);
        } else {
          await removeProjectLinearAssociation(projectId);
        }
      }

      setProjectFormOpen(false);
      setEditingProject(null);
      await loadProjects();
    } catch (e: any) {
      setErrorMessage(e.message);
    }
  }, [editingProject, loadProjects]);

  const handleProjectFormCancel = useCallback(() => {
    setProjectFormOpen(false);
    setEditingProject(null);
  }, []);

  /** Called from sidebar × button — opens confirmation popup. */
  const handleDeleteProject = useCallback((id: number) => {
    setConfirmDeleteProjectId(id);
  }, []);

  /** Called when the user confirms the delete project popup. */
  const handleConfirmDeleteProject = useCallback(async () => {
    const id = confirmDeleteProjectId;
    if (id === null) return;
    setConfirmDeleteProjectId(null);
    const project = projects.find((p) => p.id === id);
    if (project) {
      for (const s of project.sessions) {
        devbench?.sessionDestroyed(s.id);
        browserCleanup(s.id);
      }
    }
    if (activeProjectId === id) {
      setActiveSession(null);
      setActiveProjectId(null);
    }
    await deleteProject(id);
    await loadProjects();
  }, [confirmDeleteProjectId, projects, activeProjectId, loadProjects, browserCleanup, setActiveSession, setActiveProjectId]);

  const handleReorderProjects = useCallback(async (orderedIds: number[]) => {
    setProjects(prev => {
      const map = new Map(prev.map(p => [p.id, p]));
      return orderedIds.map(id => map.get(id)!).filter(Boolean);
    });
    try { await apiReorderProjects(orderedIds); }
    catch (e) { console.error("Failed to reorder projects:", e); loadProjects(); }
  }, [loadProjects, setProjects]);

  return {
    projectFormOpen,
    editingProject,
    confirmDeleteProjectId,
    setConfirmDeleteProjectId,
    errorMessage,
    setErrorMessage,
    handleAddProject,
    handleEditProject,
    handleProjectFormSubmit,
    handleProjectFormCancel,
    handleDeleteProject,
    handleConfirmDeleteProject,
    handleReorderProjects,
  };
}
