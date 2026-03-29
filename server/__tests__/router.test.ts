import { describe, it, expect, vi } from "vitest";
import { Router } from "../router.ts";

/** Create a minimal mock request. */
function mockReq(method: string, url: string) {
  return { method, url } as any;
}

/** Create a minimal mock response that captures output. */
function mockRes() {
  let _status = 0;
  let _headers = {};
  let _body = "";
  return {
    writeHead(status: number, headers: object) { _status = status; _headers = headers; },
    end(body: string) { _body = body; },
    _status: () => _status,
    _headers: () => _headers,
    _body: () => _body,
  } as any;
}

describe("Router", () => {
  it("matches a simple GET route", () => {
    const router = new Router();
    const handler = vi.fn();
    router.get("/api/projects", handler);

    const req = mockReq("GET", "/api/projects");
    const res = mockRes();
    const matched = router.handle(req, res);

    expect(matched).toBe(true);
    expect(handler).toHaveBeenCalledWith(req, res, {});
  });

  it("matches POST route", () => {
    const router = new Router();
    const handler = vi.fn();
    router.post("/api/projects", handler);

    expect(router.handle(mockReq("POST", "/api/projects"), mockRes())).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("matches PUT route", () => {
    const router = new Router();
    const handler = vi.fn();
    router.put("/api/data", handler);

    expect(router.handle(mockReq("PUT", "/api/data"), mockRes())).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("matches PATCH route", () => {
    const router = new Router();
    const handler = vi.fn();
    router.patch("/api/data", handler);

    expect(router.handle(mockReq("PATCH", "/api/data"), mockRes())).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("matches DELETE route", () => {
    const router = new Router();
    const handler = vi.fn();
    router.delete("/api/sessions/:id", handler);

    expect(router.handle(mockReq("DELETE", "/api/sessions/42"), mockRes())).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("extracts single path parameter", () => {
    const router = new Router();
    const handler = vi.fn();
    router.get("/api/projects/:id", handler);

    router.handle(mockReq("GET", "/api/projects/99"), mockRes());
    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { id: "99" }
    );
  });

  it("extracts multiple path parameters", () => {
    const router = new Router();
    const handler = vi.fn();
    router.get("/api/projects/:projectId/sessions/:sessionId", handler);

    router.handle(
      mockReq("GET", "/api/projects/5/sessions/10"),
      mockRes()
    );
    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { projectId: "5", sessionId: "10" }
    );
  });

  it("returns false when no route matches", () => {
    const router = new Router();
    router.get("/api/projects", vi.fn());

    expect(router.handle(mockReq("GET", "/api/sessions"), mockRes())).toBe(false);
  });

  it("returns false when method does not match", () => {
    const router = new Router();
    router.get("/api/projects", vi.fn());

    expect(router.handle(mockReq("POST", "/api/projects"), mockRes())).toBe(false);
  });

  it("strips query string before matching", () => {
    const router = new Router();
    const handler = vi.fn();
    router.get("/api/sessions/:id", handler);

    const matched = router.handle(
      mockReq("GET", "/api/sessions/5?permanent=1"),
      mockRes()
    );
    expect(matched).toBe(true);
    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { id: "5" }
    );
  });

  it("first matching route wins", () => {
    const router = new Router();
    const first = vi.fn();
    const second = vi.fn();
    router.get("/api/test", first);
    router.get("/api/test", second);

    router.handle(mockReq("GET", "/api/test"), mockRes());
    expect(first).toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("does not match partial paths", () => {
    const router = new Router();
    router.get("/api/projects", vi.fn());

    // Longer path should not match
    expect(router.handle(mockReq("GET", "/api/projects/extra"), mockRes())).toBe(false);
  });

  it("handles req.url being undefined", () => {
    const router = new Router();
    const handler = vi.fn();
    router.get("/", handler);

    const req = { method: "GET", url: undefined } as any;
    const matched = router.handle(req, mockRes());
    expect(matched).toBe(true);
  });
});
