// @lat: [[tests#Orchestration#Prompt Builders]]
import { describe, it, expect } from "vitest";

import { buildOrchestratorPrompt } from "../orchestration-prompt.ts";
import type { OrchestrationJob, Project } from "@devbench/shared";

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

  it("instructs not to code directly", () => {
    const prompt = buildOrchestratorPrompt(fakeJob(), fakeProject(), WAIT_SCRIPT);
    expect(prompt).toContain("Do NOT modify code yourself");
    expect(prompt).toContain("Do NOT commit or push code yourself");
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

  it("uses title as fallback when description is null", () => {
    const prompt = buildOrchestratorPrompt(
      fakeJob({ title: "Fix bug", description: null }),
      fakeProject(),
      WAIT_SCRIPT,
    );
    expect(prompt).toContain("Fix bug");
  });
});
