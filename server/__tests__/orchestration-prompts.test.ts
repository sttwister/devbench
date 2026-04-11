// @lat: [[tests#Orchestration#Prompt Builders]]
import { describe, it, expect, vi } from "vitest";

// Mock side-effect-heavy dependencies before importing
vi.mock("../db.ts", () => ({}));
vi.mock("../terminal.ts", () => ({}));
vi.mock("../monitor-manager.ts", () => ({}));
vi.mock("../agent-status.ts", () => ({}));
vi.mock("../events.ts", () => ({ broadcast: vi.fn() }));
vi.mock("../linear.ts", () => ({}));
vi.mock("../tmux-utils.ts", () => ({ capturePane: vi.fn() }));

import {
  buildImplementPrompt,
  buildReviewPrompt,
  buildTestPrompt,
  buildCommitPrompt,
} from "../orchestration.ts";
import type { OrchestrationJob } from "@devbench/shared";

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
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as OrchestrationJob;
}

describe("buildImplementPrompt", () => {
  it("includes the task description", () => {
    const prompt = buildImplementPrompt("Add a login page");
    expect(prompt).toContain("Add a login page");
  });

  it("forbids commit and push", () => {
    const prompt = buildImplementPrompt("some task");
    expect(prompt).toContain("Do NOT commit or push");
  });

  it("includes implementation instructions", () => {
    const prompt = buildImplementPrompt("some task");
    expect(prompt).toContain("Implement the feature/fix");
    expect(prompt).toContain("Follow existing code patterns");
  });
});

describe("buildReviewPrompt", () => {
  it("includes the original prompt in delimiters", () => {
    const prompt = buildReviewPrompt("Add a login page");
    expect(prompt).toContain("---\nAdd a login page\n---");
  });

  it("forbids commit and push", () => {
    const prompt = buildReviewPrompt("some task");
    expect(prompt).toContain("Do NOT commit or push");
  });

  it("includes review criteria", () => {
    const prompt = buildReviewPrompt("some task");
    expect(prompt).toContain("Correctness");
    expect(prompt).toContain("Code quality");
    expect(prompt).toContain("Error handling");
    expect(prompt).toContain("Security");
    expect(prompt).toContain("Performance");
  });

  it("forbids unnecessary style changes", () => {
    const prompt = buildReviewPrompt("some task");
    expect(prompt).toContain("Do NOT make unnecessary style-only changes");
  });
});

describe("buildTestPrompt", () => {
  it("includes the original prompt in delimiters", () => {
    const prompt = buildTestPrompt("Add a login page");
    expect(prompt).toContain("---\nAdd a login page\n---");
  });

  it("forbids commit and push", () => {
    const prompt = buildTestPrompt("some task");
    expect(prompt).toContain("Do NOT commit or push");
  });

  it("includes testing instructions", () => {
    const prompt = buildTestPrompt("some task");
    expect(prompt).toContain("Run the existing test suite");
    expect(prompt).toContain("Write additional tests");
  });
});

describe("buildCommitPrompt", () => {
  it("starts with /git-commit-and-push skill invocation", () => {
    const prompt = buildCommitPrompt(fakeJob());
    expect(prompt.startsWith("/git-commit-and-push")).toBe(true);
  });

  it("generates a kebab-case branch name from the title", () => {
    const prompt = buildCommitPrompt(fakeJob({ title: "Add Login Page" }));
    expect(prompt).toContain("feature/add-login-page");
  });

  it("strips special characters from branch name", () => {
    const prompt = buildCommitPrompt(fakeJob({ title: "Fix: user auth (v2)" }));
    expect(prompt).toContain("feature/fix-user-auth-v2");
  });

  it("strips leading/trailing hyphens from branch name", () => {
    const prompt = buildCommitPrompt(fakeJob({ title: "---Hello World---" }));
    expect(prompt).toContain("feature/hello-world");
    // Should not have double dashes at edges
    expect(prompt).not.toContain("feature/-");
    expect(prompt).not.toContain("-\n");
  });

  it("includes the job title as commit message", () => {
    const job = fakeJob({ title: "Add login page" });
    const prompt = buildCommitPrompt(job);
    expect(prompt).toContain("Commit message: Add login page");
  });
});
