/**
 * Acceptance tests for #1346 — people in the Reach: short dialogues of up to three steps, gated
 * by CHA, skills and goods, with Silver Tongue making persuasion easier. One test per scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, chooseOption, runDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD } from './world';
import { encounterById, optionsFor, chanceOf, rollOutcome, stepOf, ENCOUNTERS } from './encounters';
import { seedOf, type Talent } from './talents';

/** A Warden facing `id` (at `step`), calm, with no talents or quirks unless given. */
function facing(id: string, extra: Partial<Region1State> = {}, who = 'w-people', talents: Talent[] = [], step?: string): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: true } }, undefined, { id: who });
  return {
    ...s, canPlan: true, character: { ...s.character, talents, quirks: [] }, hoursToday: 4,
    stores: { ...s.stores, rawFood: 5, water: 3, firewood: 3 },
    pending: { id, day: s.day, hour: 12, ring: 2, action: 'gather', state: 'calm', margin: 0, ...(step ? { step } : {}) }, encounterDay: s.day, ...extra,
  };
}
const read = (s: Region1State, id: string) => optionsFor(s, encounterById(id)!);
const silver: Talent[] = [{ id: 'silverTongue', tier: 1, known: true }];

describe('People in the Reach (#1346)', () => {
  // 1. An option that leads to a next step: pending stays set with the new step, and the day stays paused.
  it('carries a dialogue on to its next step, with the day still paused', () => {
    const s = facing('pandor-scholar');
    const after = chooseOption(s, 'listen');
    expect(after.pending).toMatchObject({ id: 'pandor-scholar', step: 'teach' });
    expect(after.log.at(-1)!.text).toBe(stepOf(encounterById('pandor-scholar')!, 'teach').text);
    expect(read(after, 'pandor-scholar').map(o => o.option.id)).toEqual(['learn', 'thank']);
    // The day doesn't move on while the dialogue waits.
    expect(runDay(after, ['water']).state).toBe(after);
    // Finishing the dialogue closes it.
    const done = chooseOption(after, 'thank');
    expect(done.pending).toBeNull();
    expect(done.met?.['pandor-scholar']).toBe(1);
    // Every dialogue is at most three steps: the opening, and at most two more.
    for (const t of ENCOUNTERS) expect(Object.keys(t.steps ?? {}).length).toBeLessThanOrEqual(2);
  });

  // 2. An option gated by CHA 13, at CHA 10: unavailable, with the reason.
  it('keeps a hard bargain for the charming', () => {
    expect(read(facing('goblin-delver'), 'goblin-delver').find(o => o.option.id === 'haggle')!.unmet).toBe('needs CHA 13');
    const charming = facing('goblin-delver');
    charming.character = { ...charming.character, stats: { ...charming.character.stats, cha: 13 } };
    expect(read(charming, 'goblin-delver').find(o => o.option.id === 'haggle')!.unmet).toBeNull();
    // The delver's map is ground you come to know.
    const traded = chooseOption(facing('goblin-delver'), 'trade');
    expect(traded.explore.known[3].stone).toBeGreaterThanOrEqual(2);
  });

  // 3. Silver Tongue: persuasion odds are one word better.
  it('makes persuasion a word easier with a silver tongue', () => {
    const plain = read(facing('desperate-stranger'), 'desperate-stranger').find(o => o.option.id === 'turn-away')!;
    const smooth = read(facing('desperate-stranger', {}, 'w-people', silver), 'desperate-stranger').find(o => o.option.id === 'turn-away')!;
    expect(plain.odds).toBe('risky');
    expect(smooth.odds).toBe('likely');
    const talk = (talents: Talent[]) => read(facing('desperate-stranger', {}, 'w-people', talents, 'robbery'), 'desperate-stranger').find(o => o.option.id === 'talk-down')!.odds;
    expect(talk([])).toBe('desperate');
    expect(talk(silver)).toBe('risky');
    // Not persuasion, no help: fighting is the same with or without it.
    const fight = stepOf(encounterById('desperate-stranger')!, 'robbery').options.find(o => o.id === 'fight')!;
    expect(chanceOf(facing('desperate-stranger', {}, 'w-people', silver, 'robbery'), fight)).toBe(chanceOf(facing('desperate-stranger', {}, 'w-people', [], 'robbery'), fight));
  });

  // 4. Sharing food with the desperate stranger: food drops by 2, and the deed is remembered.
  it('remembers that you fed a starving stranger', () => {
    const s = facing('desperate-stranger');
    const after = chooseOption(s, 'share');
    expect(after.stores.rawFood).toBe(s.stores.rawFood - 2);
    expect(after.deeds).toEqual(['fed-the-stranger']);
    expect(after.pending).toBeNull();
    // Without the food to share, you can't.
    expect(read(facing('desperate-stranger', { stores: { ...s.stores, rawFood: 1 } }), 'desperate-stranger').find(o => o.option.id === 'share')!.unmet).toBe('needs 2 food');
  });

  // 5. The robbery, fighting and failing: stores lost, Condition drops — and at very low Condition it kills.
  it('can go badly wrong: robbed and hurt, or killed', () => {
    const fight = stepOf(encounterById('desperate-stranger')!, 'robbery').options.find(o => o.id === 'fight')!;
    let who = '';
    for (let i = 0; i < 100 && !who; i++) {
      const c = facing('desperate-stranger', {}, `w-robbed-${i}`, [], 'robbery');
      if (rollOutcome(seedOf(`w-robbed-${i}`), c.pending!, fight, chanceOf(c, fight)).tier === 'fail') who = `w-robbed-${i}`;
    }
    const s = facing('desperate-stranger', { stores: { ...createRegion1().stores, rawFood: 5, rations: 2, materials: 4 } }, who, [], 'robbery');
    const after = chooseOption(s, 'fight');
    expect(after.stores.rawFood).toBe(0);
    expect(after.stores.rations).toBe(0);
    expect(after.stores.materials).toBe(1);
    expect(after.vitals.condition).toBe(s.vitals.condition - 20);
    expect(after.outcome).toBeNull();
    // At very low Condition the same blow kills.
    const weak = chooseOption({ ...s, vitals: createVitals({ condition: 15 }) }, 'fight');
    expect(weak.outcome?.kind).toBe('died');
    expect(weak.log.at(-1)!.text).toBe('Killed by a desperate stranger.');
  });
});
