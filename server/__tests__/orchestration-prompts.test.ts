// @lat: [[tests#Orchestration#Prompt Builders]]
import { describe, it, expect } from "vitest";

import { buildOrchestratorPrompt, buildContinueSessionPrompt } from "../orchestration-prompt.ts";
import type { OrchestrationJob, OrchestrationJobSession, Project, JobEvent, MrStatus } from "@devbench/shared";

function fakeJob(overrides: Partial<OrchestrationJob> = {}): OrchestrationJob {
  return {
    id: 1,
    project_id: 1,
    title: "Add login page",
    description: "Implement a login page with email/password",
    source_url: null,
    status: "todo",
    agent_type: "claude",
    review_agent_type: "claude",
    test_agent_type: "claude",
    max_review_loops: 3,
    max_test_loops: 3,
    current_loop: 0,
    error_message: null,
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function fakeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 1,
    name: "test-project",
    path: "/home/user/project",
    browser_url: null,
    default_view_mode: "desktop",
    active: true,
    linear_project_id: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const WAIT_SCRIPT = "/tmp/devbench-wait-3001.sh";

describe("buildOrchestratorPrompt", () => {
  it("includes the job title and description", () => {
    const prompt = buildOrchestratorPrompt(fakeJob(), fakeProject(), WAIT_SCRIPT);
    expect(prompt).toContain("Add login page");
    expect(prompt).toContain("Implement a login page with email/password");
  });

  it("includes the project path", () => {
    const prompt = buildOrchestratorPrompt(fakeJob(), fakeProject({ path: "/my/project" }), WAIT_SCRIPT);
    expect(prompt).toContain("/my/project");
  });

  it("includes the source URL when present", () => {
    const prompt = buildOrchestratorPrompt(
      fakeJob({ source_url: "https://linear.app/team/issue/F-42" }),
      fakeProject(),
      WAIT_SCRIPT,
    );
    expect(prompt).toContain("https://linear.app/team/issue/F-42");
  });

  it("includes the wait script path", () => {
    const prompt = buildOrchestratorPrompt(fakeJob(), fakeProject(), WAIT_SCRIPT);
    expect(prompt).toContain(WAIT_SCRIPT);
  });

  it("includes API reference for curl commands", () => {
    const prompt = buildOrchestratorPrompt(fakeJob(), fakeProject(), WAIT_SCRIPT);
    expect(prompt).toContain("/api/orch/hooks/job-status");
    expect(prompt).toContain("/api/orch/hooks/launch-child");
    expect(prompt).toContain("/api/orch/hooks/child-status");
    expect(prompt).toContain("/api/orch/hooks/child-output");
    expect(prompt).toContain("/api/orch/hooks/log");
  });

  it("includes workflow instructions", () => {
    const prompt = buildOrchestratorPrompt(fakeJob(), fakeProject(), WAIT_SCRIPT);
    expect(prompt).toContain("Implementation phase");
    expect(prompt).toContain("Code review phase");
    expect(prompt).toContain("Testing phase");
    expect(prompt).toContain("Commit & push phase");
  });

  it("includes loop limits from job configuration", () => {
    const prompt = buildOrchestratorPrompt(
      fakeJob({ max_review_loops: 5, max_test_loops: 2 }),
      fakeProject(),
      WAIT_SCRIPT,
    );
    expect(prompt).toContain("max 5 times");
    expect(prompt).toContain("max 2 times");
  });

  it("instructs not to code directly but allows commit/push", () => {
    const prompt = buildOrchestratorPrompt(fakeJob(), fakeProject(), WAIT_SCRIPT);
    expect(prompt).toContain("Do NOT modify code yourself");
    expect(prompt).toContain("you handle commit & push yourself");
  });

  it("includes environment variable references", () => {
    const prompt = buildOrchestratorPrompt(fakeJob(), fakeProject(), WAIT_SCRIPT);
    expect(prompt).toContain("$DEVBENCH_PORT");
    expect(prompt).toContain("$DEVBENCH_SESSION_ID");
  });

  it("instructs to set waiting_input when stuck", () => {
    const prompt = buildOrchestratorPrompt(fakeJob(), fakeProject(), WAIT_SCRIPT);
    expect(prompt).toContain("waiting_input");
  });

  it("generates a branch name from the job title for commit phase", () => {
    const prompt = buildOrchestratorPrompt(
      fakeJob({ title: "Add Login Page" }),
      fakeProject(),
      WAIT_SCRIPT,
    );
    expect(prompt).toContain("feature/add-login-page");
  });

  it("uses the skill-form commit command for Codex orchestrators", () => {
    const prompt = buildOrchestratorPrompt(
      fakeJob({ agent_type: "codex", title: "Add Login Page" }),
      fakeProject(),
      WAIT_SCRIPT,
    );
    expect(prompt).toContain("$git-commit-and-push use branch name feature/add-login-page");
  });

  it("uses title as fallback when description is null", () => {
    const prompt = buildOrchestratorPrompt(
      fakeJob({ title: "Fix bug", description: null }),
      fakeProject(),
      WAIT_SCRIPT,
    );
    expect(prompt).toContain("Fix bug");
  });
});

// ── Continue session prompt tests ─────────────────────────────────

function fakeSessions(): OrchestrationJobSession[] {
  return [
    { id: 1, job_id: 1, session_id: 10, role: "orchestrator", created_at: new Date().toISOString() },
    { id: 2, job_id: 1, session_id: 11, role: "implement", created_at: new Date().toISOString() },
    { id: 3, job_id: 1, session_id: 12, role: "review", created_at: new Date().toISOString() },
  ];
}

function fakeEvents(): JobEvent[] {
  return [
    { id: 1, job_id: 1, timestamp: "2024-01-01T10:00:00Z", type: "info", message: "Status → working" },
    { id: 2, job_id: 1, timestamp: "2024-01-01T10:01:00Z", type: "phase", message: "Implementation" },
    { id: 3, job_id: 1, timestamp: "2024-01-01T10:01:05Z", type: "session", message: "Launched implement child session #11" },
    { id: 4, job_id: 1, timestamp: "2024-01-01T10:10:00Z", type: "info", message: "Implementation completed successfully" },
    { id: 5, job_id: 1, timestamp: "2024-01-01T10:11:00Z", type: "phase", message: "Code Review" },
    { id: 6, job_id: 1, timestamp: "2024-01-01T10:11:05Z", type: "session", message: "Launched review child session #12" },
    { id: 7, job_id: 1, timestamp: "2024-01-01T10:20:00Z", type: "info", message: "Review passed, no changes needed" },
  ];
}

// @lat: [[tests#Orchestration#Continue Session Prompt]]
describe("buildContinueSessionPrompt", () => {
  it("includes the job title and description", () => {
    const prompt = buildContinueSessionPrompt(
      fakeJob(), fakeProject(), fakeSessions(), fakeEvents(), [], {}
    );
    expect(prompt).toContain("Add login page");
    expect(prompt).toContain("Implement a login page with email/password");
  });

  it("includes project name and path", () => {
    const prompt = buildContinueSessionPrompt(
      fakeJob(), fakeProject({ name: "my-app", path: "/home/user/my-app" }),
      fakeSessions(), fakeEvents(), [], {}
    );
    expect(prompt).toContain("my-app");
    expect(prompt).toContain("/home/user/my-app");
  });

  it("includes source URL when present", () => {
    const prompt = buildContinueSessionPrompt(
      fakeJob({ source_url: "https://linear.app/team/issue/F-42" }),
      fakeProject(), fakeSessions(), fakeEvents(), [], {}
    );
    expect(prompt).toContain("https://linear.app/team/issue/F-42");
  });

  it("includes MR URLs with statuses", () => {
    const mrUrls = ["https://github.com/org/repo/pull/1"];
    const mrStatuses: Record<string, MrStatus> = {
      "https://github.com/org/repo/pull/1": { state: "merged", last_checked: "2024-01-01" },
    };
    const prompt = buildContinueSessionPrompt(
      fakeJob(), fakeProject(), fakeSessions(), fakeEvents(), mrUrls, mrStatuses
    );
    expect(prompt).toContain("https://github.com/org/repo/pull/1");
    expect(prompt).toContain("merged");
  });

  it("lists session roles", () => {
    const prompt = buildContinueSessionPrompt(
      fakeJob(), fakeProject(), fakeSessions(), fakeEvents(), [], {}
    );
    expect(prompt).toContain("orchestrator");
    expect(prompt).toContain("implement");
    expect(prompt).toContain("review");
  });

  it("groups events by phase", () => {
    const prompt = buildContinueSessionPrompt(
      fakeJob(), fakeProject(), fakeSessions(), fakeEvents(), [], {}
    );
    expect(prompt).toContain("### Implementation");
    expect(prompt).toContain("### Code Review");
    expect(prompt).toContain("Implementation completed successfully");
    expect(prompt).toContain("Review passed, no changes needed");
  });

  it("includes error message when present", () => {
    const prompt = buildContinueSessionPrompt(
      fakeJob({ error_message: "Timed out waiting for implementation" }),
      fakeProject(), fakeSessions(), fakeEvents(), [], {}
    );
    expect(prompt).toContain("Timed out waiting for implementation");
  });

  it("includes job status", () => {
    const prompt = buildContinueSessionPrompt(
      fakeJob({ status: "review" }),
      fakeProject(), fakeSessions(), fakeEvents(), [], {}
    );
    expect(prompt).toContain("review");
  });
});
