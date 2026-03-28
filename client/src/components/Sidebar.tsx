import { useState } from "react";
import type { ProjectWithSessions, Session } from "../api";

interface SidebarProps {
  projects: ProjectWithSessions[];
  selectedSessionId: number | null;
  onSelectSession: (id: number) => void;
  onCreateProject: (name: string, path: string) => void;
  onDeleteProject: (id: number) => void;
  onCreateSession: (projectId: number, name: string, type: "terminal" | "claude") => void;
  onDeleteSession: (id: number) => void;
}

function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, path: string) => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && path.trim()) {
      onCreate(name.trim(), path.trim());
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-96 shadow-xl">
        <h2 className="text-lg font-semibold mb-4">New Project</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input
              autoFocus
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Path</label>
            <input
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/home/user/projects/my-project"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded bg-gray-700 hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
              disabled={!name.trim() || !path.trim()}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NewSessionModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, type: "terminal" | "claude") => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"terminal" | "claude">("terminal");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(name.trim(), type);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-80 shadow-xl">
        <h2 className="text-lg font-semibold mb-4">New Session</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name (optional)</label>
            <input
              autoFocus
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Leave blank for default"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Type</label>
            <select
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              value={type}
              onChange={(e) => setType(e.target.value as "terminal" | "claude")}
            >
              <option value="terminal">Terminal</option>
              <option value="claude">Claude Code</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded bg-gray-700 hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SessionBadge({ type }: { type: Session["type"] }) {
  if (type === "terminal") {
    return (
      <span className="text-xs px-1.5 py-0.5 rounded bg-green-900/60 text-green-400 font-mono">
        TERM
      </span>
    );
  }
  return (
    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-400 font-mono">
      CC
    </span>
  );
}

export default function Sidebar({
  projects,
  selectedSessionId,
  onSelectSession,
  onCreateProject,
  onDeleteProject,
  onCreateSession,
  onDeleteSession,
}: SidebarProps) {
  const [showNewProject, setShowNewProject] = useState(false);
  const [newSessionForProject, setNewSessionForProject] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const toggleCollapsed = (projectId: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  return (
    <>
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col flex-shrink-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="font-semibold text-gray-100 tracking-tight">devbench</span>
          <button
            onClick={() => setShowNewProject(true)}
            className="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300"
          >
            + Project
          </button>
        </div>

        {/* Project list */}
        <div className="flex-1 overflow-y-auto py-2">
          {projects.length === 0 && (
            <p className="text-xs text-gray-500 px-4 py-2">No projects yet.</p>
          )}
          {projects.map((project) => (
            <div key={project.id} className="mb-1">
              {/* Project header */}
              <div className="group flex items-center gap-1 px-3 py-1.5 hover:bg-gray-800/50 cursor-pointer">
                <button
                  onClick={() => toggleCollapsed(project.id)}
                  className="flex-1 flex items-center gap-1.5 text-left min-w-0"
                >
                  <span className="text-gray-500 text-xs">
                    {collapsed.has(project.id) ? "▶" : "▼"}
                  </span>
                  <span className="text-sm font-medium text-gray-200 truncate">{project.name}</span>
                </button>
                <button
                  onClick={() => setNewSessionForProject(project.id)}
                  title="New Session"
                  className="opacity-0 group-hover:opacity-100 text-xs text-gray-400 hover:text-gray-200 px-1"
                >
                  +
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete project "${project.name}"?`)) {
                      onDeleteProject(project.id);
                    }
                  }}
                  title="Delete Project"
                  className="opacity-0 group-hover:opacity-100 text-xs text-gray-500 hover:text-red-400 px-1"
                >
                  ×
                </button>
              </div>

              {/* Sessions */}
              {!collapsed.has(project.id) && (
                <div className="ml-4">
                  {project.sessions.length === 0 && (
                    <p className="text-xs text-gray-600 px-3 py-1">No sessions</p>
                  )}
                  {project.sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer rounded mx-1 ${
                        selectedSessionId === session.id
                          ? "bg-blue-900/40 text-blue-300"
                          : "hover:bg-gray-800/50 text-gray-300"
                      }`}
                      onClick={() => onSelectSession(session.id)}
                    >
                      <SessionBadge type={session.type} />
                      <span className="text-xs flex-1 truncate">{session.name}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs px-0.5"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {/* Add session button */}
                  <button
                    onClick={() => setNewSessionForProject(project.id)}
                    className="text-xs text-gray-600 hover:text-gray-400 px-3 py-1 w-full text-left"
                  >
                    + new session
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>

      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreate={onCreateProject}
        />
      )}

      {newSessionForProject !== null && (
        <NewSessionModal
          onClose={() => setNewSessionForProject(null)}
          onCreate={(name, type) => onCreateSession(newSessionForProject, name, type)}
        />
      )}
    </>
  );
}
