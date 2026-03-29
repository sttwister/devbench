import { capturePane as capturePaneBase, tmuxSessionExists } from "./tmux-utils.ts";

const POLL_INTERVAL = 10_000; // Check every 10s
const MR_SCROLL_BACK = 500;   // Lines of history to scan for MR links
const activeMonitors = new Map<number, NodeJS.Timeout>();

function capturePane(tmuxName: string): string {
  return capturePaneBase(tmuxName, MR_SCROLL_BACK);
}

/**
 * Extract all unique MR/PR URLs from terminal content.
 * Returns numbered links first, then creation links (deduped).
 */
export function extractMrUrls(content: string): string[] {
  const numbered: string[] = [];
  const creation: string[] = [];
  const seen = new Set<string>();

  // Character class for URL chars — excludes whitespace, quotes, brackets,
  // and common trailing punctuation that isn't part of URLs.
  const U = String.raw`[^\s"'<>),;\]\`]`;

  // Numbered MR/PR links (higher priority)
  const numberedPatterns = [
    new RegExp(String.raw`https?:\/\/${U}+\/-\/merge_requests\/\d+`, "g"),      // GitLab
    new RegExp(String.raw`https?:\/\/${U}+\/pull\/\d+`, "g"),                     // GitHub / GH Enterprise
    new RegExp(String.raw`https?:\/\/${U}+\/pull-requests\/\d+`, "g"),            // Bitbucket
  ];

  for (const pattern of numberedPatterns) {
    for (const m of content.matchAll(pattern)) {
      if (!seen.has(m[0])) {
        seen.add(m[0]);
        numbered.push(m[0]);
      }
    }
  }

  // Creation links (fallback — MR/PR not yet created)
  const creationPatterns = [
    new RegExp(String.raw`https?:\/\/${U}+\/-\/merge_requests\/new${U}*`, "g"),  // GitLab
    new RegExp(String.raw`https?:\/\/${U}+\/pull\/new\/${U}*`, "g"),              // GitHub
  ];

  for (const pattern of creationPatterns) {
    for (const m of content.matchAll(pattern)) {
      if (!seen.has(m[0])) {
        seen.add(m[0]);
        creation.push(m[0]);
      }
    }
  }

  const all = [...numbered, ...creation];

  // Drop URLs that are strict prefixes of a longer match
  // (happens when tmux line-wraps a long URL across two lines).
  return all.filter(
    (url) => !all.some((other) => other !== url && other.startsWith(url))
  );
}

/**
 * Start monitoring a session's terminal output for MR/PR links.
 * Append-only: once a URL is detected it is never removed, even if it
 * scrolls out of the capture window.
 * @param currentUrls - URLs already stored in DB (seed the known set)
 */
export function startMonitoring(
  sessionId: number,
  tmuxName: string,
  currentUrls: string[],
  onLinksChanged: (sessionId: number, urls: string[]) => void
): void {
  if (activeMonitors.has(sessionId)) return;

  const knownUrls = new Set(currentUrls);

  const timer = setInterval(() => {
    if (!tmuxSessionExists(tmuxName)) {
      stopMonitoring(sessionId);
      return;
    }

    const content = capturePane(tmuxName);
    if (!content) return;

    const found = extractMrUrls(content);
    let changed = false;
    for (const url of found) {
      if (!knownUrls.has(url)) {
        // Skip if this URL is a prefix of an already-known longer URL
        const isPrefix = [...knownUrls].some(
          (known) => known !== url && known.startsWith(url)
        );
        if (isPrefix) continue;

        // Evict any previously-stored URL that is a prefix of this one
        for (const known of knownUrls) {
          if (url.startsWith(known) && url !== known) {
            knownUrls.delete(known);
          }
        }

        knownUrls.add(url);
        changed = true;
      }
    }

    if (changed) {
      const urls = [...knownUrls];
      console.log(`[mr-links] Session ${sessionId}: ${urls.length} link(s) — ${urls.join(", ")}`);
      onLinksChanged(sessionId, urls);
    }
  }, POLL_INTERVAL);

  activeMonitors.set(sessionId, timer);
}

export function stopMonitoring(sessionId: number): void {
  const timer = activeMonitors.get(sessionId);
  if (timer) {
    clearInterval(timer);
    activeMonitors.delete(sessionId);
  }
}

