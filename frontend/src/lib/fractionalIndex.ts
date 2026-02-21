/**
 * Client-side fractional indexing helpers.
 * Mirrors the server-side logic so the client can compute optimistic positions
 * without a round-trip.
 */

export const INITIAL_STEP = 65_536;
export const MIN_GAP = 0.5;

/** Position to insert at the end of a sorted array of tasks */
export function positionAtEnd(positions: number[]): number {
  if (positions.length === 0) return INITIAL_STEP;
  return Math.max(...positions) + INITIAL_STEP;
}

/**
 * Position to insert between two adjacent tasks.
 * Pass `null` for beforePos when inserting at the start of the list.
 * Pass `null` for afterPos when inserting at the end.
 */
export function positionBetween(
  beforePos: number | null,
  afterPos: number | null
): number {
  if (beforePos === null && afterPos === null) return INITIAL_STEP;
  if (beforePos === null) return (afterPos as number) / 2;
  if (afterPos === null) return beforePos + INITIAL_STEP;
  return beforePos + (afterPos - beforePos) / 2;
}

/**
 * Compute positions for drag-and-drop:
 * Given an ordered array of positions and the index where we're inserting,
 * return the new position value.
 */
export function positionForIndex(
  sortedPositions: number[],
  targetIndex: number
): number {
  const before = sortedPositions[targetIndex - 1] ?? null;
  const after = sortedPositions[targetIndex] ?? null;
  return positionBetween(before, after);
}
