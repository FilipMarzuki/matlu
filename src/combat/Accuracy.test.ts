/**
 * Accuracy — unit tests for the pure spread-calculation functions.
 *
 * `isPartialCover` is excluded from these tests because it calls Phaser's
 * geometry classes which require a running game context. The cover logic is
 * covered by integration tests in the arena scene.
 */

import { describe, it, expect } from 'vitest';
import {
  calcSpread,
  applySpread,
  SPREAD_MIN_RAD,
  SPREAD_RANGE_RAD,
  SPREAD_MOVE_RAD,
  SPREAD_COVER_RAD,
  RANGE_REFERENCE_PX,
} from './AccuracyMath';

// ── calcSpread ────────────────────────────────────────────────────────────────

describe('calcSpread', () => {
  it('returns SPREAD_MIN at point-blank range, standing still, no cover', () => {
    const spread = calcSpread(0, 0, false);
    expect(spread).toBeCloseTo(SPREAD_MIN_RAD, 6);
  });

  it('increases linearly with distance up to RANGE_REFERENCE_PX', () => {
    const half = calcSpread(RANGE_REFERENCE_PX / 2, 0, false);
    const full = calcSpread(RANGE_REFERENCE_PX, 0, false);
    // half-range spread should be midway between min and min+range
    expect(half).toBeCloseTo(SPREAD_MIN_RAD + SPREAD_RANGE_RAD * 0.5, 6);
    expect(full).toBeCloseTo(SPREAD_MIN_RAD + SPREAD_RANGE_RAD, 6);
  });

  it('clamps range factor at 1.0 beyond RANGE_REFERENCE_PX', () => {
    const atRef  = calcSpread(RANGE_REFERENCE_PX,       0, false);
    const beyond = calcSpread(RANGE_REFERENCE_PX * 2,   0, false);
    expect(beyond).toBeCloseTo(atRef, 6);
  });

  it('adds SPREAD_MOVE_RAD when speedFraction is 1', () => {
    const still   = calcSpread(0, 0, false);
    const moving  = calcSpread(0, 1, false);
    expect(moving - still).toBeCloseTo(SPREAD_MOVE_RAD, 6);
  });

  it('clamps speedFraction above 1 to 1', () => {
    const atOne  = calcSpread(0, 1,   false);
    const above  = calcSpread(0, 1.5, false);
    expect(above).toBeCloseTo(atOne, 6);
  });

  it('adds SPREAD_COVER_RAD when inCover is true', () => {
    const open   = calcSpread(0, 0, false);
    const cover  = calcSpread(0, 0, true);
    expect(cover - open).toBeCloseTo(SPREAD_COVER_RAD, 6);
  });

  it('accumulates all three factors independently', () => {
    const spread = calcSpread(RANGE_REFERENCE_PX, 1, true);
    const expected = SPREAD_MIN_RAD + SPREAD_RANGE_RAD + SPREAD_MOVE_RAD + SPREAD_COVER_RAD;
    expect(spread).toBeCloseTo(expected, 6);
  });

  it('is always positive', () => {
    for (const dist of [0, 100, 500, 1000]) {
      for (const spd of [0, 0.5, 1]) {
        expect(calcSpread(dist, spd, false)).toBeGreaterThan(0);
        expect(calcSpread(dist, spd, true)).toBeGreaterThan(0);
      }
    }
  });
});

// ── applySpread ───────────────────────────────────────────────────────────────

describe('applySpread', () => {
  it('returns a value within [base − spread, base + spread]', () => {
    const base   = Math.PI / 4;
    const spread = 0.1;
    for (let i = 0; i < 200; i++) {
      const result = applySpread(base, spread);
      expect(result).toBeGreaterThanOrEqual(base - spread);
      expect(result).toBeLessThanOrEqual(base + spread);
    }
  });

  it('returns the base angle when spread is 0', () => {
    // With zero spread the only valid output is the base angle itself.
    const base = 1.23;
    expect(applySpread(base, 0)).toBe(base);
  });

  it('produces both positive and negative offsets over many samples', () => {
    const base   = 0;
    const spread = 0.5;
    let positives = 0;
    let negatives = 0;
    for (let i = 0; i < 200; i++) {
      const r = applySpread(base, spread);
      if (r > 0) positives++;
      if (r < 0) negatives++;
    }
    // With 200 samples a uniform distribution should produce both sides.
    expect(positives).toBeGreaterThan(0);
    expect(negatives).toBeGreaterThan(0);
  });

  it('works with negative base angles', () => {
    const base   = -Math.PI;
    const spread = 0.2;
    for (let i = 0; i < 50; i++) {
      const result = applySpread(base, spread);
      expect(result).toBeGreaterThanOrEqual(base - spread);
      expect(result).toBeLessThanOrEqual(base + spread);
    }
  });
});
