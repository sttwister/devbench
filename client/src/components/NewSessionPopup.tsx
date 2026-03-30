import { useEffect, useRef, useState } from "react";
import type { SessionType, Project } from "../api";
import { SESSION_TYPES_LIST, detectSourceType, getSourceLabel } from "../api";
import Icon from "./Icon";

interface Props {
  projects: Project[];
  /** Pre-selected project ID (null if none). */
  initialProjectId: number | null;
  onSelect: (projectId: number, type: SessionType, sourceUrl?: string) => void;
  onClose: () => void;
}

export default function NewSessionPopup({ projects, initialProjectId, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    initialProjectId ?? projects[0]?.id ?? null
  );

  useEffect(() => {
    if (showUrlInput) {
      urlInputRef.current?.focus();
    } else {
      ref.current?.focus();
    }
  }, [showUrlInput]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const detectedType = sourceUrl.trim() ? detectSourceType(sourceUrl.trim()) : null;
  const detectedLabel = sourceUrl.trim() ? getSourceLabel(sourceUrl.trim()) : null;

  const cycleProject = (direction: 1 | -1) => {
    if (projects.length === 0) return;
    const idx = projects.findIndex((p) => p.id === selectedProjectId);
    const next = (idx + direction + projects.length) % projects.length;
    setSelectedProjectId(projects[next].id);
  };

  const handleSubmit = (type: SessionType) => {
    if (!selectedProjectId) return;
    const url = sourceUrl.trim() || undefined;
    onSelect(selectedProjectId, type, url);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (showUrlInput) {
        setShowUrlInput(false);
        setSourceUrl("");
      } else {
        onClose();
      }
      return;
    }

    // When URL input is focused, only handle j/k/Escape
    if (showUrlInput) return;

    // j/k cycle projects (always, not just when URL input is hidden)
    if (e.key === "j" || e.key === "J") {
      e.preventDefault();
      e.stopPropagation();
      cycleProject(1);
      return;
    }
    if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      e.stopPropagation();
      cycleProject(-1);
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (e.key === "u" || e.key === "U") {
      setShowUrlInput(true);
      return;
    }

    const match = SESSION_TYPES_LIST.find((o) => o.shortcutKey === e.key.toLowerCase());
    if (match) {
      handleSubmit(match.type);
    }
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      setShowUrlInput(false);
      setSourceUrl("");
      setTimeout(() => ref.current?.focus(), 0);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Confirm URL and return to type selection
      setShowUrlInput(false);
      setTimeout(() => ref.current?.focus(), 0);
      return;
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (ref.current?.contains(e.relatedTarget as Node)) return;
    onClose();
  };

  return (
    <div className="new-session-popup-backdrop" onClick={handleBackdropClick}>
      <div
        className="new-session-popup"
        ref={ref}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      >
        <div className="new-session-popup-title">
          New session in{" "}
          <strong>{selectedProject?.name ?? "—"}</strong>
        </div>

        {/* Project selector */}
        {projects.length > 1 && (
          <div className="new-session-popup-project-selector">
            <button
              className="new-session-popup-project-nav"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => cycleProject(-1)}
              title="Previous project (k)"
            >
              <Icon name="chevron-left" size={14} />
            </button>
            <select
              className="new-session-popup-project-select"
              value={selectedProjectId ?? ""}
              onChange={(e) => setSelectedProjectId(Number(e.target.value))}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              className="new-session-popup-project-nav"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => cycleProject(1)}
              title="Next project (j)"
            >
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
        )}

        {/* URL input (editing) */}
        {showUrlInput && (
          <div className="new-session-popup-url">
            <input
              ref={urlInputRef}
              type="text"
              className="new-session-popup-url-input"
              placeholder="Paste a JIRA, Linear, Sentry, GitHub, or Slack URL..."
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              onKeyDown={handleUrlKeyDown}
            />
            {detectedType && (
              <div className="new-session-popup-url-detected">
                <span className="source-type-tag">{detectedType}</span>
                {detectedLabel && <span className="source-label">{detectedLabel}</span>}
              </div>
            )}
            <div className="new-session-popup-url-hint">
              <kbd>Enter</kbd> confirm · <kbd>Esc</kbd> clear
            </div>
          </div>
        )}

        {/* URL confirmed (read-only summary) */}
        {!showUrlInput && sourceUrl.trim() && (
          <div className="new-session-popup-url-confirmed">
            {detectedType && <span className="source-type-tag">{detectedType}</span>}
            <span className="new-session-popup-url-text" title={sourceUrl.trim()}>
              {detectedLabel || sourceUrl.trim()}
            </span>
            <button
              className="new-session-popup-url-edit"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowUrlInput(true)}
              title="Edit URL (u)"
            >
              <Icon name="pencil" size={11} />
            </button>
            <button
              className="new-session-popup-url-clear"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setSourceUrl(""); }}
              title="Remove URL"
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        )}

        <div className="new-session-popup-options">
          {SESSION_TYPES_LIST.map((o) => (
            <button
              key={o.type}
              className={`new-session-popup-option${!selectedProjectId ? " disabled" : ""}`}
              disabled={!selectedProjectId}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onClick={() => handleSubmit(o.type)}
            >
              <span className="new-session-popup-key">{o.shortcutKey}</span>
              <span className="new-session-popup-icon"><Icon name={o.icon} size={18} /></span>
              <span className="new-session-popup-label">{o.label}</span>
            </button>
          ))}
        </div>
        {!showUrlInput && (
          <div className="new-session-popup-hint">
            {projects.length > 1 && <><kbd>j</kbd><kbd>k</kbd> project · </>}
            <kbd>u</kbd> {sourceUrl.trim() ? "edit" : "add"} URL · <kbd>Esc</kbd> cancel
          </div>
        )}
      </div>
    </div>
  );
}
