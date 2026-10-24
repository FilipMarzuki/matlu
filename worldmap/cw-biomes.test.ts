/**
 * #1907 — `cw-biomes.ts` pinned equal to `src/world/biomes.ts`'s `tileBiomeIdx`, so `tiles.ts` can
 * use it without `worldmap/` importing from `src/` (as with `rng.ts`, #1895).
 *
 * (A test may import from src/: tests are not part of worldmap's build, see worldmap/tsconfig.json.)
 */

import { describe, it, expect } from 'vitest';
import { tileBiomeIdx as tileBiomeIdxCopy } from './cw-biomes';
import { tileBiomeIdx as tileBiomeIdxSrc } from '../src/world/biomes';

describe('worldmap/cw-biomes: tileBiomeIdx pinned equal to src/world/biomes.ts (#1907)', () => {
  it('scenario 5: given a 21 × 21 × 21 grid of (elev, temp, moist) in 0..1, both copies agree everywhere', () => {
    const steps = Array.from({ length: 21 }, (_, i) => i / 20);
    let compared = 0;
    for (const elev of steps)
      for (const temp of steps)
        for (const moist of steps) {
          compared++;
          expect(tileBiomeIdxCopy(elev, temp, moist), `elev ${elev}, temp ${temp}, moist ${moist}`).toBe(tileBiomeIdxSrc(elev, temp, moist));
        }
    expect(compared).toBe(21 * 21 * 21);
  });
});
