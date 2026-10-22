/**
 * #1895 — worldmap's copy of the Artificer's seeded randomness.
 *
 * worldmap/ must not import from src/ (it is shared by both games, and the repo may be split
 * later), so `worldmap/rng.ts` is a copy of `seedOf` and `generator` from `src/artificer/rng.ts`.
 * A copy can drift. This test pins the two equal, number for number, so a change to one that
 * isn't made to the other fails here instead of silently moving every map's land.
 *
 * (A test may import from src/: tests are not part of worldmap's build, see worldmap/tsconfig.json.)
 */

import { describe, it, expect } from 'vitest';
import * as copy from './rng';
import * as artificer from '../src/artificer/rng';

const TEXTS = [...Array.from({ length: 200 }, (_, i) => `s${i}`), '', 'w-vega', 'a|world|height'];
const first50 = (next: () => number) => Array.from({ length: 50 }, () => next());

describe('worldmap/rng is the Artificer rng, copied (#1895)', () => {
  it('given seeds s0..s199, "", "w-vega" and "a|world|height", seedOf and the first 50 values of generator are identical in both', () => {
    for (const text of TEXTS) {
      const seed = artificer.seedOf(text);
      expect(copy.seedOf(text), `seedOf(${JSON.stringify(text)})`).toBe(seed);
      expect(first50(copy.generator(seed)), `generator(seedOf(${JSON.stringify(text)}))`).toEqual(first50(artificer.generator(seed)));
    }
  });
});
