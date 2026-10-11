/**
 * Acceptance tests for #1363 — talents that steady the nerve: Steady and Surge (new), and
 * Keen Eye and Hunter's Patience reading threat better. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, chooseOption, type Region1State } from './region1';
import { FULL_WORLD } from './world';
import { encounterById, chanceOf, type PendingEncounter } from './encounters';
import { nerveOf, perceivedThreat, CRASH_CLARITY } from './panic';
import { talentOffer, seedOf, growthFor, NIGHT_GROWTH, type Talent, type TalentId } from './talents';

const fox = encounterById('fox-at-the-treeline')!;
const ledge = encounterById('crumbling-ledge')!;
const talent = (id: TalentId, tier = 1): Talent => ({ id, tier, known: true });

/** A Warden with exactly these talents (and no quirks), facing the fox in `state`. */
function warden(talents: Talent[], state?: NonNullable<PendingEncounter['state']>): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: true } }, undefined, { id: 'w-nerves' });
  return {
    ...s, character: { ...s.character, talents, quirks: [] }, hoursToday: 4,
    ...(state ? { pending: { id: fox.id, day: 1, hour: 10, ring: 1 as const, action: 'hunt', state, margin: state === 'panicked' ? 2 : 0 }, encounterDay: 1 } : {}),
  };
}

describe('Talents that steady the nerve (#1363)', () => {
  // 1. Steady at tier 3: nerve 2 higher.
  it('gives Steady more nerve as it grows', () => {
    expect(nerveOf(warden([talent('steady', 3)]))).toBe(nerveOf(warden([])) + 2);
    expect(nerveOf(warden([talent('steady', 1)]))).toBe(nerveOf(warden([])) + 1);
    // It grows from being frightened and coming through.
    expect(growthFor('steady', { kind: 'fright', panicked: false })).toBe(NIGHT_GROWTH);
    expect(growthFor('surge', { kind: 'fright', panicked: false })).toBe(0);
    expect(growthFor('surge', { kind: 'fright', panicked: true })).toBe(NIGHT_GROWTH);
    const s = warden([{ id: 'steady', tier: 1, known: false }], 'shaken');
    expect(chooseOption(s, 'watch').character.talents[0].growth).toBe(NIGHT_GROWTH);
  });

  // 2. Surge, panicked, an AGI option: odds use AGI +4, and the crash leaves Vigor unchanged.
  it('doubles the surge and spares the body the crash', () => {
    const chase = fox.options.find(o => o.id === 'chase')!;
    const surging = warden([talent('surge')], 'panicked');
    const faster = warden([], 'calm');
    faster.character = { ...faster.character, stats: { ...faster.character.stats, agi: faster.character.stats.agi + 4 } };
    expect(chanceOf(surging, chase)).toBeCloseTo(chanceOf(faster, chase));
    const after = chooseOption(surging, 'back-away'); // sure and free, so only the crash moves the pools
    expect(after.vitals.vigor.current).toBe(surging.vitals.vigor.current);
    expect(after.vitals.clarity.current).toBe(surging.vitals.clarity.current - CRASH_CLARITY);
  });

  // 3. Keen Eye, a first meeting: no unfamiliarity +1.
  it('lets a Keen Eye read the unknown truly', () => {
    expect(perceivedThreat(warden([talent('keenEye')]), ledge)).toBe(perceivedThreat(warden([]), ledge) - 1);
    // Once it's familiar there's nothing left to read truly.
    const met = { met: { [ledge.id]: 1 } };
    expect(perceivedThreat({ ...warden([talent('keenEye')]), ...met }, ledge)).toBe(perceivedThreat({ ...warden([]), ...met }, ledge));
  });

  // 4. Hunter's Patience, an animal: perceived 1 lower.
  it('makes animals look smaller to a patient hunter', () => {
    expect(perceivedThreat(warden([talent('hunter')]), fox)).toBe(perceivedThreat(warden([]), fox) - 1);
    // Not the ledge: that's no animal.
    expect(perceivedThreat(warden([talent('hunter')]), ledge)).toBe(perceivedThreat(warden([]), ledge));
  });

  // 5. A talent offer: Steady and Surge can appear in it.
  it('offers Steady and Surge at creation', () => {
    const offers = Array.from({ length: 200 }, (_, i) => talentOffer(seedOf(`w-offer-${i}`))).flat();
    expect(offers).toContain('steady');
    expect(offers).toContain('surge');
  });
});
