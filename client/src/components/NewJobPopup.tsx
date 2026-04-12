// @lat: [[orchestration#Dashboard UI]]
/**
 * New orchestration job popup — mirrors NewSessionPopup patterns:
 * clipboard auto-paste, source URL with issue preview, project selector.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, LinearIssueInfo, JiraIssueInfo } from "../api";
import { detectSourceType, getSourceLabel, fetchLinearIssue, fetchJiraIssue } from "../api";
import Icon from "./Icon";

interface Props {
  projects: Project[];
  initialProjectId: number | null;
  onAdd: (data: {
    project_id: number;
    title?: string;
    description?: string;
    source_url?: string;
    agent_type?: string;
  }) => void;
  onClose: () => void;
}

const isTouchDevice =
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export default function NewJobPopup({ projects, initialProjectId, onAdd, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    initialProjectId ?? projects[0]?.id ?? null
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(isTouchDevice);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [agentType, setAgentType] = useState("claude");
  const [issueInfo, setIssueInfo] = useState<{ title: string; description: string | null; identifier: string } | null>(null);
  const [issueLoading, setIssueLoading] = useState(false);
  const fetchCounterRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Issue preview fetching ────────────────────────────────────
  const fetchIssueInfo = useCallback((url: string, immediate = false) => {
    clearTimeout(debounceRef.current);
    const trimmed = url.trim();
    const type = trimmed ? detectSourceType(trimmed) : null;
    if (type !== "linear" && type !== "jira") {
      setIssueInfo(null);
      setIssueLoading(false);
      return;
    }
    const doFetch = () => {
      const counter = ++fetchCounterRef.current;
      setIssueLoading(true);
      const promise = type === "linear" ? fetchLinearIssue(trimmed) : fetchJiraIssue(trimmed);
      promise.then((result) => {
        if (fetchCounterRef.current !== counter) return;
        if (result) {
          const identifier = "identifier" in result
            ? (result as LinearIssueInfo).identifier
            : (result as JiraIssueInfo).key;
          setIssueInfo({ title: result.title, description: result.description, identifier });
        } else {
          setIssueInfo(null);
        }
        setIssueLoading(false);
      }).catch(() => {
        if (fetchCounterRef.current !== counter) return;
        setIssueInfo(null);
        setIssueLoading(false);
      });
    };
    if (immediate) {
      doFetch();
    } else {
      debounceRef.current = setTimeout(doFetch, 300);
    }
  }, []);

  // Cleanup debounce on unmount
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // ── Auto-fill from clipboard ──────────────────────────────────
  useEffect(() => {
    if (!navigator.clipboard?.readText) return;
    navigator.clipboard.readText().then((text) => {
      const trimmed = text.trim();
      if (trimmed && detectSourceType(trimmed)) {
        setSourceUrl(trimmed);
        fetchIssueInfo(trimmed, true);
      }
    }).catch(() => {});
  }, [fetchIssueInfo]);

  // ── Focus management ──────────────────────────────────────────
  useEffect(() => {
    if (showUrlInput) {
      urlInputRef.current?.focus();
    } else {
      // Focus title input if no source url, otherwise focus container
      if (!sourceUrl.trim()) {
        titleInputRef.current?.focus();
      } else {
        ref.current?.focus();
      }
    }
  }, [showUrlInput, sourceUrl]);

  // ── Derived state ─────────────────────────────────────────────
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null;
  const detectedType = sourceUrl.trim() ? detectSourceType(sourceUrl.trim()) : null;
  const detectedLabel = sourceUrl.trim() ? getSourceLabel(sourceUrl.trim()) : null;
  const hasTitle = title.trim().length > 0;
  const hasSource = sourceUrl.trim().length > 0;
  const canSubmit = !!selectedProjectId && (hasTitle || hasSource);

  // ── Project cycling ───────────────────────────────────────────
  const cycleProject = (direction: 1 | -1) => {
    if (projects.length === 0) return;
    const idx = projects.findIndex((p) => p.id === selectedProjectId);
    const next = (idx + direction + projects.length) % projects.length;
    setSelectedProjectId(projects[next].id);
  };

  // ── Submit ────────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!canSubmit) return;
    const url = sourceUrl.trim() || undefined;
    // Clear clipboard if we consumed a source URL from it
    if (url && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText("").catch(() => {});
    }
    onAdd({
      project_id: selectedProjectId!,
      title: title.trim() || undefined,
      description: description.trim() || undefined,
      source_url: url,
      agent_type: agentType,
    });
  };

  // ── URL input handlers ────────────────────────────────────────
  const handleUrlChange = (value: string) => {
    setSourceUrl(value);
    fetchIssueInfo(value);
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      setShowUrlInput(false);
      setSourceUrl("");
      setIssueInfo(null);
      setIssueLoading(false);
      fetchCounterRef.current++;
      setTimeout(() => ref.current?.focus(), 0);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      setShowUrlInput(false);
      setTimeout(() => titleInputRef.current?.focus(), 0);
      return;
    }
  };

  // ── Main key handler ──────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (showUrlInput) {
        setShowUrlInput(false);
        setSourceUrl("");
        setIssueInfo(null);
      } else {
        onClose();
      }
      return;
    }

    // Don't intercept keys when typing in inputs/textarea
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (e.key === "u" || e.key === "U") {
      e.preventDefault();
      setShowUrlInput(true);
      return;
    }

    if ((e.key === "j" || e.key === "J") && projects.length > 1) {
      e.preventDefault();
      cycleProject(1);
      return;
    }
    if ((e.key === "k" || e.key === "K") && projects.length > 1) {
      e.preventDefault();
      cycleProject(-1);
      return;
    }

    if (e.key === "Enter" && canSubmit) {
      e.preventDefault();
      handleSubmit();
      return;
    }
  };

  return (
    <div
      className="new-session-popup-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="new-session-popup new-job-popup"
        ref={ref}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="new-session-popup-title">
          New job in{" "}
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
              onChange={(e) => handleUrlChange(e.target.value)}
              onKeyDown={handleUrlKeyDown}
            />
            {detectedType && (
              <div className="new-session-popup-url-detected">
                <span className="source-type-tag">{detectedType}</span>
                {detectedLabel && <span className="source-label">{detectedLabel}</span>}
                {issueLoading && <span className="new-session-popup-issue-loading">Loading…</span>}
                {!issueLoading && issueInfo && (
                  <span
                    className="new-session-popup-issue-title"
                    title={issueInfo.description || undefined}
                  >
                    {issueInfo.title}
                  </span>
                )}
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
            <span className="new-session-popup-url-text" title={issueInfo?.description || sourceUrl.trim()}>
              {issueInfo ? `${issueInfo.identifier}: ${issueInfo.title}` : (detectedLabel || sourceUrl.trim())}
            </span>
            {issueLoading && <span className="new-session-popup-issue-loading">Loading…</span>}
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
              onClick={() => {
                setSourceUrl("");
                setIssueInfo(null);
                setIssueLoading(false);
                fetchCounterRef.current++;
              }}
              title="Remove URL"
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        )}

        {/* Title */}
        <div className="new-job-field">
          <input
            ref={titleInputRef}
            type="text"
            className="new-job-input"
            placeholder={hasSource ? "Job title (optional — will use issue title)" : "Job title..."}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") { onClose(); return; }
              if (e.key === "Enter" && canSubmit) { e.preventDefault(); handleSubmit(); }
            }}
          />
        </div>

        {/* Description */}
        <div className="new-job-field">
          <textarea
            className="new-job-textarea"
            placeholder="Description / prompt (optional)..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") { onClose(); }
            }}
            rows={3}
          />
        </div>

        {/* Agent type */}
        <div className="new-job-agent-row">
          <span className="new-job-agent-label">Agent:</span>
          <div className="new-job-agent-options">
            {(["claude", "pi"] as const).map((type) => (
              <button
                key={type}
                className={`new-job-agent-btn ${agentType === type ? "active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setAgentType(type)}
              >
                <Icon name={type === "claude" ? "bot" : "pi"} size={14} />
                {type === "claude" ? "Claude Code" : "Pi"}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="new-job-actions">
          <button
            className="btn btn-primary new-job-submit"
            disabled={!canSubmit}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleSubmit}
          >
            Add Job
          </button>
        </div>

        {/* Hints — hidden on touch devices where keyboard shortcuts don't apply */}
        {!showUrlInput && !isTouchDevice && (
          <div className="new-session-popup-hint">
            {projects.length > 1 && <><kbd>j</kbd><kbd>k</kbd> project · </>}
            <kbd>u</kbd> {sourceUrl.trim() ? "edit" : "add"} URL
            {canSubmit && <> · <kbd>Enter</kbd> add</>}
            {" "}· <kbd>Esc</kbd> cancel
          </div>
        )}
      </div>
    </div>
  );
}
