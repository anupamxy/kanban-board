/**
 * Pure fractional indexing functions — no DB dependency.
 * Importable by unit tests without a DATABASE_URL.
 */

export const INITIAL_STEP = 65_536;
export const MIN_GAP = 0.5;

/**
 * Position to insert between `beforePosition` and `afterPosition`.
 * Returns null when the gap is too small (caller should rebalance).
 */
export function positionBetween(
  beforePosition: number | null,
  afterPosition: number | null
): number | null {
  if (beforePosition === null && afterPosition === null) {
    return INITIAL_STEP;
  }
  if (beforePosition === null) {
    const pos = (afterPosition as number) / 2;
    return pos < MIN_GAP ? null : pos;
  }
  if (afterPosition === null) {
    return beforePosition + INITIAL_STEP;
  }
  const gap = afterPosition - beforePosition;
  if (gap < MIN_GAP) return null;
  return beforePosition + gap / 2;
}
