// @lat: [[orchestration#Prompt Template]]
/**
 * Builds the initial prompt for an orchestrator agent session.
 *
 * The prompt teaches the agent its role, the job details, the API reference
 * for controlling devbench via curl, the devbench-wait script usage, and
 * the workflow to follow.
 */

import type { OrchestrationJob, OrchestrationJobSession, Project, JobEvent, MrStatus } from "@devbench/shared";
import { buildGitCommitPushCommandInput } from "@devbench/shared";

export function buildOrchestratorPrompt(
  job: OrchestrationJob,
  project: Project,
  waitScriptPath: string,
): string {
  const maxReview = job.max_review_loops;
  const maxTest = job.max_test_loops;
  const description = job.description || job.title;
  const sourceUrl = job.source_url || "(none)";
  const commitBranchName = `feature/${job.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const commitCommand = buildGitCommitPushCommandInput(job.agent_type, {
    branchName: commitBranchName,
  });

  return `# Job Orchestrator

You are managing a single coding job for devbench. Your role is to
coordinate implementation, code review, and testing by launching child
agent sessions and monitoring their progress.

## Your Job

- **Title:** ${job.title}
- **Description:** ${description}
- **Source:** ${sourceUrl}
- **Project path:** ${project.path}

## Environment

- \`$DEVBENCH_PORT\` — devbench server port (already set in your environment)
- \`$DEVBENCH_SESSION_ID\` — your own session ID (already set in your environment)
- The devbench-wait script is at: ${waitScriptPath}

## API Reference

All calls use curl to localhost:$DEVBENCH_PORT.

### Update job status
\`\`\`bash
curl -sX POST http://localhost:$DEVBENCH_PORT/api/orch/hooks/job-status \\
  -H 'Content-Type: application/json' \\
  -d '{"sessionId": '$DEVBENCH_SESSION_ID', "status": "working"}'
\`\`\`

### Launch a child session
\`\`\`bash
curl -sX POST http://localhost:$DEVBENCH_PORT/api/orch/hooks/launch-child \\
  -H 'Content-Type: application/json' \\
  -d '{"sessionId": '$DEVBENCH_SESSION_ID', "role": "implement", "agentType": "claude", "prompt": "Your detailed task prompt here..."}'
\`\`\`
Returns JSON with \`sessionId\` (number) and \`tmuxName\` (string).

### Wait for a child session to finish (BLOCKING — use this!)
\`\`\`bash
${waitScriptPath} <child_session_id>
\`\`\`
Blocks until the child agent finishes. Prints the child's last 100 lines
of terminal output on stdout. Exit code 0 = finished, 1 = timeout (30 min default).

You can pass \`--timeout <seconds>\` to change the timeout.

### Check child status (non-blocking, usually unnecessary)
\`\`\`bash
curl -s "http://localhost:$DEVBENCH_PORT/api/orch/hooks/child-status?session_id=N"
\`\`\`
Returns JSON: \`{"agentStatus": "working"|"waiting"|null, "hasChanges": true|false, "sessionStatus": "active"|"archived"}\`

### Read child terminal output
\`\`\`bash
curl -s "http://localhost:$DEVBENCH_PORT/api/orch/hooks/child-output?session_id=N&lines=100"
\`\`\`
Returns JSON: \`{"output": "terminal content..."}\`

### Log an event (shown in dashboard)
\`\`\`bash
curl -sX POST http://localhost:$DEVBENCH_PORT/api/orch/hooks/log \\
  -H 'Content-Type: application/json' \\
  -d '{"sessionId": '$DEVBENCH_SESSION_ID', "type": "info", "message": "Starting implementation"}'
\`\`\`
Types: "info", "phase", "error", "session", "output"

## Workflow

Follow this workflow for the job:

1. **Set status to working**
   \`\`\`bash
   curl -sX POST http://localhost:$DEVBENCH_PORT/api/orch/hooks/job-status -H 'Content-Type: application/json' -d '{"sessionId": '$DEVBENCH_SESSION_ID', "status": "working"}'
   \`\`\`

2. **Implementation phase:**
   - Log: "Starting implementation phase"
   - Launch an implementation child with the full task description as prompt
   - The prompt MUST tell the child: "Do NOT commit or push your changes"
   - Wait for it to finish using devbench-wait
   - Read the output and evaluate if the implementation looks successful
   - If it clearly failed, you may retry with a modified prompt (max 2 retries)

3. **Code review phase:**
   - Log: "Starting code review phase"
   - Launch a review child asking it to review the recent code changes and fix any issues
   - The review prompt should include the original task description for context
   - The prompt MUST tell the child: "Do NOT commit or push"
   - Wait for it to finish
   - Check child-status \`hasChanges\` — if true, the reviewer made fixes
   - If changes were made, loop back for another review (max ${maxReview} times)

4. **Testing phase:**
   - Log: "Starting testing phase"
   - Launch a test child asking it to run tests, verify the implementation, and fix failures
   - The prompt MUST tell the child: "Do NOT commit or push"
   - Wait for it to finish
   - Check child-status \`hasChanges\` — if true, the tester made fixes
   - If changes were made, loop back for another test (max ${maxTest} times)

5. **Commit & push phase:**
   - Log: "Starting commit & push phase"
   - Do this yourself (not via a child session). Run:
     ${commitCommand}
     Commit message: ${job.title}

6. **Set status to "review"** — the user will approve or reject in the dashboard
   \`\`\`bash
   curl -sX POST http://localhost:$DEVBENCH_PORT/api/orch/hooks/job-status -H 'Content-Type: application/json' -d '{"sessionId": '$DEVBENCH_SESSION_ID', "status": "review"}'
   \`\`\`

## Important Rules

- Do NOT modify code yourself — you are a coordinator, not a coder
- Each child session is its own independent agent with full coding tools
- Tell each child NOT to commit/push
- The ONLY exception: you handle commit & push yourself in step 5, after all phases are done
- If something is unclear or you're stuck, set status to "waiting_input"
  with an error message explaining what you need — the user will reply
  in this terminal
- Log important events so the user can track progress in the dashboard
- Max ${maxReview} review loops, max ${maxTest} test loops
- If a child times out, log the error and set status to "waiting_input"
- Always use the full tool (devbench-wait) to wait for children — never poll in a tight loop

Now begin! Start by setting the job status to "working" and launching the implementation phase.
`;
}

/**
 * Builds a context summary prompt for continuing work on an orchestration job
 * in a new manual session. Includes job metadata, MR/branch info, and a
 * structured summary of the event log (the orchestrator's view of what happened).
 */
export function buildContinueSessionPrompt(
  job: OrchestrationJob,
  project: Project,
  sessions: OrchestrationJobSession[],
  events: JobEvent[],
  mrUrls: string[],
  mrStatuses: Record<string, MrStatus>,
): string {
  const lines: string[] = [];

  lines.push(`# Continuing Orchestration Job: ${job.title}`);
  lines.push("");
  lines.push("This session continues work from an orchestration job. Below is full context about what was done.");
  lines.push("");

  // ── Job metadata
  lines.push("## Job Details");
  lines.push("");
  lines.push(`- **Title:** ${job.title}`);
  lines.push(`- **Status:** ${job.status}`);
  lines.push(`- **Project:** ${project.name} (${project.path})`);
  if (job.source_url) lines.push(`- **Source:** ${job.source_url}`);
  if (job.agent_type) lines.push(`- **Agent type:** ${job.agent_type}`);
  lines.push("");

  // ── Description
  if (job.description) {
    lines.push("## Description");
    lines.push("");
    lines.push(job.description);
    lines.push("");
  }

  // ── Merge requests
  if (mrUrls.length > 0) {
    lines.push("## Merge Requests");
    lines.push("");
    for (const url of mrUrls) {
      const status = mrStatuses[url];
      const stateStr = status?.state ? ` (${status.state})` : "";
      lines.push(`- ${url}${stateStr}`);
    }
    lines.push("");
  }

  // ── Sessions
  if (sessions.length > 0) {
    lines.push("## Sessions Used");
    lines.push("");
    for (const s of sessions) {
      lines.push(`- **${s.role}** session #${s.session_id}`);
    }
    lines.push("");
  }

  // ── Event log summary (grouped by phase)
  if (events.length > 0) {
    lines.push("## What Happened (Orchestrator Event Log)");
    lines.push("");
    lines.push("The following is the complete event log from the orchestrator, showing planning decisions, implementation phases, review results, testing results, and any errors encountered.");
    lines.push("");

    // Group events by phase boundaries
    let currentPhase = "Setup";
    let phaseEvents: { phase: string; entries: { type: string; time: string; message: string }[] }[] = [];
    let currentGroup: { type: string; time: string; message: string }[] = [];

    for (const ev of events) {
      if (ev.type === "phase") {
        // Save current group
        if (currentGroup.length > 0) {
          phaseEvents.push({ phase: currentPhase, entries: currentGroup });
        }
        currentPhase = ev.message;
        currentGroup = [];
      } else {
        const time = new Date(ev.timestamp).toLocaleTimeString();
        currentGroup.push({ type: ev.type, time, message: ev.message });
      }
    }
    // Save last group
    if (currentGroup.length > 0) {
      phaseEvents.push({ phase: currentPhase, entries: currentGroup });
    }

    for (const group of phaseEvents) {
      lines.push(`### ${group.phase}`);
      lines.push("");
      for (const entry of group.entries) {
        const prefix = entry.type === "error" ? "❌" : entry.type === "session" ? "💻" : entry.type === "output" ? "📄" : "ℹ️";
        lines.push(`- ${prefix} ${entry.message}`);
      }
      lines.push("");
    }
  }

  // ── Error info
  if (job.error_message) {
    lines.push("## Last Error");
    lines.push("");
    lines.push(job.error_message);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("Please review the above context. You are continuing work on this feature. Ask me what you should do next, or I will give you instructions.");

  return lines.join("\n");
}
