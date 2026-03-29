import { describe, it, expect } from "vitest";
import { getMrLabel } from "../mr-labels.ts";

describe("getMrLabel", () => {
  it("returns !<id> for GitLab MR URLs", () => {
    expect(getMrLabel("https://gitlab.com/group/project/-/merge_requests/123")).toBe("!123");
  });

  it("returns #<id> for GitHub PR URLs", () => {
    expect(getMrLabel("https://github.com/owner/repo/pull/456")).toBe("#456");
  });

  it("returns #<id> for Bitbucket PR URLs", () => {
    expect(getMrLabel("https://bitbucket.org/workspace/repo/pull-requests/789")).toBe("#789");
  });

  it('returns "MR" for GitLab creation links', () => {
    expect(getMrLabel("https://gitlab.com/group/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat")).toBe("MR");
  });

  it('returns "PR" for GitHub creation links', () => {
    expect(getMrLabel("https://github.com/owner/repo/pull/new/feature-branch")).toBe("PR");
  });

  it('returns "MR" as fallback for unknown URLs', () => {
    expect(getMrLabel("https://example.com/something")).toBe("MR");
  });

  it("handles GitLab self-hosted URLs", () => {
    expect(getMrLabel("https://git.company.com/team/project/-/merge_requests/42")).toBe("!42");
  });

  it("handles GitHub Enterprise URLs", () => {
    expect(getMrLabel("https://github.company.com/org/repo/pull/99")).toBe("#99");
  });
});
