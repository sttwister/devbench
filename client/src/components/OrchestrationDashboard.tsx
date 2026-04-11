// @lat: [[orchestration#Dashboard UI]]
import { useState, useEffect, useCallback, useRef } from "react";
import type {
  OrchestrationJobWithSessions,
  OrchestrationState,
  JobStatus,
  Project,
  OrchestrationJobSession,
  JobEvent,
} from "../api";
import {
  fetchOrchestrationJobs,
  fetchOrchestrationStatus,
  createOrchestrationJob,
  updateOrchestrationJob,
  deleteOrchestrationJob,
  startOrchestration,
  stopOrchestration,
  startOrchestrationJob,
  fetchJobEvents,
  closeOrchestrationJob,
  getSourceLabel,
  getSourceIcon,
  detectSourceType,
} from "../api";
import type { CloseJobResult, SourceType, MergeResult } from "../api";
import Icon from "./Icon";
import MrBadge from "./MrBadge";

// ── Status column configuration ─────────────────────────────────────

const COLUMNS: { status: JobStatus; label: string; color: string }[] = [
  { status: "todo", label: "To Do", color: "var(--text-secondary)" },
  { status: "working", label: "Working", color: "var(--accent)" },
  { status: "waiting_input", label: "Waiting", color: "#e0965a" },
  { status: "testing", label: "Testing", color: "#d2a8ff" },
  { status: "review", label: "Review", color: "#7ee787" },
  { status: "finished", label: "Finished", color: "#56d364" },
  { status: "rejected", label: "Rejected", color: "var(--danger)" },
];

// ── Props ───────────────────────────────────────────────────────────

interface Props {
  projects: Project[];
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  onClose: () => void;
  onNavigateToSession?: (sessionId: number) => void;
  hasUnreadNotifications: boolean;
}

export default function OrchestrationDashboard({
  projects,
  sidebarOpen,
  setSidebarOpen,
  onClose,
  onNavigateToSession,
  hasUnreadNotifications,
}: Props) {
  const [jobs, setJobs] = useState<OrchestrationJobWithSessions[]>([]);
  const [orchState, setOrchState] = useState<OrchestrationState>({ running: false, currentJobId: null, activeJobCount: 0 });
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    projects.length > 0 ? projects[0].id : null
  );
  const [closeToast, setCloseToast] = useState<{
    jobTitle: string;
    result: CloseJobResult | null;
    error: string | null;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // ── Data fetching ─────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [jobsData, statusData] = await Promise.all([
        fetchOrchestrationJobs(),
        fetchOrchestrationStatus(),
      ]);
      setJobs(jobsData);
      setOrchState(statusData);
    } catch (err) {
      console.error("[orchestration] Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Poll every 3 seconds for updates
    pollRef.current = setInterval(loadData, 3000);
    return () => clearInterval(pollRef.current);
  }, [loadData]);

  // ── Keyboard: q to close, Escape to deselect ─────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "q" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (selectedJobId) {
          setSelectedJobId(null);
        } else {
          onClose();
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (selectedJobId) {
          setSelectedJobId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, selectedJobId]);

  // ── Actions ───────────────────────────────────────────────────
  const handleStart = async () => {
    try {
      const state = await startOrchestration();
      setOrchState(state);
    } catch (err) {
      console.error("Failed to start orchestration:", err);
    }
  };

  const handleStop = async () => {
    try {
      const state = await stopOrchestration();
      setOrchState(state);
    } catch (err) {
      console.error("Failed to stop orchestration:", err);
    }
  };

  const handleStatusChange = async (jobId: number, newStatus: JobStatus) => {
    try {
      await updateOrchestrationJob(jobId, { status: newStatus });
      loadData();
    } catch (err) {
      console.error("Failed to update job status:", err);
    }
  };

  const handleDelete = async (jobId: number) => {
    try {
      await deleteOrchestrationJob(jobId);
      if (selectedJobId === jobId) setSelectedJobId(null);
      loadData();
    } catch (err) {
      console.error("Failed to delete job:", err);
    }
  };

  const handleStartJob = async (jobId: number) => {
    try {
      const state = await startOrchestrationJob(jobId);
      setOrchState(state);
      loadData();
    } catch (err) {
      console.error("Failed to start job:", err);
    }
  };

  const handleCloseJob = async (jobId: number, pull: boolean) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    setCloseToast({ jobTitle: job.title, result: null, error: null });
    try {
      const result = await closeOrchestrationJob(jobId, pull);
      setCloseToast({ jobTitle: job.title, result, error: null });
      if (selectedJobId === jobId) setSelectedJobId(null);
      loadData();
    } catch (err: any) {
      setCloseToast({ jobTitle: job.title, result: null, error: err.message });
    }
  };

  // ── Group jobs by status ──────────────────────────────────────
  const jobsByStatus = new Map<JobStatus, OrchestrationJobWithSessions[]>();
  for (const col of COLUMNS) {
    jobsByStatus.set(col.status, []);
  }
  for (const job of jobs) {
    const list = jobsByStatus.get(job.status as JobStatus);
    if (list) list.push(job);
  }

  const selectedJob = selectedJobId ? jobs.find((j) => j.id === selectedJobId) : null;

  return (
    <main className="orch-dashboard">
      {/* Header */}
      <header className="orch-header">
        {!sidebarOpen && (
          <button
            className="btn btn-secondary orch-header-btn"
            onClick={() => setSidebarOpen(true)}
            title="Show sidebar"
          >
            <Icon name="sidebar" size={14} />
          </button>
        )}
        <h2>Orchestration</h2>
        <div className="orch-header-spacer" />

        {/* Engine status */}
        <span className={`orch-engine-status ${orchState.running ? "running" : "stopped"}`}>
          <span className="orch-engine-dot" />
          {orchState.running ? "Running" : "Stopped"}
        </span>

        {orchState.running ? (
          <button className="btn btn-secondary orch-header-btn orch-btn-stop" onClick={handleStop}>
            <Icon name="square" size={14} /> <span className="btn-label">Stop</span>
          </button>
        ) : (
          <button className="btn btn-primary orch-header-btn" onClick={handleStart}>
            <Icon name="play" size={14} /> <span className="btn-label">Start</span>
          </button>
        )}

        <button
          className="btn btn-secondary orch-header-btn"
          onClick={() => setShowAddForm(!showAddForm)}
        >
          <Icon name="plus" size={14} /> <span className="btn-label">Add Job</span>
        </button>

        <button className="icon-btn" onClick={onClose} title="Close (q)">
          <Icon name="x" size={18} />
        </button>
      </header>

      {/* Add job form */}
      {showAddForm && (
        <AddJobForm
          projects={projects}
          selectedProjectId={selectedProjectId}
          onProjectChange={setSelectedProjectId}
          onAdd={async (data) => {
            try {
              await createOrchestrationJob(data);
              setShowAddForm(false);
              loadData();
            } catch (err) {
              console.error("Failed to create job:", err);
            }
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Main content: kanban + detail panel */}
      {loading ? (
        <div className="orch-loading">Loading...</div>
      ) : (
        <div className="orch-content">
          {/* Kanban board */}
          <div className="orch-kanban">
            {COLUMNS.map(({ status, label, color }) => {
              const columnJobs = jobsByStatus.get(status) || [];
              return (
                <div key={status} className="orch-column">
                  <div className="orch-column-header" style={{ borderTopColor: color }}>
                    <span className="orch-column-label">{label}</span>
                    <span className="orch-column-count">{columnJobs.length}</span>
                  </div>
                  <div className="orch-column-body">
                    {columnJobs.map((job) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        isCurrentJob={orchState.currentJobId === job.id}
                        isSelected={selectedJobId === job.id}
                        onSelect={(id) => setSelectedJobId(selectedJobId === id ? null : id)}
                        onStatusChange={handleStatusChange}
                        onStartJob={handleStartJob}
                        onDelete={handleDelete}
                        onNavigateToSession={onNavigateToSession}
                        projects={projects}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detail panel */}
          {selectedJob && (
            <JobDetailPanel
              job={selectedJob}
              projects={projects}
              onClose={() => setSelectedJobId(null)}
              onNavigateToSession={onNavigateToSession}
              onStatusChange={handleStatusChange}
              onStartJob={handleStartJob}
              onDelete={handleDelete}
              onCloseJob={handleCloseJob}
            />
          )}
        </div>
      )}

      {/* Close toast */}
      {closeToast && (
        <CloseJobToast toast={closeToast} onDismiss={() => setCloseToast(null)} />
      )}
    </main>
  );
}

// ── Job Card ────────────────────────────────────────────────────────

function JobCard({
  job,
  isCurrentJob,
  isSelected,
  onSelect,
  onStatusChange,
  onStartJob,
  onDelete,
  onNavigateToSession,
  projects,
}: {
  job: OrchestrationJobWithSessions;
  isCurrentJob: boolean;
  isSelected: boolean;
  onSelect: (id: number) => void;
  onStatusChange: (id: number, status: JobStatus) => void;
  onStartJob: (id: number) => void;
  onDelete: (id: number) => void;
  onNavigateToSession?: (sessionId: number) => void;
  projects: Project[];
}) {
  const project = projects.find((p) => p.id === job.project_id);

  return (
    <div
      className={`orch-card ${isCurrentJob ? "orch-card-active" : ""} ${isSelected ? "orch-card-selected" : ""}`}
      onClick={() => onSelect(job.id)}
    >
      <div className="orch-card-header">
        <span className="orch-card-title">{job.title}</span>
        {isCurrentJob && <span className="orch-card-badge">Active</span>}
      </div>

      {project && (
        <div className="orch-card-project">{project.name}</div>
      )}

      {job.source_url && (
        <a
          className="orch-card-source"
          href={job.source_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <Icon name="external-link" size={12} /> Issue
        </a>
      )}

      {/* MR badges */}
      {job.mr_urls?.length > 0 && (
        <div className="orch-card-mrs">
          {job.mr_urls.map((url) => (
            <MrBadge key={url} url={url} className="orch-card-mr-badge" />
          ))}
        </div>
      )}

      {job.error_message && (
        <div className="orch-card-error" title={job.error_message}>
          <Icon name="alert-triangle" size={12} /> {job.error_message.slice(0, 60)}
        </div>
      )}

      {/* Quick actions (visible on hover) */}
      <div className="orch-card-quick-actions">
        {job.sessions.length > 0 && (
          <button
            className="orch-quick-btn"
            title="View latest session"
            onClick={(e) => {
              e.stopPropagation();
              onNavigateToSession?.(job.sessions[job.sessions.length - 1].session_id);
            }}
          >
            <Icon name="terminal" size={12} />
          </button>
        )}
        {job.status === "review" && (
          <button
            className="orch-quick-btn orch-quick-approve"
            title="Approve"
            onClick={(e) => { e.stopPropagation(); onStatusChange(job.id, "finished"); }}
          >
            <Icon name="check" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Job Detail Panel ────────────────────────────────────────────────

function JobDetailPanel({
  job,
  projects,
  onClose,
  onNavigateToSession,
  onStatusChange,
  onStartJob,
  onDelete,
  onCloseJob,
}: {
  job: OrchestrationJobWithSessions;
  projects: Project[];
  onClose: () => void;
  onNavigateToSession?: (sessionId: number) => void;
  onStatusChange: (id: number, status: JobStatus) => void;
  onStartJob: (id: number) => void;
  onDelete: (id: number) => void;
  onCloseJob: (id: number, pull: boolean) => void;
}) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const lastEventIdRef = useRef<number>(0);
  const project = projects.find((p) => p.id === job.project_id);

  // Load events with incremental polling
  useEffect(() => {
    let mounted = true;
    lastEventIdRef.current = 0;
    setEvents([]);
    setEventsLoading(true);

    const load = async () => {
      try {
        if (lastEventIdRef.current === 0) {
          // Initial full load
          const data = await fetchJobEvents(job.id);
          if (mounted) {
            setEvents(data);
            if (data.length > 0) lastEventIdRef.current = data[data.length - 1].id;
            setEventsLoading(false);
          }
        } else {
          // Incremental: fetch only new events
          const newEvents = await fetchJobEvents(job.id, lastEventIdRef.current);
          if (mounted && newEvents.length > 0) {
            setEvents((prev) => [...prev, ...newEvents]);
            lastEventIdRef.current = newEvents[newEvents.length - 1].id;
          }
        }
      } catch {
        if (mounted) setEventsLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 3000);
    return () => { mounted = false; clearInterval(timer); };
  }, [job.id]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  const statusColor = COLUMNS.find((c) => c.status === job.status)?.color || "var(--text-secondary)";

  return (
    <div className="orch-detail">
      <div className="orch-detail-header">
        <h3>{job.title}</h3>
        <button className="btn btn-secondary orch-header-btn" onClick={onClose} title="Close">
          <Icon name="x" size={14} />
        </button>
      </div>

      {/* Status & metadata */}
      <div className="orch-detail-meta">
        <span className="orch-detail-status" style={{ color: statusColor }}>
          {COLUMNS.find((c) => c.status === job.status)?.label || job.status}
        </span>
        {project && <span className="orch-detail-project">{project.name}</span>}
        <span className="orch-detail-agent">{job.agent_type}</span>
        {job.current_loop > 0 && <span>Loop {job.current_loop}</span>}
      </div>

      {/* Source URL */}
      {job.source_url && (
        <a className="orch-detail-source" href={job.source_url} target="_blank" rel="noopener noreferrer">
          <Icon name="external-link" size={12} /> {job.source_url}
        </a>
      )}

      {/* Description */}
      {job.description && (
        <div className="orch-detail-desc">{job.description}</div>
      )}

      {/* Error */}
      {job.error_message && (
        <div className="orch-detail-error">
          <Icon name="alert-triangle" size={14} /> {job.error_message}
        </div>
      )}

      {/* Sessions */}
      {job.sessions.length > 0 && (
        <div className="orch-detail-section">
          <div className="orch-detail-section-label">Sessions</div>
          <div className="orch-detail-sessions">
            {/* Orchestrator session first, prominent */}
            {job.sessions
              .filter((js: OrchestrationJobSession) => js.role === "orchestrator")
              .map((js: OrchestrationJobSession) => (
              <button
                key={js.id}
                className="orch-session-link orch-session-orchestrator"
                onClick={() => onNavigateToSession?.(js.session_id)}
              >
                <Icon name="bot" size={12} />
                <span className="orch-session-role">orchestrator</span>
                <span className="orch-session-id">#{js.session_id}</span>
              </button>
            ))}
            {/* Child sessions */}
            {job.sessions
              .filter((js: OrchestrationJobSession) => js.role !== "orchestrator")
              .map((js: OrchestrationJobSession) => (
              <button
                key={js.id}
                className="orch-session-link"
                onClick={() => onNavigateToSession?.(js.session_id)}
              >
                <Icon name="terminal" size={12} />
                <span className="orch-session-role">{js.role}</span>
                <span className="orch-session-id">#{js.session_id}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Merge Requests */}
      {job.mr_urls?.length > 0 && (
        <div className="orch-detail-section">
          <div className="orch-detail-section-label">Merge Requests</div>
          <div className="orch-detail-mrs">
            {job.mr_urls.map((url) => (
              <MrBadge key={url} url={url} className="orch-detail-mr-badge" />
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="orch-detail-actions">
        {(job.status === "todo" || job.status === "waiting_input") && (
          <button className="btn btn-primary orch-card-btn" onClick={() => onStartJob(job.id)}>
            <Icon name="play" size={14} /> Start Now
          </button>
        )}
        {job.status === "review" && (
          <>
            <button className="btn btn-primary orch-card-btn" onClick={() => onCloseJob(job.id, true)}>
              <Icon name="git-merge" size={14} /> Close Job
            </button>
            <button className="btn btn-secondary orch-card-btn orch-btn-stop" onClick={() => onStatusChange(job.id, "rejected")}>
              Reject
            </button>
          </>
        )}
        {job.status === "finished" && (job.mr_urls?.length ?? 0) > 0 && (
          <button className="btn btn-primary orch-card-btn" onClick={() => onCloseJob(job.id, true)}>
            <Icon name="git-merge" size={14} /> Merge & Close
          </button>
        )}
        {(job.status === "todo" || job.status === "finished" || job.status === "rejected" || job.status === "waiting_input") && (
          <button className="btn btn-secondary orch-card-btn orch-btn-stop" onClick={() => onDelete(job.id)}>
            Delete
          </button>
        )}
      </div>

      {/* Manual status override */}
      <div className="orch-detail-section">
        <div className="orch-detail-section-label">Move to</div>
        <div className="orch-detail-status-btns">
          {COLUMNS.filter((c) => c.status !== job.status).map(({ status, label, color }) => (
            <button
              key={status}
              className="orch-status-btn"
              style={{ borderColor: color, color }}
              onClick={() => onStatusChange(job.id, status)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Event log */}
      <div className="orch-detail-section">
        <div className="orch-detail-section-label">Event Log</div>
        <div className="orch-detail-events">
          {eventsLoading ? (
            <div className="orch-detail-events-empty">Loading...</div>
          ) : events.length === 0 ? (
            <div className="orch-detail-events-empty">No events yet</div>
          ) : (
            events.map((ev) => (
              <div key={ev.id} className={`orch-event orch-event-${ev.type}`}>
                <span className="orch-event-time">
                  {new Date(ev.timestamp).toLocaleTimeString()}
                </span>
                <span className="orch-event-msg">{ev.message}</span>
              </div>
            ))
          )}
          <div ref={eventsEndRef} />
        </div>
      </div>
    </div>
  );
}

// ── Add Job Form ────────────────────────────────────────────────────

function AddJobForm({
  projects,
  selectedProjectId,
  onProjectChange,
  onAdd,
  onCancel,
}: {
  projects: Project[];
  selectedProjectId: number | null;
  onProjectChange: (id: number | null) => void;
  onAdd: (data: {
    project_id: number;
    title: string;
    description?: string;
    source_url?: string;
    agent_type?: string;
  }) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [agentType, setAgentType] = useState("claude");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId || !title.trim()) return;
    onAdd({
      project_id: selectedProjectId,
      title: title.trim(),
      description: description.trim() || undefined,
      source_url: sourceUrl.trim() || undefined,
      agent_type: agentType,
    });
  };

  return (
    <form className="orch-add-form" onSubmit={handleSubmit}>
      <div className="orch-add-form-row">
        <select
          value={selectedProjectId ?? ""}
          onChange={(e) => onProjectChange(e.target.value ? parseInt(e.target.value) : null)}
        >
          <option value="">Select project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <input
          ref={titleRef}
          type="text"
          placeholder="Job title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="orch-add-input"
        />
      </div>

      <div className="orch-add-form-row">
        <input
          type="text"
          placeholder="Source URL (Linear issue, etc.)..."
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className="orch-add-input"
        />

        <select value={agentType} onChange={(e) => setAgentType(e.target.value)}>
          <option value="claude">Claude Code</option>
          <option value="pi">Pi</option>
        </select>
      </div>

      <textarea
        placeholder="Description / prompt (optional)..."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="orch-add-textarea"
        rows={3}
      />

      <div className="orch-add-form-actions">
        <button type="submit" className="btn btn-primary orch-header-btn" disabled={!selectedProjectId || !title.trim()}>
          Add Job
        </button>
        <button type="button" className="btn btn-secondary orch-header-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Close Job Toast ───────────────────────────────────────────────────

function CloseJobToast({
  toast,
  onDismiss,
}: {
  toast: { jobTitle: string; result: CloseJobResult | null; error: string | null };
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!toast.result && !toast.error) return;
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, 8000);
    return () => clearTimeout(timer);
  }, [toast.result, toast.error, onDismiss]);

  const { result, error, jobTitle } = toast;

  return (
    <div className={`close-session-toast ${visible ? "visible" : "hiding"}`} onClick={onDismiss}>
      <div className="close-session-toast-header">
        <Icon name="check-circle" size={13} />
        <span className="close-session-toast-title">
          {result || error ? jobTitle : `Closing ${jobTitle}\u2026`}
        </span>
        <button className="close-session-toast-dismiss" onClick={onDismiss}>
          <Icon name="x" size={12} />
        </button>
      </div>
      {!result && !error && (
        <div className="close-session-toast-body">
          <Icon name="loader" size={12} />
          <span>Merging MRs, updating issues\u2026</span>
        </div>
      )}
      {error && (
        <div className="close-session-toast-body error">
          <Icon name="x-circle" size={12} />
          <span>{error}</span>
        </div>
      )}
      {result && (
        <div className="close-session-toast-results">
          {result.mergeResults.map((mr: MergeResult) => (
            <div key={mr.url} className={`close-session-result-item ${mr.outcome}`}>
              <Icon
                name={mr.outcome === "merged" ? "check" : mr.outcome === "auto-merge" ? "loader" : "x-circle"}
                size={11}
              />
              <span>{shortMrLabel(mr.url)}: {mr.message}</span>
            </div>
          ))}
          {result.linearResult && (
            <div className={`close-session-result-item ${result.linearResult.newState ? "merged" : "error"}`}>
              <Icon name={result.linearResult.newState ? "check" : "x-circle"} size={11} />
              <span>
                {result.linearResult.identifier}:{" "}
                {result.linearResult.newState ? `\u2192 ${result.linearResult.newState}` : "Failed to update"}
              </span>
            </div>
          )}
          {result.jiraResult && (
            <div className={`close-session-result-item ${result.jiraResult.newState ? "merged" : "error"}`}>
              <Icon name={result.jiraResult.newState ? "check" : "x-circle"} size={11} />
              <span>
                {result.jiraResult.key}:{" "}
                {result.jiraResult.newState ? `\u2192 ${result.jiraResult.newState}` : "Failed to update"}
              </span>
            </div>
          )}
          {result.archived && (
            <div className="close-session-result-item merged">
              <Icon name="check" size={11} />
              <span>Sessions archived, job finished</span>
            </div>
          )}
          {result.pullResults.map((pr) => (
            <div key={pr.projectId} className={`close-session-result-item ${pr.success ? "merged" : "error"}`}>
              <Icon name={pr.success ? "check" : "x-circle"} size={11} />
              <span>
                {pr.projectName}:{" "}
                {pr.success
                  ? pr.hasConflicts ? "pulled with conflicts" : "pulled successfully"
                  : `pull failed: ${pr.error}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function shortMrLabel(url: string): string {
  const gh = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (gh) return `${gh[1]}#${gh[2]}`;
  const gl = url.match(/([^/]+)\/-\/merge_requests\/(\d+)/);
  if (gl) return `${gl[1]}!${gl[2]}`;
  return url;
}
