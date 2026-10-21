/**
 * Removes Docker Compose stacks that agent sessions started and left behind.
 *
 * Ownership: Claude Code gives every session a scratchpad under
 * /tmp/claude-<uid>/<project-slug>/<session-uuid>/. A compose stack whose
 * working dir and config files all live there was started by that session.
 * When the owning DevBench session is archived (closed, deleted, or its tmux
 * died) the stack goes with it: containers, anonymous and named volumes, and
 * the project's networks. Stacks we can't attribute to a session are left
 * alone, and so is any project that mixes owned and unowned containers
 * (e.g. a scratchpad clone that reused the main dev stack's project name).
 *
 * Containers, networks and volumes created outside compose are attributed
 * by the devbench.session label that scripts/bin/docker (first on PATH in
 * agent sessions) adds, and removed once that session is archived or deleted.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as db from "./db.ts";
import { logger } from "./logger.ts";
import type { Session } from "@devbench/shared";

const run = promisify(execFile);

const PROJECT_LABEL = "com.docker.compose.project";
const SESSION_LABEL = "devbench.session";
const LABELLED_KINDS = ["container", "network", "volume"] as const;
const SCRATCHPAD_RE = /\/claude-\d+\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/|$)/;

export interface LabelledResource {
  kind: (typeof LABELLED_KINDS)[number];
  id: string;
  /** DevBench session ID from the devbench.session label. */
  session: string;
}

export interface ComposeStack {
  project: string;
  /** Working dirs and config files of every container in the project. */
  paths: string[];
}

// ── Pure helpers ────────────────────────────────────────────────────

/** Claude session UUID whose scratchpad holds this path, or null. */
export function scratchpadOwner(path: string): string | null {
  return SCRATCHPAD_RE.exec(path)?.[1] ?? null;
}

/** The single session that owns every path of the stack, or null. */
export function stackOwner(stack: ComposeStack): string | null {
  const owners = new Set(stack.paths.map(scratchpadOwner));
  if (owners.size !== 1) return null;
  return [...owners][0];
}

/**
 * Parse `docker ps -a` output formatted as
 * `<project>\t<working_dir>\t<config_files>` into one stack per project.
 */
export function parseComposeStacks(output: string): ComposeStack[] {
  const byProject = new Map<string, string[]>();
  for (const line of output.split("\n")) {
    const [project, workingDir = "", configFiles = ""] = line.split("\t");
    if (!project) continue;
    const paths = byProject.get(project) ?? [];
    if (workingDir) paths.push(workingDir);
    paths.push(...configFiles.split(",").filter(Boolean));
    byProject.set(project, paths);
  }
  return [...byProject].map(([project, paths]) => ({ project, paths }));
}

/** Stacks whose owning DevBench session is archived. */
export function stacksToRemove(
  stacks: ComposeStack[],
  lookup: (agentSessionId: string) => Session | null
): ComposeStack[] {
  return stacks.filter((stack) => {
    const owner = stackOwner(stack);
    return owner !== null && lookup(owner)?.status === "archived";
  });
}

/** Labelled resources whose DevBench session is archived or deleted. */
export function labelledToRemove(
  resources: LabelledResource[],
  lookup: (sessionId: number) => Session | null
): LabelledResource[] {
  return resources.filter((r) => {
    if (!/^\d+$/.test(r.session)) return false;
    const session = lookup(Number(r.session));
    return session === null || session.status === "archived";
  });
}

// ── Docker ──────────────────────────────────────────────────────────

async function docker(args: string[]): Promise<string> {
  const { stdout } = await run("docker", args, { timeout: 120_000 });
  return stdout.trim();
}

async function listComposeStacks(): Promise<ComposeStack[]> {
  const output = await docker([
    "ps", "-a", "--filter", `label=${PROJECT_LABEL}`, "--format",
    `{{.Label "${PROJECT_LABEL}"}}\t{{.Label "${PROJECT_LABEL}.working_dir"}}\t{{.Label "${PROJECT_LABEL}.config_files"}}`,
  ]);
  return parseComposeStacks(output);
}

async function removeStack(project: string): Promise<void> {
  const filter = `label=${PROJECT_LABEL}=${project}`;
  const containers = (await docker(["ps", "-aq", "--filter", filter])).split("\n").filter(Boolean);
  if (containers.length) await docker(["rm", "-fv", ...containers]);

  // Networks and volumes can still be in use by another project that joined
  // them; leave those for a later sweep rather than failing the removal.
  for (const kind of ["network", "volume"]) {
    const ids = (await docker([kind, "ls", "-q", "--filter", filter])).split("\n").filter(Boolean);
    for (const id of ids) {
      await docker([kind, "rm", id]).catch((e: Error) => {
        logger.warn("docker-cleanup", `Kept ${kind} ${id} of ${project}: ${e.message.trim()}`);
      });
    }
  }
  console.log(`[docker-cleanup] Removed stack ${project} (${containers.length} containers)`);
  logger.info("docker-cleanup", `Removed stack ${project} (${containers.length} containers)`);
}

async function listLabelled(): Promise<LabelledResource[]> {
  const resources: LabelledResource[] = [];
  for (const kind of LABELLED_KINDS) {
    const id = kind === "volume" ? "{{.Name}}" : "{{.ID}}";
    const ls = kind === "container" ? ["ps", "-a"] : [kind, "ls"];
    const output = await docker([
      ...ls, "--filter", `label=${SESSION_LABEL}`, "--format", `${id}\t{{.Label "${SESSION_LABEL}"}}`,
    ]);
    for (const line of output.split("\n").filter(Boolean)) {
      const [rid, session] = line.split("\t");
      resources.push({ kind, id: rid, session });
    }
  }
  return resources;
}

async function removeLabelled(resources: LabelledResource[]): Promise<void> {
  // LABELLED_KINDS order: containers first, so their networks and volumes are free
  for (const r of resources) {
    const args = r.kind === "container" ? ["rm", "-fv", r.id] : [r.kind, "rm", r.id];
    await docker(args).then(
      () => logger.info("docker-cleanup", `Removed ${r.kind} ${r.id} of session ${r.session}`),
      (e: Error) => logger.warn("docker-cleanup", `Kept ${r.kind} ${r.id} of session ${r.session}: ${e.message.trim()}`)
    );
  }
}

let sweeping: Promise<void> | null = null;

const deletedAgentSessionIds = new Set<string>();

/**
 * Remove every compose stack and labelled resource owned by an archived
 * session. Safe to call
 * often: concurrent calls share one sweep, and Docker being unavailable
 * is logged and ignored.
 *
 * Pass the agent session ID of a session whose row is being deleted
 * outright, so its stacks are still recognised once the row is gone.
 */
export function sweepDockerStacks(deletedAgentSessionId?: string | null): Promise<void> {
  if (deletedAgentSessionId) deletedAgentSessionIds.add(deletedAgentSessionId);
  sweeping ??= (async () => {
    try {
      const lookup = (id: string): Session | null =>
        deletedAgentSessionIds.has(id) ? ({ status: "archived" } as Session) : db.getSessionByAgentSessionId(id);
      const stacks = stacksToRemove(await listComposeStacks(), lookup);
      for (const stack of stacks) await removeStack(stack.project);
      await removeLabelled(labelledToRemove(await listLabelled(), db.getSession));
    } catch (e) {
      logger.warn("docker-cleanup", `Sweep failed: ${(e as Error).message}`);
    } finally {
      sweeping = null;
    }
  })();
  return sweeping;
}
