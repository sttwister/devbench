import { SESSION_TYPE_CONFIGS, detectSourceType, getSourceLabel } from "@devbench/shared";
import { Router } from "../router.ts";
import * as db from "../db.ts";
import * as terminal from "../terminal.ts";
import * as monitors from "../monitor-manager.ts";
import * as autoRename from "../auto-rename.ts";
import * as cache from "../gitbutler-cache.ts";
import * as linear from "../linear.ts";
import { sendJson, readBody } from "../http-utils.ts";
import { extractMrUrls } from "../mr-links.ts";
import { DEFAULT_NAME_RE, toFeatureBranchName } from "../session-naming.ts";
import { pasteToPane } from "../tmux-utils.ts";
import * as mrMerge from "../mr-merge.ts";

export function registerSessionRoutes(api: Router): void {
  api.post("/api/projects/:id/sessions", async (req, res, { id: idStr }) => {
    const projectId = parseInt(idStr);
    const project = db.getProject(projectId);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    const body = await readBody(req);
    const validTypes = Object.keys(SESSION_TYPE_CONFIGS);
    if (!body.name || !validTypes.includes(body.type))
      return sendJson(res, { error: `name and type (${validTypes.join("|")}) required` }, 400);

    // Source URL handling
    const sourceUrl: string | null = body.source_url?.trim() || null;
    const sourceType = sourceUrl ? detectSourceType(sourceUrl) : null;

    // For Linear issues with a configured token, fetch issue details
    let linearIssue: linear.LinearIssue | null = null;
    let pastePrompt: string | null = null;
    if (sourceType === "linear" && sourceUrl && body.type !== "terminal") {
      linearIssue = await linear.fetchIssueFromUrl(sourceUrl);
    }

    // Generate initial prompt or paste prompt
    let initialPrompt: string | null = null;
    if (linearIssue && body.type !== "terminal") {
      // For Linear issues: paste prompt into terminal without submitting
      pastePrompt = linear.promptFromIssue(linearIssue);
    } else if (sourceUrl && body.type !== "terminal") {
      initialPrompt = `Implement this: ${sourceUrl}`;
    }

    // Use Linear issue for session name, or fall back to source label
    let sessionName = body.name;
    if (linearIssue && DEFAULT_NAME_RE.test(body.name)) {
      sessionName = linear.sessionNameFromIssue(linearIssue);
    } else if (sourceUrl && DEFAULT_NAME_RE.test(body.name)) {
      const label = getSourceLabel(sourceUrl);
      if (label) sessionName = label;
    }

    const tmuxName = `devbench_${projectId}_${Date.now()}`;
    try {
      // When we have a paste prompt, launch the agent without an initial prompt
      // and paste the content after the agent has booted
      const result = await terminal.createTmuxSession(
        tmuxName, project.path, body.type,
        pastePrompt ? null : initialPrompt
      );
      const session = db.addSession(projectId, sessionName, body.type, tmuxName, sourceUrl, sourceType);
      if (result.agentSessionId) {
        db.updateSessionAgentId(session.id, result.agentSessionId);
      }
      monitors.startSessionMonitors(session.id, tmuxName, session.name, body.type, []);

      // Schedule paste after agent has booted (delay to let TUI initialize)
      if (pastePrompt) {
        const promptText = pastePrompt;
        setTimeout(() => {
          pasteToPane(tmuxName, promptText);
        }, 3000);
      }

      // Mark Linear issue as "In Progress" (fire-and-forget)
      if (sourceType === "linear" && sourceUrl) {
        const identifier = linear.parseLinearIssueId(sourceUrl);
        if (identifier) {
          linear.markIssueInProgress(identifier).catch((e) => {
            console.error(`[sessions] Failed to mark Linear issue in-progress:`, e);
          });
        }
      }

      sendJson(res, db.getSession(session.id), 201);
    } catch (e: any) {
      sendJson(res, { error: e.message }, 500);
    }
  });

  api.patch("/api/sessions/:id", async (req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const session = db.getSession(id);
    if (!session) return sendJson(res, { error: "Session not found" }, 404);
    const body = await readBody(req);

    if ("name" in body) {
      if (!body.name || typeof body.name !== "string")
        return sendJson(res, { error: "name is required" }, 400);
      db.renameSession(id, body.name.trim());
    }
    if ("browser_open" in body || "view_mode" in body) {
      const browserOpen = "browser_open" in body ? !!body.browser_open : session.browser_open;
      const viewMode = "view_mode" in body ? (body.view_mode ?? null) : session.view_mode;
      db.updateSessionBrowserState(id, browserOpen, viewMode);
    }

    if ("git_branch" in body) {
      const gitBranch: string | null = body.git_branch?.trim() || null;
      db.updateSessionGitBranch(id, gitBranch);
    }

    if ("source_url" in body) {
      const sourceUrl: string | null = body.source_url?.trim() || null;
      const sourceType = sourceUrl ? detectSourceType(sourceUrl) : null;
      db.updateSessionSource(id, sourceUrl, sourceType);
    }

    if ("remove_mr_url" in body && typeof body.remove_mr_url === "string") {
      monitors.dismissMrUrl(id, body.remove_mr_url);
    }

    if ("add_mr_url" in body && typeof body.add_mr_url === "string") {
      const url = body.add_mr_url.trim();
      if (url && extractMrUrls(url).length > 0) {
        monitors.addMrUrl(id, url);
      } else if (url) {
        // Accept any URL even if it doesn't match known MR patterns
        monitors.addMrUrl(id, url);
      }
    }

    sendJson(res, db.getSession(id));
  });

  api.post("/api/sessions/:id/prepare-commit-push", async (_req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const session = db.getSession(id);
    if (!session) return sendJson(res, { error: "Session not found" }, 404);

    const project = db.getProject(session.project_id);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    const resolvedName = await autoRename.resolveSessionWorkName(
      session.id,
      session.tmux_name,
      session.name,
      session.source_url,
    );

    const branchName = session.git_branch || toFeatureBranchName(resolvedName);

    if (branchName) {
      db.updateSessionGitBranch(session.id, branchName);
    }

    sendJson(res, {
      session: db.getSession(session.id),
      branchName,
      createdBranch: false,
      prepared: !!branchName,
    });
  });

  api.delete("/api/sessions/:id", (req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const permanent = (req.url ?? "").includes("permanent=1");
    monitors.stopSessionMonitors(id);
    const session = db.getSession(id);
    if (session) {
      terminal.destroyTmuxSession(session.tmux_name);
      if (permanent || session.status === "archived") {
        db.removeSession(id);
      } else {
        db.archiveSession(id);
      }
    }
    sendJson(res, { ok: true });
  });

  // ── Close session: merge PRs + mark issue done + archive ────────

  api.post("/api/sessions/:id/close", async (req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const session = db.getSession(id);
    if (!session) return sendJson(res, { error: "Session not found" }, 404);

    const results: {
      mergeResults: mrMerge.MergeResult[];
      linearResult: { identifier: string; newState: string | null } | null;
      archived: boolean;
    } = {
      mergeResults: [],
      linearResult: null,
      archived: false,
    };

    // 1. Merge all open MR/PR URLs
    if (session.mr_urls.length > 0) {
      // Only merge MRs that are still open
      const openUrls = session.mr_urls.filter((url) => {
        const status = session.mr_statuses[url];
        return !status || (status.state !== "merged" && status.state !== "closed");
      });
      if (openUrls.length > 0) {
        results.mergeResults = await mrMerge.mergeMrs(openUrls);
      }
    }

    // 2. Mark Linear issue as Done (if source is Linear)
    if (session.source_type === "linear" && session.source_url) {
      const identifier = linear.parseLinearIssueId(session.source_url);
      if (identifier) {
        const newState = await linear.markIssueDone(identifier);
        results.linearResult = { identifier, newState };
      }
    }

    // 3. Archive the session (stop monitors, kill tmux)
    monitors.stopSessionMonitors(id);
    terminal.destroyTmuxSession(session.tmux_name);
    db.archiveSession(id);
    results.archived = true;

    // 4. Refresh GitButler cache
    const project = db.getProject(session.project_id);
    if (project) {
      cache.triggerRefresh(project.id, true);
    }

    sendJson(res, results);
  });

  // ── Fetch Linear issue details for a URL ───────────────────────

  api.post("/api/linear/issue", async (req, res) => {
    const body = await readBody(req);
    const url = body.url?.trim();
    if (!url) return sendJson(res, { error: "URL is required" }, 400);

    const issue = await linear.fetchIssueFromUrl(url);
    if (!issue) return sendJson(res, { error: "Could not fetch issue (token not set or invalid URL)" }, 404);

    sendJson(res, {
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      url: issue.url,
      state: issue.state.name,
    });
  });

  api.post("/api/sessions/:id/revive", async (req, res, { id: idStr }) => {
    const id = parseInt(idStr);
    const session = db.getSession(id);
    if (!session) return sendJson(res, { error: "Session not found" }, 404);

    const isOrphaned = monitors.isOrphaned(id);
    const isArchived = session.status === "archived";
    if (!isOrphaned && !isArchived)
      return sendJson(res, { error: "Session is already active" }, 400);

    const project = db.getProject(session.project_id);
    if (!project) return sendJson(res, { error: "Project not found" }, 404);

    const newTmuxName = `devbench_${session.project_id}_${Date.now()}`;
    try {
      const result = await terminal.reviveTmuxSession(
        newTmuxName, project.path, session.type, session.agent_session_id
      );

      db.updateSessionTmuxName(id, newTmuxName);
      if (isArchived) db.unarchiveSession(id);
      if (result.agentSessionId && result.agentSessionId !== session.agent_session_id) {
        db.updateSessionAgentId(id, result.agentSessionId);
      }
      monitors.clearOrphaned(id);
      monitors.startSessionMonitors(id, newTmuxName, session.name, session.type, session.mr_urls);

      console.log(`[revive] Session ${id} revived with tmux ${newTmuxName}`);
      sendJson(res, db.getSession(id));
    } catch (e: any) {
      sendJson(res, { error: e.message }, 500);
    }
  });
}
