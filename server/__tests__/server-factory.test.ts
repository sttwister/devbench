// @lat: [[tests#HTTP Layer#Server Factory]]
import { describe, it, expect } from "vitest";
import { createServer } from "../server.ts";
import http from "http";

describe("createServer", () => {
  it("returns an http.Server instance", () => {
    const server = createServer({ distDir: "/tmp", isProd: false });
    expect(server).toBeInstanceOf(http.Server);
    server.close();
  });

  it("responds to unknown API routes with 404 JSON", async () => {
    const server = createServer({ distDir: "/tmp", isProd: false });
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/nonexistent`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty("error", "Not found");
    } finally {
      server.close();
    }
  });

  it("responds to non-API routes with 404 in dev mode", async () => {
    const server = createServer({ distDir: "/tmp", isProd: false });
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    try {
      const res = await fetch(`http://127.0.0.1:${port}/some-page`);
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
