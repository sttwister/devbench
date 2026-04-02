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
});
