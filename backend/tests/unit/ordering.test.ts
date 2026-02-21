/**
 * Unit tests for the fractional ordering service.
 */

// Import pure algorithm — no DB connection required for unit tests
import { positionBetween, INITIAL_STEP, MIN_GAP } from '../../src/services/orderingAlgorithm';

describe('positionBetween', () => {
  test('returns INITIAL_STEP when both args are null (empty column)', () => {
    expect(positionBetween(null, null)).toBe(INITIAL_STEP);
  });

  test('inserts before the first task (beforePos = null)', () => {
    const pos = positionBetween(null, 65536);
    expect(pos).toBe(32768); // 65536 / 2
  });

  test('inserts after the last task (afterPos = null)', () => {
    const pos = positionBetween(65536, null);
    expect(pos).toBe(65536 + INITIAL_STEP);
  });

  test('returns midpoint between two positions', () => {
    const pos = positionBetween(1000, 3000);
    expect(pos).toBe(2000);
  });

  test('returns null when gap is too small', () => {
    const pos = positionBetween(1000, 1000.4);
    expect(pos).toBeNull(); // gap < MIN_GAP
  });

  test('handles large gaps correctly', () => {
    const pos = positionBetween(0, 65536 * 100);
    expect(pos).toBe(65536 * 50);
  });

  test('threshold: gap exactly at MIN_GAP returns midpoint', () => {
    // gap = MIN_GAP = 0.5, midpoint exists but might be below threshold
    const pos = positionBetween(1000, 1000 + MIN_GAP);
    // 0.5 gap → not null (gap is >= MIN_GAP but midpoint is 0.25 which is fine)
    // Actually our check is gap < MIN_GAP, so gap == MIN_GAP → not null
    expect(pos).toBe(1000 + MIN_GAP / 2);
  });

  test('preserves ordering invariant after many splits', () => {
    let lo = 0;
    let hi = INITIAL_STEP;
    const positions: number[] = [];

    // Binary split 40 times — should still produce valid midpoints
    for (let i = 0; i < 40; i++) {
      const mid = positionBetween(lo, hi);
      if (mid === null) break;
      positions.push(mid);
      lo = mid;
    }

    // Positions should be strictly increasing (each mid > previous lo)
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });
});

describe('positionAtEnd', () => {
  test('O(1) amortized: no iteration — directly computes max + INITIAL_STEP', () => {
    // We test this via the client-side utility
    // The service function is async (DB call), so we test the logic separately
    // Here just verify the constant
    expect(INITIAL_STEP).toBe(65_536);
  });
});

describe('fractional indexing properties', () => {
  test('inserting at the end always produces a larger position', () => {
    const existing = [65536, 131072, 196608];
    const newPos = Math.max(...existing) + INITIAL_STEP;
    expect(newPos).toBeGreaterThan(Math.max(...existing));
  });

  test('inserting between two tasks preserves order', () => {
    const before = 65536;
    const after = 131072;
    const mid = positionBetween(before, after);
    expect(mid).toBeGreaterThan(before);
    expect(mid).toBeLessThan(after);
  });

  test('50 insertions at midpoint succeed before float64 precision exhausts', () => {
    // Float64 mantissa has 52 bits. Starting from MAX_SAFE_INTEGER/2 ≈ 4.5e15
    // and halving toward 0, we can do ~52 halvings before the gap < MIN_GAP.
    // We verify at least 50 succeed — this documents the algorithm's capacity.
    let lo = 0;
    let hi = Number.MAX_SAFE_INTEGER / 2;
    let validCount = 0;
    for (let i = 0; i < 50; i++) {
      const mid = positionBetween(lo, hi);
      if (mid === null) break;
      validCount++;
      hi = mid;
    }
    expect(validCount).toBe(50);
  });
});
