// @lat: [[tests#HTTP Layer#Poll Endpoint]]
import { describe, it, expect } from "vitest";
import { createServer } from "../server.ts";

describe("GET /api/poll", () => {
  it("returns agentStatuses and orphanedSessionIds", async () => {
    const server = createServer({ distDir: "/tmp", isProd: false });
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/poll`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("agentStatuses");
      expect(body).toHaveProperty("orphanedSessionIds");
      expect(body).toHaveProperty("notifiedSessionIds");
      expect(typeof body.agentStatuses).toBe("object");
      expect(Array.isArray(body.orphanedSessionIds)).toBe(true);
      expect(Array.isArray(body.notifiedSessionIds)).toBe(true);
    } finally {
      server.close();
    }
  });
});
