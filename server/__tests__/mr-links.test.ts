// @lat: [[tests#Monitoring#MR Link Extraction]]
import { describe, it, expect } from "vitest";
import { extractMrUrls } from "../mr-links.ts";

describe("extractMrUrls", () => {
  it("returns empty array for empty content", () => {
    expect(extractMrUrls("")).toEqual([]);
  });

  it("returns empty array when no URLs present", () => {
    expect(extractMrUrls("just some terminal output\n$ ls -la\nfoo bar")).toEqual([]);
  });

  // ── GitLab ──────────────────────────────────────────────────────

  it("extracts GitLab numbered MR URLs", () => {
    const content = "remote: https://gitlab.com/group/project/-/merge_requests/123\n";
    expect(extractMrUrls(content)).toEqual([
      "https://gitlab.com/group/project/-/merge_requests/123",
    ]);
  });

  it("ignores GitLab MR creation links", () => {
    const content =
      "remote: https://gitlab.com/group/project/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat\n";
    expect(extractMrUrls(content)).toEqual([]);
  });

  // ── GitHub ──────────────────────────────────────────────────────

  it("extracts GitHub numbered PR URLs", () => {
    const content = "remote: https://github.com/owner/repo/pull/456\n";
    expect(extractMrUrls(content)).toEqual([
      "https://github.com/owner/repo/pull/456",
    ]);
  });

  it("ignores GitHub PR creation links", () => {
    const content =
      "remote: https://github.com/owner/repo/pull/new/feature-branch\n";
    expect(extractMrUrls(content)).toEqual([]);
  });

  // ── Bitbucket ───────────────────────────────────────────────────



  // ── Deduplication ───────────────────────────────────────────────

  it("deduplicates identical URLs", () => {
    const url = "https://github.com/owner/repo/pull/10";
    const content = `${url}\n${url}\n${url}\n`;
    expect(extractMrUrls(content)).toEqual([url]);
  });

  // ── Ordering ────────────────────────────────────────────────────

  it("returns only numbered links, ignoring creation links", () => {
    const content = [
      "https://gitlab.com/g/p/-/merge_requests/new?src=feat",
      "https://gitlab.com/g/p/-/merge_requests/42",
    ].join("\n");
    const result = extractMrUrls(content);
    expect(result).toEqual(["https://gitlab.com/g/p/-/merge_requests/42"]);
  });

  // ── Prefix filtering ───────────────────────────────────────────

  it("filters out URLs that are prefixes of longer matches (tmux line-wrap)", () => {
    const content = [
      "https://github.com/owner/repo/pull/123",
      "https://github.com/owner/repo/pull/1234",
    ].join("\n");
    const result = extractMrUrls(content);
    // /pull/123 is a prefix of /pull/1234, so only the longer one should remain
    expect(result).toEqual(["https://github.com/owner/repo/pull/1234"]);
  });

  // ── Multiple providers ──────────────────────────────────────────

  it("extracts URLs from multiple providers", () => {
    const content = [
      "https://gitlab.com/g/p/-/merge_requests/1",
      "https://github.com/o/r/pull/2",
    ].join("\n");
    expect(extractMrUrls(content)).toHaveLength(2);
  });

  // ── URL boundary handling ───────────────────────────────────────

  it("does not include trailing punctuation or quotes", () => {
    const content = `See "https://github.com/owner/repo/pull/55" for details.`;
    const result = extractMrUrls(content);
    expect(result).toEqual(["https://github.com/owner/repo/pull/55"]);
  });

  it("does not include trailing parentheses", () => {
    const content = `(https://github.com/owner/repo/pull/66)`;
    const result = extractMrUrls(content);
    expect(result).toEqual(["https://github.com/owner/repo/pull/66"]);
  });

  // ── GitButler JSON fallback ─────────────────────────────

  it("reconstructs a GitHub PR URL from `but pr new --json` output", () => {
    // Abridged `but pr new --json` output — `number` and `repositoryHttpsUrl`
    // are separate fields and no literal /pull/N string exists anywhere.
    const content = JSON.stringify({
      reviews: [
        {
          number: 115,
          title: "fix(hooks): something",
          sourceBranch: "feature/foo",
          targetBranch: "master",
          repositorySshUrl: "git@github.com:sttwister/devbench.git",
          repositoryHttpsUrl: "https://github.com/sttwister/devbench.git",
        },
      ],
    });
    expect(extractMrUrls(content)).toEqual([
      "https://github.com/sttwister/devbench/pull/115",
    ]);
  });

  it("reconstructs a GitLab MR URL from `but pr new --json` output", () => {
    const content = JSON.stringify({
      reviews: [
        {
          number: 42,
          repositoryHttpsUrl: "https://gitlab.com/group/project.git",
        },
      ],
    });
    expect(extractMrUrls(content)).toEqual([
      "https://gitlab.com/group/project/-/merge_requests/42",
    ]);
  });

  it("reconstructs the URL when `number` appears before `repositoryHttpsUrl`", () => {
    // `but branch show --review --json` emits number first, then URL.
    const content =
      '{"reviews":[{"number":7,"title":"x","repositoryHttpsUrl":"https://github.com/o/r.git"}]}';
    expect(extractMrUrls(content)).toEqual(["https://github.com/o/r/pull/7"]);
  });

  it("handles the URL form even with an intervening multi-KB body field", () => {
    // Real `but pr new --json` output has a `body` field between `number` and
    // `repositoryHttpsUrl` that can be several KB long. The extractor must
    // still pair them up.
    const body = "lorem ipsum ".repeat(500); // ~6 KB of filler
    const content = `{"reviews":[{"number":99,"body":"${body}","repositoryHttpsUrl":"https://github.com/o/r.git"}]}`;
    expect(extractMrUrls(content)).toContain("https://github.com/o/r/pull/99");
  });

  it("ignores sibling `number` fields when `repositoryHttpsUrl` is missing", () => {
    // A plain JSON object with a `number` field but no repo URL must not
    // emit a bogus URL.
    const content = '{"line_number":5,"number":42,"foo":"bar"}';
    expect(extractMrUrls(content)).toEqual([]);
  });

  it("skips unknown forges rather than constructing a wrong-shape URL", () => {
    const content =
      '{"number":1,"repositoryHttpsUrl":"https://bitbucket.org/team/repo.git"}';
    expect(extractMrUrls(content)).toEqual([]);
  });

  it("detects self-hosted GitLab by the `gitlab` substring in the host", () => {
    const content =
      '{"number":3,"repositoryHttpsUrl":"https://gitlab.example.com/team/repo.git"}';
    expect(extractMrUrls(content)).toEqual([
      "https://gitlab.example.com/team/repo/-/merge_requests/3",
    ]);
  });

  it("deduplicates JSON-reconstructed URL against a direct match", () => {
    // If both forms appear in the same text, the Set-based add() must keep
    // exactly one copy.
    const content = `
      https://github.com/o/r/pull/5
      {"number":5,"repositoryHttpsUrl":"https://github.com/o/r.git"}
    `;
    expect(extractMrUrls(content)).toEqual(["https://github.com/o/r/pull/5"]);
  });

  it("strips a trailing .git from the repository URL", () => {
    const content =
      '{"number":9,"repositoryHttpsUrl":"https://github.com/o/r.git"}';
    expect(extractMrUrls(content)).toEqual(["https://github.com/o/r/pull/9"]);
  });

  it("handles a repository URL without a .git suffix", () => {
    const content =
      '{"number":9,"repositoryHttpsUrl":"https://github.com/o/r"}';
    expect(extractMrUrls(content)).toEqual(["https://github.com/o/r/pull/9"]);
  });
});
