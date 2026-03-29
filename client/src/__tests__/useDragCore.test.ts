import { describe, it, expect } from "vitest";
// Test the pure utility function used by drag core
import { computeReorder } from "../utils/reorder";

describe("computeReorder (used by drag core)", () => {
  it("moves item to the beginning", () => {
    expect(computeReorder([1, 2, 3], 3, 0)).toEqual([3, 1, 2]);
  });

  it("moves item to the end", () => {
    expect(computeReorder([1, 2, 3], 1, 3)).toEqual([2, 3, 1]);
  });

  it("no-op when item stays in place", () => {
    expect(computeReorder([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
  });

  it("handles single-element array", () => {
    expect(computeReorder([1], 1, 0)).toEqual([1]);
  });
});
