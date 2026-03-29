import { describe, it, expect } from "vitest";
import { computeReorder } from "../utils/reorder.ts";

describe("computeReorder", () => {
  it("moves an item forward", () => {
    // [1, 2, 3, 4] — move item 1 to index 3
    const result = computeReorder([1, 2, 3, 4], 1, 3);
    expect(result).toEqual([2, 3, 1, 4]);
  });

  it("moves an item backward", () => {
    // [1, 2, 3, 4] — move item 3 to index 0
    const result = computeReorder([1, 2, 3, 4], 3, 0);
    expect(result).toEqual([3, 1, 2, 4]);
  });

  it("moves item to the beginning", () => {
    const result = computeReorder([1, 2, 3], 3, 0);
    expect(result).toEqual([3, 1, 2]);
  });

  it("moves item to the end", () => {
    const result = computeReorder([1, 2, 3], 1, 3);
    expect(result).toEqual([2, 3, 1]);
  });

  it("returns same array when fromId is not found", () => {
    const items = [1, 2, 3];
    const result = computeReorder(items, 99, 0);
    expect(result).toBe(items); // same reference
  });

  it("returns same array when source equals destination", () => {
    const items = [1, 2, 3];
    const result = computeReorder(items, 2, 1); // item 2 is at index 1
    expect(result).toBe(items); // same reference
  });

  it("handles single-item array", () => {
    const items = [1];
    const result = computeReorder(items, 1, 0);
    expect(result).toBe(items); // already at position
  });

  it("handles two-item swap", () => {
    expect(computeReorder([1, 2], 2, 0)).toEqual([2, 1]);
    expect(computeReorder([1, 2], 1, 2)).toEqual([2, 1]);
  });

  it("clamps toIndex to valid range", () => {
    // toIndex larger than array length should not crash
    const result = computeReorder([1, 2, 3], 1, 100);
    expect(result).toContain(1);
    expect(result).toContain(2);
    expect(result).toContain(3);
    expect(result).toHaveLength(3);
  });
});
