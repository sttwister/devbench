import { execSync } from "child_process";
import { tmuxSessionExists } from "./terminal.ts";

const POLL_INTERVAL = 10_000; // Check every 10s
const activeMonitors = new Map<number, NodeJS.Timeout>();

function capturePane(tmuxName: string): string {
  try {
    return execSync(`tmux capture-pane -p -S -500 -t ${tmuxName}`, {
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch {
    return "";
  }
}

/**
 * Extract the best MR/PR URL from terminal content.
 * Prefers numbered links (existing MR/PR) over creation links.
 * When multiple matches exist, returns the last one found (most recent).
 */
export function extractMrUrl(content: string): string | null {
  // Numbered MR/PR links (higher priority)
  const numbered = [
    // GitLab MR: any host with /-/merge_requests/NUMBER
    /https?:\/\/[^\s"'<>)]+\/-\/merge_requests\/\d+/g,
    // GitHub / GH Enterprise PR: /org/repo/pull/NUMBER
    /https?:\/\/[^\s"'<>)]+\/pull\/\d+/g,
    // Bitbucket PR: /org/repo/pull-requests/NUMBER
    /https?:\/\/[^\s"'<>)]+\/pull-requests\/\d+/g,
  ];

  for (const pattern of numbered) {
    const matches = [...content.matchAll(pattern)];
    if (matches.length > 0) {
      return matches[matches.length - 1][0];
    }
  }

  // Creation links (fallback — MR/PR not yet created)
  const creation = [
    // GitLab MR creation link (from git push output)
    /https?:\/\/[^\s"'<>)]+\/-\/merge_requests\/new[^\s"'<>)]*/g,
    // GitHub PR creation link (from git push output)
    /https?:\/\/[^\s"'<>)]+\/pull\/new\/[^\s"'<>)]*/g,
  ];

  for (const pattern of creation) {
    const matches = [...content.matchAll(pattern)];
    if (matches.length > 0) {
      return matches[matches.length - 1][0];
    }
  }

  return null;
}

/**
 * Start monitoring a session's terminal output for MR/PR links.
 * @param currentUrl - the URL already stored in DB (avoids redundant broadcast on restart)
 */
export function startMonitoring(
  sessionId: number,
  tmuxName: string,
  currentUrl: string | null,
  onLinkFound: (sessionId: number, url: string) => void
): void {
  if (activeMonitors.has(sessionId)) return;

  let lastUrl: string | null = currentUrl;

  const timer = setInterval(() => {
    if (!tmuxSessionExists(tmuxName)) {
      stopMonitoring(sessionId);
      return;
    }

    const content = capturePane(tmuxName);
    if (!content) return;

    const url = extractMrUrl(content);
    if (url && url !== lastUrl) {
      lastUrl = url;
      console.log(`[mr-links] Session ${sessionId}: found ${url}`);
      onLinkFound(sessionId, url);
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
