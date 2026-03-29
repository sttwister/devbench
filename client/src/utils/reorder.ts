/**
 * Reorder an array of IDs by moving `fromId` to `toIndex`.
 * Returns a new array. No-op if `fromId` is not found or already at `toIndex`.
 */
export function computeReorder(items: number[], fromId: number, toIndex: number): number[] {
  const fromIndex = items.indexOf(fromId);
  if (fromIndex === -1 || fromIndex === toIndex) return items;
  const result = [...items];
  result.splice(fromIndex, 1);
  const adjustedTo = toIndex > fromIndex ? toIndex - 1 : toIndex;
  result.splice(Math.max(0, Math.min(result.length, adjustedTo)), 0, fromId);
  return result;
}
