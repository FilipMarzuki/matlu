/**
 * Acceptance tests for #1279 — seeded random streams (fortune fixed in time)
 * and the flat-world test config. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { streamFor, fortuneAt, seedOf } from './rng';
import { talentOffer, hiddenTalent, pickRandomFromOffer } from './talents';
import { FULL_WORLD, FLAT_WORLD } from './world';
import { createRegion1, runAction } from './region1';
import { deserialize, serialize, newGame } from '../artificer-app/controller';

const take = (g: () => number, n: number) => Array.from({ length: n }, g);

describe('Seeded randomness (#1279)', () => {
  // 1. A stream is fixed by seed, day and salt.
  it('gives the same stream for the same seed, day and salt', () => {
    const seed = seedOf('w-vega');
    const a = take(streamFor(seed, 4, 'weather'), 5);
    expect(take(streamFor(seed, 4, 'weather'), 5)).toEqual(a);
    expect(take(streamFor(seed, 5, 'weather'), 5)).not.toEqual(a);
    expect(take(streamFor(seed, 4, 'other'), 5)).not.toEqual(a);
    expect(take(streamFor(seedOf('w-ash'), 4, 'weather'), 5)).not.toEqual(a);
    for (const x of take(streamFor(seed, 1, 'range'), 1000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  // 2. Moving the generator changed nothing for talents (values recorded before the move).
  it('keeps talent offers and hidden talents exactly as before', () => {
    const offer = talentOffer(seedOf('w-vega'));
    expect(seedOf('w-vega')).toBe(1484636892);
    expect(offer).toEqual(['coldBlooded', 'sharp', 'keenEye', 'hunter']);
    expect(hiddenTalent(seedOf('w-vega'), offer.slice(0, 2))).toBe('quickLearner');
    expect(pickRandomFromOffer(offer, 7)).toEqual(['keenEye', 'sharp']);
    expect(talentOffer(seedOf('ai-scripted-s1-r1'))).toEqual(['silverTongue', 'coldBlooded', 'sharp', 'waterfinder']);
  });

  // 3. Fortune is fixed in time: a pure function of seed, day and hour — never of what you did.
  it('fixes each hour’s fortune, whatever you do before it', () => {
    const seed = seedOf('w-vega');
    const f = fortuneAt(seed, 4, 10);
    expect(fortuneAt(seed, 4, 10)).toBe(f);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThan(1);
    // Different hours and days have their own fortune.
    const week = Array.from({ length: 7 }, (_, d) => Array.from({ length: 14 }, (_, h) => fortuneAt(seed, d + 1, 6 + h))).flat();
    expect(new Set(week).size).toBe(week.length);
    // Playing actions (or not) doesn't move it: there is no counter to advance.
    let s = createRegion1({}, undefined, { id: 'w-vega' });
    s = runAction(runAction(s, 'scout'), 'gather');
    expect(fortuneAt(seedOf(s.character.id), 4, 10)).toBe(f);
  });

  // 4. The world config: full by default, flat on request, kept through saves.
  it('stores the world config and keeps it through a save', () => {
    expect(createRegion1().config.world).toEqual(FULL_WORLD);
    const flat = createRegion1({ world: FLAT_WORLD });
    expect(flat.config.world).toEqual(FLAT_WORLD);
    expect(FLAT_WORLD).toEqual({ darkness: false, weather: 'clear', accidents: false });
    expect(FULL_WORLD).toEqual({ darkness: true, weather: 'seeded', accidents: true });
    const saved = deserialize(serialize({ sim: flat, queue: [] }));
    expect(saved?.sim.config.world).toEqual(FLAT_WORLD);
    const raw = JSON.parse(serialize(newGame()));
    delete raw.sim.config.world;
    expect(deserialize(JSON.stringify(raw))?.sim.config.world).toEqual(FULL_WORLD);
  });
});
