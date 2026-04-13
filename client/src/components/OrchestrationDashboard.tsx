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
import NewJobPopup from "./NewJobPopup";
import { useMrStatus } from "../contexts/MrStatusContext";

// ── Status column configuration ─────────────────────────────────────

const COLUMNS: { status: JobStatus; label: string; color: string }[] = [
  { status: "todo", label: "To Do", color: "var(--text-secondary)" },
  { status: "working", label: "Working", color: "var(--accent)" },
  { status: "waiting_input", label: "Waiting", color: "#e0965a" },
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
  const [approveJobId, setApproveJobId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const { mergeStatuses } = useMrStatus();

  // ── Data fetching ─────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [jobsData, statusData] = await Promise.all([
        fetchOrchestrationJobs(),
        fetchOrchestrationStatus(),
      ]);
      setJobs(jobsData);
      setOrchState(statusData);
      // Merge MR statuses from orchestration jobs into the global store
      // so MrBadge components show correct status for hidden sessions
      const allStatuses: Record<string, import("../api").MrStatus> = {};
      for (const job of jobsData) {
        if (job.mr_statuses) {
          Object.assign(allStatuses, job.mr_statuses);
        }
      }
      if (Object.keys(allStatuses).length > 0) {
        mergeStatuses(allStatuses);
      }
    } catch (err) {
      console.error("[orchestration] Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  }, [mergeStatuses]);

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

  // ── Group jobs by project, then by status ────────────────────
  // Build list of projects that have at least one job
  const projectsWithJobs = (() => {
    const projectIds = new Set(jobs.map((j) => j.project_id));
    return projects.filter((p) => projectIds.has(p.id));
  })();

  // Build a map: projectId -> status -> jobs[]
  const jobsByProjectAndStatus = new Map<number, Map<JobStatus, OrchestrationJobWithSessions[]>>();
  for (const project of projectsWithJobs) {
    const statusMap = new Map<JobStatus, OrchestrationJobWithSessions[]>();
    for (const col of COLUMNS) statusMap.set(col.status, []);
    jobsByProjectAndStatus.set(project.id, statusMap);
  }
  for (const job of jobs) {
    const statusMap = jobsByProjectAndStatus.get(job.project_id);
    if (statusMap) {
      const list = statusMap.get(job.status as JobStatus);
      if (list) list.push(job);
    }
  }

  // Total job count per status (across all projects) for the header
  const totalByStatus = new Map<JobStatus, number>();
  for (const col of COLUMNS) {
    let count = 0;
    for (const [, statusMap] of jobsByProjectAndStatus) {
      count += (statusMap.get(col.status) || []).length;
    }
    totalByStatus.set(col.status, count);
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

      {/* New job popup */}
      {showAddForm && (
        <NewJobPopup
          projects={projects}
          initialProjectId={selectedProjectId}
          onAdd={async (data) => {
            try {
              await createOrchestrationJob(data);
              setShowAddForm(false);
              loadData();
            } catch (err) {
              console.error("Failed to create job:", err);
            }
          }}
          onClose={() => setShowAddForm(false)}
        />
      )}

      {/* Main content: kanban + detail panel */}
      {loading ? (
        <div className="orch-loading">Loading...</div>
      ) : (
        <div className="orch-content">
          {/* Kanban board with project swimlanes */}
          <div className="orch-kanban">
            {/* Status column headers */}
            <div className="orch-kanban-header">
              <div className="orch-swimlane-label-spacer" />
              {COLUMNS.map(({ status, label, color }) => (
                <div key={status} className="orch-column-header" style={{ borderTopColor: color }}>
                  <span className="orch-column-label">{label}</span>
                  <span className="orch-column-count">{totalByStatus.get(status) || 0}</span>
                </div>
              ))}
            </div>

            {/* Project swimlane rows */}
            <div className="orch-kanban-body">
              {projectsWithJobs.map((project) => {
                const statusMap = jobsByProjectAndStatus.get(project.id)!;
                return (
                  <div key={project.id} className="orch-swimlane">
                    <div className="orch-swimlane-label">
                      <span className="orch-swimlane-project-name">{project.name}</span>
                    </div>
                    <div className="orch-swimlane-columns">
                      {COLUMNS.map(({ status }) => {
                        const columnJobs = statusMap.get(status) || [];
                        return (
                          <div key={status} className="orch-column">
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
                                  onApprove={(id) => setApproveJobId(id)}
                                  onNavigateToSession={onNavigateToSession}
                                  projects={projects}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
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
              onApprove={(id) => setApproveJobId(id)}
            />
          )}
        </div>
      )}

      {/* Approve popup */}
      {approveJobId != null && (() => {
        const approveJob = jobs.find((j) => j.id === approveJobId);
        return approveJob ? (
          <ApproveJobPopup
            job={approveJob}
            onClose={() => setApproveJobId(null)}
            onConfirm={(pull) => {
              setApproveJobId(null);
              handleCloseJob(approveJob.id, pull);
            }}
          />
        ) : null;
      })()}

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
  onApprove,
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
  onApprove: (id: number) => void;
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
            onClick={(e) => { e.stopPropagation(); onApprove(job.id); }}
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
  onApprove,
}: {
  job: OrchestrationJobWithSessions;
  projects: Project[];
  onClose: () => void;
  onNavigateToSession?: (sessionId: number) => void;
  onStatusChange: (id: number, status: JobStatus) => void;
  onStartJob: (id: number) => void;
  onDelete: (id: number) => void;
  onApprove: (id: number) => void;
}) {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [moveOpen, setMoveOpen] = useState(false);
  const moveRef = useRef<HTMLDivElement>(null);
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const lastEventIdRef = useRef<number>(0);

  useEffect(() => {
    if (!moveOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (moveRef.current && !moveRef.current.contains(e.target as Node)) {
        setMoveOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [moveOpen]);
  const project = projects.find((p) => p.id === job.project_id);
  const isJobDone = job.status === "finished" || job.status === "rejected";

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
                title={isJobDone ? "Click to revive and view" : undefined}
              >
                <Icon name="bot" size={12} />
                <span className="orch-session-role">orchestrator</span>
                <span className="orch-session-id">#{js.session_id}</span>
                {isJobDone && <Icon name="archive-restore" size={10} />}
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
                title={isJobDone ? "Click to revive and view" : undefined}
              >
                <Icon name="terminal" size={12} />
                <span className="orch-session-role">{js.role}</span>
                <span className="orch-session-id">#{js.session_id}</span>
                {isJobDone && <Icon name="archive-restore" size={10} />}
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
            <button className="btn btn-primary orch-card-btn" onClick={() => onApprove(job.id)}>
              <Icon name="check" size={14} /> Approve
            </button>
            <button className="btn btn-secondary orch-card-btn orch-btn-stop" onClick={() => onStatusChange(job.id, "rejected")}>
              Reject
            </button>
          </>
        )}
        {(job.status === "todo" || job.status === "finished" || job.status === "rejected" || job.status === "waiting_input") && (
          <button className="btn btn-secondary orch-card-btn orch-btn-stop" onClick={() => onDelete(job.id)}>
            Delete
          </button>
        )}
        <div className="orch-move-dropdown" ref={moveRef}>
          <button
            className="btn btn-secondary orch-card-btn"
            onClick={() => setMoveOpen((o) => !o)}
          >
            Move to... <Icon name="chevron-down" size={12} />
          </button>
          {moveOpen && (
            <div className="orch-move-menu">
              {COLUMNS.filter((c) => c.status !== job.status).map(({ status, label, color }) => (
                <button
                  key={status}
                  className="orch-move-option"
                  style={{ color }}
                  onClick={() => {
                    onStatusChange(job.id, status);
                    setMoveOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Event log */}
      <div className="orch-detail-section orch-detail-section-grow">
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

// ── Approve Job Popup ─────────────────────────────────────────────

function ApproveJobPopup({
  job,
  onClose,
  onConfirm,
}: {
  job: OrchestrationJobWithSessions;
  onClose: () => void;
  onConfirm: (pull: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pullEnabled, setPullEnabled] = useState(true);
  const { statuses: mrStatuses } = useMrStatus();

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const openMrUrls = (job.mr_urls || []).filter((url) => {
    const s = mrStatuses[url] || job.mr_statuses?.[url];
    return !s || (s.state !== "merged" && s.state !== "closed");
  });
  const doneMrUrls = (job.mr_urls || []).filter((url) => {
    const s = mrStatuses[url] || job.mr_statuses?.[url];
    return s && (s.state === "merged" || s.state === "closed");
  });
  const hasMrs = openMrUrls.length > 0;
  const hasDoneMrs = doneMrUrls.length > 0;
  const sourceType = job.source_url ? detectSourceType(job.source_url) : null;
  const hasLinear = sourceType === "linear";
  const hasJira = sourceType === "jira";
  const sessionCount = job.sessions.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" || e.key.toLowerCase() === "n") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" || e.key.toLowerCase() === "y") {
      e.preventDefault();
      onConfirm(pullEnabled);
    } else if (e.key.toLowerCase() === "p" && hasMrs) {
      e.preventDefault();
      setPullEnabled((v) => !v);
    }
  };

  return (
    <div className="new-session-popup-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="close-session-popup"
        ref={ref}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="close-session-header">
          <Icon name="check" size={16} />
          <span className="close-session-title">Approve Job</span>
          <button className="close-session-close-btn" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="close-session-body">
          <p className="close-session-desc">
            Approving <strong>{job.title}</strong> will:
          </p>
          <ul className="close-session-actions-list">
            {hasMrs && (
              <li>
                <Icon name="git-merge" size={13} />
                <span>
                  Merge {openMrUrls.length} MR/PR{openMrUrls.length !== 1 ? "s" : ""}:
                </span>
                <div className="close-session-links">
                  {openMrUrls.map((url) => (
                    <MrBadge key={url} url={url} className="close-session-mr-badge" />
                  ))}
                </div>
              </li>
            )}
            {hasDoneMrs && (
              <li className="close-session-done-mrs">
                <Icon name="check-circle" size={13} />
                <span>Already merged/closed (skip):</span>
                <div className="close-session-links">
                  {doneMrUrls.map((url) => (
                    <MrBadge key={url} url={url} className="close-session-mr-badge" />
                  ))}
                </div>
              </li>
            )}
            {hasLinear && job.source_url && (
              <li>
                <Icon name="check-circle" size={13} />
                <span>Set Linear issue to Done:</span>
                <a
                  className="close-session-source-link"
                  href={job.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Icon name={getSourceIcon(sourceType as SourceType)} size={11} />
                  {getSourceLabel(job.source_url) || "issue"}
                </a>
              </li>
            )}
            {hasJira && job.source_url && (
              <li>
                <Icon name="check-circle" size={13} />
                <span>Set JIRA issue to Done:</span>
                <a
                  className="close-session-source-link"
                  href={job.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Icon name={getSourceIcon(sourceType as SourceType)} size={11} />
                  {getSourceLabel(job.source_url) || "issue"}
                </a>
              </li>
            )}
            {hasMrs && (
              <li
                className="close-session-option-toggle"
                onClick={() => setPullEnabled((v) => !v)}
              >
                <span className={`close-session-checkbox ${pullEnabled ? "checked" : ""}`}>
                  {pullEnabled && <Icon name="check" size={10} />}
                </span>
                <span>Pull on GitButler after merge</span>
                <kbd>P</kbd>
              </li>
            )}
            <li>
              <Icon name="archive" size={13} />
              <span>Archive {sessionCount} session{sessionCount !== 1 ? "s" : ""}</span>
            </li>
          </ul>
        </div>

        <div className="close-session-footer">
          <button
            className="btn btn-success"
            onClick={() => onConfirm(pullEnabled)}
          >
            <kbd>Y</kbd> <Icon name="check" size={13} /> Approve
          </button>
          <button
            className="btn btn-secondary"
            onClick={onClose}
          >
            <kbd>N</kbd> Cancel
          </button>
        </div>
        <div className="new-session-popup-hint">
          <kbd>Enter</kbd> / <kbd>Y</kbd> to confirm · <kbd>Esc</kbd> / <kbd>N</kbd> to cancel{hasMrs && <> · <kbd>P</kbd> toggle pull</>}
        </div>
      </div>
    </div>
  );
}
