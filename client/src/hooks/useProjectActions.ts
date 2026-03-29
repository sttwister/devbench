import { useState, useCallback } from "react";
import type { Project, Session } from "../api";
import {
  createProject,
  updateProject,
  deleteProject,
  reorderProjects as apiReorderProjects,
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
  }) => {
    try {
      if (editingProject) {
        await updateProject(editingProject.id, {
          name: data.name,
          path: data.path,
          browser_url: data.browser_url || null,
          default_view_mode: data.default_view_mode || "desktop",
        });
      } else {
        await createProject(data.name, data.path, data.browser_url, data.default_view_mode);
      }
      setProjectFormOpen(false);
      setEditingProject(null);
      await loadProjects();
    } catch (e: any) {
      alert(e.message);
    }
  }, [editingProject, loadProjects]);

  const handleProjectFormCancel = useCallback(() => {
    setProjectFormOpen(false);
    setEditingProject(null);
  }, []);

  const handleDeleteProject = useCallback(async (id: number) => {
    if (!confirm("Delete this project and all its sessions?")) return;
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
  }, [projects, activeProjectId, loadProjects, browserCleanup, setActiveSession, setActiveProjectId]);

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
    handleAddProject,
    handleEditProject,
    handleProjectFormSubmit,
    handleProjectFormCancel,
    handleDeleteProject,
    handleReorderProjects,
  };
}
