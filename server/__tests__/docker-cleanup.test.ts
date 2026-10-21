import { describe, it, expect } from "vitest";
import {
  scratchpadOwner,
  stackOwner,
  parseComposeStacks,
  stacksToRemove,
} from "../docker-cleanup.ts";
import { createDatabase } from "../db.ts";
import type { Session } from "@devbench/shared";

const A = "6a11654c-8e55-4685-8898-dacc7837cc8f";
const B = "57c62a8c-be90-43cb-b4f5-2c4ee1fae64d";
const scratch = (id: string) => `/tmp/claude-1000/-home-u-coding-rebs-agent/${id}/scratchpad`;

describe("scratchpadOwner", () => {
  it("extracts the session UUID from a scratchpad path", () => {
    expect(scratchpadOwner(`${scratch(A)}/crmrebs`)).toBe(A);
    expect(scratchpadOwner(`/tmp/claude-1000/-home-u-x/${A}`)).toBe(A);
  });

  it("returns null outside a Claude scratchpad", () => {
    expect(scratchpadOwner("/home/u/coding/crmrebs")).toBeNull();
    expect(scratchpadOwner(`/home/u/${A}/crmrebs`)).toBeNull();
    expect(scratchpadOwner("/tmp/claude-1000/crmrebs-9403/h2-owner/head-src")).toBeNull();
  });
});

describe("stackOwner", () => {
  it("returns the session when every path is in its scratchpad", () => {
    expect(stackOwner({
      project: "unittestawf",
      paths: [`${scratch(A)}/crmrebs`, `${scratch(A)}/crmrebs/docker-compose.base.yml`, `${scratch(A)}/awf-net.override.yml`],
    })).toBe(A);
  });

  it("returns null when the project mixes owned and unowned containers", () => {
    expect(stackOwner({
      project: "crmrebs",
      paths: ["/home/u/coding/crmrebs", `${scratch(A)}/crmrebs`],
    })).toBeNull();
  });

  it("returns null when two sessions share a project name", () => {
    expect(stackOwner({
      project: "unittest",
      paths: [`${scratch(A)}/crmrebs`, `${scratch(B)}/crmrebs`],
    })).toBeNull();
  });

  it("returns null for a stack with no paths", () => {
    expect(stackOwner({ project: "x", paths: [] })).toBeNull();
  });
});

describe("parseComposeStacks", () => {
  it("groups containers by project and splits config files", () => {
    const output = [
      `unittestawf\t${scratch(A)}/crmrebs\t${scratch(A)}/crmrebs/a.yml,${scratch(A)}/b.yml`,
      `unittestawf\t${scratch(A)}/crmrebs\t${scratch(A)}/crmrebs/a.yml,${scratch(A)}/b.yml`,
      "crmrebs\t/home/u/coding/crmrebs\t/home/u/coding/crmrebs/docker-compose.yml",
      "",
    ].join("\n");
    const stacks = parseComposeStacks(output);
    expect(stacks.map((s) => s.project)).toEqual(["unittestawf", "crmrebs"]);
    expect(new Set(stacks[0].paths)).toEqual(new Set([
      `${scratch(A)}/crmrebs`, `${scratch(A)}/crmrebs/a.yml`, `${scratch(A)}/b.yml`,
    ]));
  });

  it("returns nothing for empty output", () => {
    expect(parseComposeStacks("")).toEqual([]);
  });
});

describe("stacksToRemove", () => {
  const session = (status: string) => ({ status } as Session);
  const stacks = [
    { project: "owned-archived", paths: [`${scratch(A)}/crmrebs`] },
    { project: "owned-active", paths: [`${scratch(B)}/crmrebs`] },
    { project: "dev-stack", paths: ["/home/u/coding/crmrebs"] },
    { project: "unknown-session", paths: [`${scratch("00000000-0000-0000-0000-000000000000")}/x`] },
  ];
  const lookup = (id: string) => ({ [A]: session("archived"), [B]: session("active") })[id] ?? null;

  it("removes only stacks whose owning session is archived", () => {
    expect(stacksToRemove(stacks, lookup).map((s) => s.project)).toEqual(["owned-archived"]);
  });
});

describe("getSessionByAgentSessionId", () => {
  it("prefers an active session over an archived one with the same agent ID", () => {
    const db = createDatabase(":memory:");
    const project = db.addProject("p", "/tmp/p");
    const old = db.addSession(project.id, "old", "claude", "t1");
    const resumed = db.addSession(project.id, "resumed", "claude", "t2");
    db.updateSessionAgentId(old.id, A);
    db.updateSessionAgentId(resumed.id, A);
    db.archiveSession(old.id);

    expect(db.getSessionByAgentSessionId(A)?.id).toBe(resumed.id);
    db.archiveSession(resumed.id);
    expect(db.getSessionByAgentSessionId(A)?.status).toBe("archived");
    expect(db.getSessionByAgentSessionId(B)).toBeNull();
  });
});
