import { useState, useEffect, useRef } from "react";
import type { Project } from "../api";

const PATH_PREFIX = "/";

interface Props {
  /** If set, we're editing an existing project */
  project?: Project | null;
  onSubmit: (data: { name: string; path: string; browser_url?: string; default_view_mode?: string }) => void;
  onCancel: () => void;
}

export default function ProjectFormModal({ project, onSubmit, onCancel }: Props) {
  const isEdit = !!project;

  const [path, setPath] = useState(project?.path ?? PATH_PREFIX);
  const [name, setName] = useState(project?.name ?? "");
  const [nameManual, setNameManual] = useState(isEdit); // don't auto-fill if editing
  const [browserUrl, setBrowserUrl] = useState(project?.browser_url ?? "");
  const [defaultViewMode, setDefaultViewMode] = useState(project?.default_view_mode ?? "desktop");
  const [error, setError] = useState("");

  const pathRef = useRef<HTMLInputElement>(null);

  // Focus path input on mount (for add mode)
  useEffect(() => {
    if (!isEdit && pathRef.current) {
      const input = pathRef.current;
      input.focus();
      // Place cursor at end
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, [isEdit]);

  // Auto-fill name from path
  useEffect(() => {
    if (nameManual) return;
    const trimmed = path.replace(/\/+$/, "");
    const last = trimmed.split("/").pop() || "";
    setName(last);
  }, [path, nameManual]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const handleNameChange = (val: string) => {
    setName(val);
    setNameManual(true);
  };

  const handlePathChange = (val: string) => {
    setPath(val);
    setError("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedPath = path.trim().replace(/\/+$/, "");
    const trimmedName = name.trim();
    if (!trimmedPath) {
      setError("Path is required");
      return;
    }
    if (!trimmedName) {
      setError("Name is required");
      return;
    }
    onSubmit({
      name: trimmedName,
      path: trimmedPath,
      browser_url: browserUrl.trim() || undefined,
      default_view_mode: defaultViewMode,
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? "Edit Project" : "Add Project"}</h2>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-group">
            <label htmlFor="proj-path">Path</label>
            <input
              ref={pathRef}
              id="proj-path"
              type="text"
              value={path}
              onChange={(e) => handlePathChange(e.target.value)}
              placeholder="/home/sttwister/coding/my-project"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="form-hint">Absolute path to the project directory</span>
          </div>

          <div className="form-group">
            <label htmlFor="proj-name">Name</label>
            <input
              id="proj-name"
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="my-project"
              spellCheck={false}
            />
            <span className="form-hint">Display name (auto-filled from path)</span>
          </div>

          <div className="form-group">
            <label htmlFor="proj-browser-url">Browser URL <span className="form-optional">optional</span></label>
            <input
              id="proj-browser-url"
              type="text"
              value={browserUrl}
              onChange={(e) => setBrowserUrl(e.target.value)}
              placeholder="http://devbox:8000"
              spellCheck={false}
            />
            <span className="form-hint">Default URL for the embedded browser panel</span>
          </div>

          <div className="form-group">
            <label>Default Browser View <span className="form-optional">optional</span></label>
            <div className="view-mode-selector">
              <button
                type="button"
                className={`view-mode-option${defaultViewMode === "desktop" ? " active" : ""}`}
                onClick={() => setDefaultViewMode("desktop")}
              >
                🖥 Desktop
              </button>
              <button
                type="button"
                className={`view-mode-option${defaultViewMode === "mobile" ? " active" : ""}`}
                onClick={() => setDefaultViewMode("mobile")}
              >
                📱 Mobile
              </button>
            </div>
            <span className="form-hint">Initial view mode when opening the browser panel</span>
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {isEdit ? "Save Changes" : "Add Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
