/**
 * Acceptance tests for #1379 — what remembering a place does: going back pays, feelings change
 * how a ring feels, and the interest scale opens with Memory. One test per scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, warmth, ringAmbient, setInterest, forgetPin, type Region1State, type QueueItem } from './region1';
import { FLAT_WORLD, FULL_WORLD } from './world';
import { createExploration, scout, type Ring } from './exploration';
import { createVitals } from './vitality';
import { LEVEL_HOURS } from './skills';
import { maxInterest, letGoFirst, pinId, type Pin, type PinKind, type Feeling, type Interest } from './pins';

const pin = (place: string, kind: PinKind, ring: Ring, extra: { feeling?: Feeling; interest?: Interest; day?: number } = {}): Pin =>
  ({ id: pinId(place, ring), place, kind, ring, day: extra.day ?? 1, ...(extra.feeling ? { feeling: extra.feeling } : {}), ...(extra.interest ? { interest: extra.interest } : {}) });

/** A Warden on day 5 of a flat world (no luck, no dark), with the near and far rings scouted. */
function out(over: Partial<Region1State> = {}): Region1State {
  const s = createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-pin-fx' });
  return {
    ...s, day: 5, canPlan: true, explore: scout(scout(createExploration(), 1), 2), vitals: createVitals(),
    stores: { ...s.stores, firewood: 4, water: 0, rawFood: 4 }, character: { ...s.character, talents: [], quirks: [] }, ...over,
  };
}
const gained = (s: Region1State, item: QueueItem, k: 'water' | 'rawFood' | 'stone'): number => runAction(s, item).stores[k] - s.stores[k];
const atApprentice = { memory: LEVEL_HOURS[2] }, atAdept = { memory: LEVEL_HOURS[3] };

describe('What a remembered place does (#1379)', () => {
  // 1. A deep-pool pin in ring 2: fishing or fetching water in ring 2 brings back +1.
  it('brings back more from a fishing spot you remember', () => {
    const pool = { pins: [pin('deep-pool', 'fishing', 2)] };
    expect(gained(out(pool), 'water@2', 'water')).toBe(gained(out(), 'water@2', 'water') + 1);
    // Only in its own ring, and only for its own work.
    expect(gained(out(pool), 'water@1', 'water')).toBe(gained(out(), 'water@1', 'water'));
    expect(gained(out(pool), 'gather@2', 'rawFood')).toBe(gained(out(), 'gather@2', 'rawFood'));
    // A berry thicket helps gathering; an outcrop, quarrying.
    expect(gained(out({ pins: [pin('berry-thicket', 'forage', 2)] }), 'gather@2', 'rawFood')).toBe(gained(out(), 'gather@2', 'rawFood') + 1);
    expect(gained(out({ pins: [pin('stone-outcrop', 'stone', 2)] }), 'quarry@2', 'stone')).toBe(gained(out(), 'quarry@2', 'stone') + 1);
  });

  // 2. A peaceful-glade pin in ring 1: ring 1's ambient threat is 1 lower. An eerie-carving pin in ring 2: ring 2's is 1 higher.
  it('lets a peaceful place calm its ring, and an eerie one darken it', () => {
    const world = { config: createRegion1({ world: { ...FULL_WORLD, encounters: true } }).config, weatherToday: 'fog' as const };
    const plain = out(world);
    const dusk = 0.3;
    expect(ringAmbient(out({ ...world, pins: [pin('sunlit-glade', 'peaceful', 1, { feeling: 'peaceful' })] }), 1, dusk)).toBe(ringAmbient(plain, 1, dusk) - 1);
    expect(ringAmbient(out({ ...world, pins: [pin('strange-carving', 'wonder', 2, { feeling: 'eerie' })] }), 2, dusk)).toBe(ringAmbient(plain, 2, dusk) + 1);
    // Something that awed you: the ring is no worse in the dark than by day.
    const awed = out({ ...world, pins: [pin('strange-carving', 'wonder', 2, { feeling: 'awed' })] });
    expect(ringAmbient(plain, 2, 0.1)).toBeGreaterThan(ringAmbient(plain, 2, 1));
    expect(ringAmbient(awed, 2, 0.1)).toBe(ringAmbient(plain, 2, 1));
  });

  // 3. A sheltered-hollow pin in ring 1: a shelter built is 5 points warmer.
  it('builds a warmer shelter where you remember the wind doesn\'t reach', () => {
    const camp = (pins: Pin[]) => ({ ...chooseSite(out({ pins }), 'tree'), stores: { ...out().stores, materials: 20 } });
    const plain = runAction(camp([]), 'build');
    const sited = runAction(camp([pin('sheltered-hollow', 'shelter', 1)]), 'build');
    expect(sited.shelterGrade).toBe(plain.shelterGrade);
    expect(warmth(sited)).toBeCloseTo(warmth(plain) + 0.05, 10);
    // A far-ring hollow is no help at camp.
    expect(warmth(runAction(camp([pin('sheltered-hollow', 'shelter', 2)]), 'build'))).toBe(warmth(plain));
    // Built is built: letting the place go afterwards doesn't take the warmth away.
    expect(warmth(forgetPin(sited, 'sheltered-hollow@1'))).toBe(warmth(sited));
  });

  // 4. Memory untrained: no interest. At Apprentice, ★–★★; at Adept, ★★★.
  it('opens the interest scale as Memory grows', () => {
    const held = { pins: [pin('deep-pool', 'fishing', 2)] };
    expect(maxInterest({})).toBe(0);
    expect(setInterest(out(held), 'deep-pool@2', 1).pins![0].interest).toBeUndefined();
    const apprentice = out({ ...held, skills: atApprentice });
    expect(setInterest(apprentice, 'deep-pool@2', 2).pins![0].interest).toBe(2);
    expect(setInterest(apprentice, 'deep-pool@2', 3).pins![0].interest).toBeUndefined();
    expect(setInterest(out({ ...held, skills: atAdept }), 'deep-pool@2', 3).pins![0].interest).toBe(3);
    // Clearing it again.
    expect(setInterest(setInterest(apprentice, 'deep-pool@2', 2), 'deep-pool@2', 0).pins![0].interest).toBeUndefined();
    // When full, the one you'd let go first: the least interesting, the oldest of those.
    expect(letGoFirst([pin('a', 'stone', 1, { interest: 2, day: 1 }), pin('b', 'stone', 1, { day: 4 }), pin('c', 'stone', 1, { day: 2 })])!.place).toBe('c');
  });

  // 5. A ★★★ deep-pool pin: the bonus is +2.
  it('doubles a well-known place\'s effect', () => {
    expect(gained(out({ pins: [pin('deep-pool', 'fishing', 2, { interest: 3 })] }), 'water@2', 'water')).toBe(gained(out(), 'water@2', 'water') + 2);
    expect(gained(out({ pins: [pin('deep-pool', 'fishing', 2, { interest: 2 })] }), 'water@2', 'water')).toBe(gained(out(), 'water@2', 'water') + 1);
  });

  // 6. A trip to a pinned ring: Memory gets 1h practice, at most once a day.
  it('practises Memory going back, once a day', () => {
    const s = out({ pins: [pin('deep-pool', 'fishing', 2)] });
    const once = runAction(s, 'water@2');
    expect(once.skills.memory).toBe(1);
    expect(runAction(once, 'water@2').skills.memory).toBe(1);
    // Not for a ring with nothing remembered, nor for a place found today.
    expect(runAction(s, 'water@1').skills.memory ?? 0).toBe(0);
    expect(runAction(out({ pins: [pin('deep-pool', 'fishing', 2, { day: 5 })] }), 'water@2').skills.memory ?? 0).toBe(0);
    // The first return to something that awed you teaches a little; the second doesn't.
    const awed = runAction(out({ pins: [pin('strange-carving', 'wonder', 2, { feeling: 'awed' })] }), 'water@2');
    expect(awed.concepts.sealing?.insight ?? 0).toBeGreaterThan(0);
    expect(awed.pins![0].visited).toBe(true);
    const again = runAction({ ...awed, day: 6, today: { ...awed.today, revisited: false } }, 'water@2');
    expect(again.concepts.sealing?.insight).toBe(awed.concepts.sealing?.insight);
  });
});
