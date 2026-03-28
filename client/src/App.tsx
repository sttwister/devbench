import { useState, useEffect, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import TerminalPane from "./components/TerminalPane";
import {
  fetchProjects,
  fetchSessions,
  createProject,
  deleteProject,
  createSession,
  deleteSession,
  type ProjectWithSessions,
} from "./api";

export default function App() {
  const [projects, setProjects] = useState<ProjectWithSessions[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const loadProjects = useCallback(async () => {
    const ps = await fetchProjects();
    const withSessions = await Promise.all(
      ps.map(async (p) => ({
        ...p,
        sessions: await fetchSessions(p.id),
      }))
    );
    setProjects(withSessions);
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleCreateProject = async (name: string, path: string) => {
    await createProject(name, path);
    await loadProjects();
  };

  const handleDeleteProject = async (id: number) => {
    // If selected session belongs to this project, deselect
    const proj = projects.find((p) => p.id === id);
    if (proj && proj.sessions.some((s) => s.id === selectedSessionId)) {
      setSelectedSessionId(null);
    }
    await deleteProject(id);
    await loadProjects();
  };

  const handleCreateSession = async (
    projectId: number,
    name: string,
    type: "terminal" | "claude"
  ) => {
    const session = await createSession(projectId, name, type);
    await loadProjects();
    setSelectedSessionId(session.id);
  };

  const handleDeleteSession = async (id: number) => {
    if (selectedSessionId === id) setSelectedSessionId(null);
    await deleteSession(id);
    await loadProjects();
  };

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">
      <Sidebar
        projects={projects}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
      />
      <TerminalPane sessionId={selectedSessionId} />
    </div>
  );
}
