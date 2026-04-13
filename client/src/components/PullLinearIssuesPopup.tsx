// @lat: [[orchestration#Dashboard UI#Pull from Linear]]
/**
 * Popup for pulling orchestration jobs from Linear. Lists backlog/todo
 * issues grouped by devbench project (for projects associated with a
 * Linear project), sorted by priority, with checkboxes to select which
 * to create as orchestration jobs.
 */
import { useEffect, useMemo, useState } from "react";
import type { Project, LinearProjectIssue } from "../api";
import { fetchLinearProjectIssues } from "../api";
import Icon from "./Icon";

interface Props {
  projects: Project[];
  /** source_urls of existing jobs to exclude from the pull list. */
  existingJobSourceUrls: Set<string>;
  onClose: () => void;
  onConfirm: (selection: Array<{ projectId: number; issue: LinearProjectIssue }>) => Promise<void>;
}

type IssuesByProject = Map<number, { loading: boolean; error: string | null; issues: LinearProjectIssue[] }>;

export default function PullLinearIssuesPopup({
  projects,
  existingJobSourceUrls,
  onClose,
  onConfirm,
}: Props) {
  const projectsWithLinear = useMemo(
    () => projects.filter((p) => p.linear_project_id),
    [projects],
  );

  const [byProject, setByProject] = useState<IssuesByProject>(() => new Map());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // ── Fetch issues for each linked project in parallel ─────────
  useEffect(() => {
    let cancelled = false;
    const initial: IssuesByProject = new Map();
    for (const p of projectsWithLinear) {
      initial.set(p.id, { loading: true, error: null, issues: [] });
    }
    setByProject(initial);

    Promise.all(
      projectsWithLinear.map(async (p) => {
        try {
          const issues = await fetchLinearProjectIssues(p.linear_project_id!);
          return { projectId: p.id, issues, error: null as string | null };
        } catch (e: any) {
          return { projectId: p.id, issues: [] as LinearProjectIssue[], error: e.message || "Failed to fetch" };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: IssuesByProject = new Map();
      for (const r of results) {
        next.set(r.projectId, { loading: false, error: r.error, issues: r.issues });
      }
      setByProject(next);
    });

    return () => { cancelled = true; };
  }, [projectsWithLinear]);

  // ── Selection key (project id + issue id, since the same Linear
  //   issue could theoretically appear under multiple devbench projects) ──
  const keyFor = (projectId: number, issue: LinearProjectIssue) => `${projectId}::${issue.id}`;

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selected.size === 0 || submitting) return;
    const picks: Array<{ projectId: number; issue: LinearProjectIssue }> = [];
    for (const project of projectsWithLinear) {
      const entry = byProject.get(project.id);
      if (!entry) continue;
      for (const issue of entry.issues) {
        if (selected.has(keyFor(project.id, issue))) {
          picks.push({ projectId: project.id, issue });
        }
      }
    }
    setSubmitting(true);
    try {
      await onConfirm(picks);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const anyLinked = projectsWithLinear.length > 0;

  return (
    <div
      className="new-session-popup-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="new-session-popup pull-linear-popup" style={{ maxWidth: 640, width: "90vw" }}>
        <div className="new-session-popup-title">
          Pull issues from Linear
        </div>

        {!anyLinked && (
          <div style={{ padding: "12px 0", color: "var(--text-secondary)" }}>
            No projects are associated with a Linear project yet. Associations
            are created automatically when a devbench project has the same name
            as a Linear project.
          </div>
        )}

        <div
          className="pull-linear-body"
          style={{ maxHeight: "60vh", overflowY: "auto", marginTop: 8 }}
        >
          {projectsWithLinear.map((project) => {
            const entry = byProject.get(project.id);
            return (
              <div key={project.id} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    fontWeight: 600,
                    marginBottom: 4,
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: 2,
                  }}
                >
                  {project.name}
                </div>
                {!entry || entry.loading ? (
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>Loading…</div>
                ) : entry.error ? (
                  <div style={{ color: "var(--danger)", fontSize: 12 }}>{entry.error}</div>
                ) : entry.issues.length === 0 ? (
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                    No backlog/todo issues.
                  </div>
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {entry.issues.map((issue) => {
                      const existing = existingJobSourceUrls.has(issue.url);
                      const key = keyFor(project.id, issue);
                      const checked = selected.has(key);
                      return (
                        <li
                          key={issue.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 0",
                            opacity: existing ? 0.5 : 1,
                          }}
                        >
                          <input
                            type="checkbox"
                            disabled={existing}
                            checked={checked}
                            onChange={() => toggle(key)}
                          />
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-secondary)" }}>
                            {issue.identifier}
                          </span>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {issue.title}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              padding: "1px 6px",
                              borderRadius: 3,
                              background: "var(--bg-secondary)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {issue.priorityLabel}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              padding: "1px 6px",
                              borderRadius: 3,
                              background: "var(--bg-secondary)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {issue.state.name}
                          </span>
                          {existing && (
                            <span style={{ fontSize: 10, color: "var(--text-secondary)" }} title="Already a job">
                              existing
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <div className="new-job-actions" style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={selected.size === 0 || submitting}
          >
            <Icon name="plus" size={14} /> Add as Jobs ({selected.size})
          </button>
        </div>
      </div>
    </div>
  );
}
