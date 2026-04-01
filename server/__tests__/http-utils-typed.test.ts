// @lat: [[tests#HTTP Layer#HTTP Utilities Typed]]
import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import { readBody } from "../http-utils.ts";

/** Create a mock IncomingMessage that emits data then ends. */
function mockReq(body: string) {
  const emitter = new EventEmitter();
  process.nextTick(() => {
    emitter.emit("data", body);
    emitter.emit("end");
  });
  return emitter as any;
}

describe("readBody return type", () => {
  it("returns Record<string, unknown> for objects", async () => {
    const req = mockReq('{"name":"test","count":5}');
    const result = await readBody(req);
    expect(result.name).toBe("test");
    expect(result.count).toBe(5);
  });

  it("allows accessing unknown keys without error", async () => {
    const req = mockReq('{"name":"test"}');
    const result = await readBody(req);
    // Accessing a key that doesn't exist returns undefined, not an error
    expect(result.nonexistent).toBeUndefined();
  });

  it("supports 'in' operator for field checking", async () => {
    const req = mockReq('{"name":"value"}');
    const result = await readBody(req);
    expect("name" in result).toBe(true);
    expect("missing" in result).toBe(false);
  });

  it("supports nested objects", async () => {
    const req = mockReq('{"outer":{"inner":"deep"}}');
    const result = await readBody(req);
    expect(result.outer).toEqual({ inner: "deep" });
  });
});
