/**
 * Acceptance tests for #1900 — seen cells and heard-of hexes in the save. One test per
 * Given/When/Then, in the issue's order (criteria 1 and 5; criteria 2–6 are the save round-trip,
 * covered in src/artificer-app/controller.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../region1';
import { FULL_WORLD } from '../world';
import { ruleFeatures } from '../features';
import { packCell } from '../../../worldmap/coords';
import { WORLDGEN_VERSION } from '../../../worldmap/version';
import { HEX_WORLD } from './hex-window';
import { noteSeenCells } from './hex-knowledge';

const runWith = (on: boolean): Region1State =>
  createRegion1({ world: { ...FULL_WORLD, features: { ...ruleFeatures(), [HEX_WORLD]: on } } }, undefined, { id: 'w-hexnote' });

describe('noteSeenCells (#1900)', () => {
  it('with hex-world on, sorts Reach cells into seenOut and outside cells into seenWorld, stamping worldGen', () => {
    const s = runWith(true);
    noteSeenCells(s, [{ cx: 3, cy: 4 }, { cx: -2, cy: 5 }, { cx: 50, cy: 40 }, { cx: -2, cy: 5 }]);
    expect(s.seenOut).toEqual([4 * 48 + 3]);
    expect(s.seenWorld).toEqual([packCell({ cx: -2, cy: 5 }), packCell({ cx: 50, cy: 40 })].sort((a, b) => a - b));
    expect(s.worldGen).toBe(WORLDGEN_VERSION);
  });

  it('with hex-world off, leaves the state unchanged', () => {
    const s = runWith(false);
    const before = { ...s };
    noteSeenCells(s, [{ cx: 3, cy: 4 }, { cx: -2, cy: 5 }]);
    expect(s).toEqual(before);
    expect(s.seenOut).toBeUndefined();
    expect(s.seenWorld).toBeUndefined();
    expect(s.worldGen).toBeUndefined();
  });
});
