import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import { sendJson, readBody } from "../http-utils.ts";

/** Create a mock ServerResponse that captures output. */
function mockRes() {
  let _status = 0;
  let _headers: Record<string, string> = {};
  let _body = "";
  return {
    writeHead(status: number, headers: Record<string, string>) {
      _status = status;
      _headers = headers;
    },
    end(body: string) {
      _body = body;
    },
    get status() { return _status; },
    get headers() { return _headers; },
    get body() { return _body; },
  } as any;
}

/** Create a mock IncomingMessage that emits data then ends. */
function mockReq(body: string) {
  const emitter = new EventEmitter();
  process.nextTick(() => {
    emitter.emit("data", body);
    emitter.emit("end");
  });
  return emitter as any;
}

describe("sendJson", () => {
  it("sends JSON with 200 by default", () => {
    const res = mockRes();
    sendJson(res, { hello: "world" });

    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(res.body)).toEqual({ hello: "world" });
  });

  it("sends with custom status code", () => {
    const res = mockRes();
    sendJson(res, { error: "not found" }, 404);

    expect(res.status).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: "not found" });
  });

  it("handles arrays", () => {
    const res = mockRes();
    sendJson(res, [1, 2, 3]);

    expect(JSON.parse(res.body)).toEqual([1, 2, 3]);
  });

  it("handles null", () => {
    const res = mockRes();
    sendJson(res, null);

    expect(res.body).toBe("null");
  });
});

describe("readBody", () => {
  it("parses valid JSON", async () => {
    const req = mockReq('{"name":"test","value":42}');
    const result = await readBody(req);
    expect(result).toEqual({ name: "test", value: 42 });
  });

  it("parses JSON array", async () => {
    const req = mockReq("[1,2,3]");
    const result = await readBody(req);
    expect(result).toEqual([1, 2, 3]);
  });

  it("rejects invalid JSON", async () => {
    const req = mockReq("not json at all");
    await expect(readBody(req)).rejects.toThrow("Invalid JSON");
  });

  it("rejects empty body", async () => {
    const req = mockReq("");
    await expect(readBody(req)).rejects.toThrow("Invalid JSON");
  });
});
