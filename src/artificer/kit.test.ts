/**
 * Acceptance tests for #1400 — Scout 3: the hike kit. What's in the pack, what day 1 looks like
 * with it, and what each thing does. One test per Given/When/Then scenario, then the effects.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, queueHours, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD, FULL_WORLD } from './world';
import { LEVEL_HOURS } from './skills';
import { createExploration, scout } from './exploration';
import { legacyOf } from './legacy';
import { unmet, encounterById } from './encounters';
import {
  KIT, KIT_IDS, PACK_CAPACITY, SUGGESTED_PACK, packWeight, packProblem, validPack, startFromPack, readKit, kitSupplies,
  KIT_LAMP_HOURS, MAP_TIME, type KitId,
} from './kit';
import { newGame, serialize, deserialize } from '../artificer-app/controller';
import { observe } from '../artificer-ai/observe';

/** A scouted Warden with this pack, in the flat world (no accidents), at `hoursSpent` past 06:00 on day 1. */
function packed(pack: KitId[], hoursSpent = 2, over: Partial<Region1State> = {}): Region1State {
  const s = runAction(createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-kit', pack }), 'scout');
  return { ...s, hoursToday: hoursSpent, vitals: createVitals(), character: { ...s.character, talents: [], quirks: [] }, ...over };
}
const NIGHT = 15; // 21:00

describe('The hike kit (#1400)', () => {
  // 1. A pack within 9 kg: accepted, and day 1 has its tools and stores.
  it('turns a pack into day 1', () => {
    expect(KIT.length).toBe(27);
    expect(packWeight(SUGGESTED_PACK)).toBeLessThanOrEqual(PACK_CAPACITY);
    expect(packWeight(KIT_IDS)).toBeGreaterThan(PACK_CAPACITY); // you can't take everything
    expect(validPack(SUGGESTED_PACK)).toBe(true);
    const start = startFromPack(SUGGESTED_PACK);
    expect(start.tools).toEqual([
      { item: 'backpack', grade: 'sound' }, { item: 'stone-knife', grade: 'fine' }, { item: 'waterskin', grade: 'sound' }, { item: 'bedroll', grade: 'fine' },
    ]);
    expect(start.stores).toEqual({ rations: 4, materials: 2 });
    // In play: the tools, the food and cord in the stores, and the kit itself.
    const s = createRegion1({}, undefined, { id: 'w-kit', pack: [...SUGGESTED_PACK] });
    expect(s.tools).toEqual(start.tools);
    expect(s.stores).toMatchObject({ rawFood: 2, rations: 4, materials: 3 });
    expect(s.kit?.items).toEqual(SUGGESTED_PACK);
    expect(s.character.pack).toEqual(SUGGESTED_PACK);
    // Even an empty pack is a backpack; a bag without the pad is a sound bedroll.
    expect(startFromPack([]).tools).toEqual([{ item: 'backpack', grade: 'sound' }]);
    expect(startFromPack(['sleeping-bag']).tools).toContainEqual({ item: 'bedroll', grade: 'sound' });
  });

  // 2. Over 9 kg, or an item twice: refused, with the reason.
  it('refuses a pack that is too heavy or has something twice', () => {
    expect(packProblem(KIT_IDS)).toMatch(/^too heavy: \d+(\.\d+)? kg, and the pack holds 9$/);
    expect(packProblem(['kasa', 'kasa'])).toBe('kåsa is in there twice');
    expect(packProblem(['chainsaw'])).toBe('there\'s no "chainsaw" on the list');
    expect(validPack(['kasa', 'kasa'])).toBe(false);
  });

  // 3. The first-aid kit: 3 dressings, and treat uses one instead of goods.
  it('brings three dressings for treating injuries', () => {
    const s = packed(['first-aid-kit'], 2, { injuries: [{ kind: 'sprain', severity: 'serious', heal: 6 }] });
    expect(s.dressings).toBe(3);
    const t = runAction(s, 'treat');
    expect(t.dressings).toBe(2);
    expect(t.stores).toEqual(s.stores);
    expect(t.injuries?.[0].treated).toBeDefined();
  });

  // 4. The headlamp: crafting at night with no firewood, no dark penalty while the battery lasts; it runs down by the hours used.
  it('lights close work at night until the battery runs down', () => {
    const bench = (pack: KitId[], lamp?: number) => {
      // The full world (the flat one has no night), with accidents off.
      const w = runAction(createRegion1({ world: { ...FULL_WORLD, accidents: false, encounters: false } }, undefined, { id: 'w-kit', pack }), 'scout');
      const s = chooseSite({ ...w, hoursToday: NIGHT, character: { ...w.character, talents: [], quirks: [] } }, 'cave');
      return { ...s, skills: { handcraft: LEVEL_HOURS[2] }, stores: { ...s.stores, materials: 20, firewood: 0 }, vitals: createVitals({ clarity: 60 }), ...(lamp !== undefined && s.kit ? { kit: { ...s.kit, lamp } } : {}) };
    };
    const gear = (s: Region1State) => runAction(s, 'coldGear');
    const lit = gear(bench(['headlamp']));
    const dark = gear(bench([]));
    expect(lit.tools.find(t => t.item === 'cold-gear')?.grade).toBe('sound');
    expect(dark.tools.find(t => t.item === 'cold-gear')?.grade).toBe('crude');
    const hours = lit.hoursToday - NIGHT;
    expect(lit.kit?.lamp).toBeCloseTo(KIT_LAMP_HOURS - hours, 10);
    // Not enough battery left for the job: back to the dark.
    expect(gear(bench(['headlamp'], 1)).tools.find(t => t.item === 'cold-gear')?.grade).toBe('crude');
    // By day it isn't used at all.
    const day = chooseSite(packed(['headlamp'], 6), 'cave');
    expect(runAction({ ...day, stores: { ...day.stores, materials: 20 } }, 'coldGear').kit?.lamp).toBe(KIT_LAMP_HOURS);
    // Study by headlamp, too.
    const reader = runAction(createRegion1({ world: { ...FULL_WORLD, accidents: false, encounters: false } }, undefined, { id: 'w-kit', pack: ['headlamp'] }), 'scout');
    const read = runAction({ ...reader, hoursToday: NIGHT, vitals: createVitals() }, { q: 'study', opts: { concept: 'joinery' } });
    expect(read.log.some(l => /By headlamp/.test(l.text))).toBe(true);
  });

  // 5. No pack (an old save or a test): exactly the old start.
  it('keeps the old start when there is no pack', () => {
    const s = createRegion1({}, undefined, { id: 'w-bare' });
    expect(s.tools).toEqual([]);
    expect(s.stores).toEqual({ rawFood: 2, water: 2, firewood: 0, materials: 1, rations: 0, stone: 0, hides: 0 });
    expect(s.kit).toBeUndefined();
    expect(s.dressings).toBeUndefined();
  });

  // The game and the AI: a new Warden packs the leader's list; the pack is carried, saved, and shown.
  it('packs the leader\'s list for a new Warden, and keeps it', () => {
    const g = newGame().sim;
    expect(g.kit?.items).toEqual(SUGGESTED_PACK);
    expect(deserialize(serialize(newGame()))?.sim.kit?.items).toEqual(SUGGESTED_PACK);
    expect(readKit({ items: ['chainsaw'] })).toBeUndefined();
    // The next run of the same character packs the same again.
    const next = createRegion1({}, legacyOf(g), { id: g.character.id });
    expect(next.kit?.items).toEqual(SUGGESTED_PACK);
    expect(observe(g)).toMatch(/PACK \(what you brought on the hike\): Mora knife — a fine knife/);
    expect(observe(g)).toMatch(/LEFT: 3 dressings, headlamp 8h/);
    expect(kitSupplies(startFromPack(['thermos', 'sweets']).kit)).toEqual(['thermos 2 drinks', 'sweets saved']);
  });
});

describe('What each thing does (#1400)', () => {
  it('pitches the tarp when you make camp', () => {
    const camp = chooseSite(packed(['tarp']), 'cave');
    expect(camp).toMatchObject({ tier: 1, shelterGrade: 'crude', shelter: { type: 'leanto', walls: null } });
    expect(chooseSite(packed([]), 'cave').tier).toBe(0);
  });

  it('keeps you drier with rain gear and dry socks', () => {
    const wet = (pack: KitId[]) => runAction({ ...packed(pack), weatherToday: 'rain' }, 'gather').wetHours ?? 0;
    expect(wet(['rain-gear'])).toBeCloseTo(wet([]) * 0.5, 10);
    // Soaked through: dry socks halve the misery.
    const evening = (pack: KitId[]) => {
      const s = { ...packed(pack, 2, { stores: { ...packed([]).stores, rawFood: 9, water: 9 } }), weatherToday: 'rain' as const, wetHours: 99 };
      return runDay(s, []).state.log.find(l => /Wet through/.test(l.text))?.text;
    };
    expect(evening(['spare-socks'])).toMatch(/at least there are dry socks/);
  });

  it('makes scouting quicker with a map and compass', () => {
    const s = { ...packed(['map-compass']), explore: scout(createExploration(), 1) };
    const bare = { ...packed([]), explore: scout(createExploration(), 1) };
    expect(queueHours('survey', s)).toBeCloseTo(queueHours('survey', bare) * MAP_TIME, 10);
    expect(runAction(s, 'survey').hoursToday - s.hoursToday).toBeCloseTo((runAction(bare, 'survey').hoursToday - bare.hoursToday) * MAP_TIME, 10);
  });

  it('studies better with a notebook, and rests better on a sit pad', () => {
    const studied = (pack: KitId[]) => runAction(packed(pack), { q: 'study', opts: { concept: 'joinery' } }).concepts.joinery?.insight ?? 0;
    expect(studied(['notebook'])).toBeGreaterThan(studied([]));
    const rested = (pack: KitId[]) => runAction(packed(pack, 2, { vitals: createVitals({ vigor: 40 }) }), 'rest').vitals.vigor.current;
    expect(rested(['sit-pad'])).toBe(rested([]) + 2);
  });

  it('brings comforts for the night, and the phone dies', () => {
    const fed = (pack: KitId[]): Region1State => packed(pack, 2, { stores: { ...packed([]).stores, rawFood: 9, water: 9 } });
    const night1 = runDay(fed(['pillow', 'phone']), []).state;
    expect(night1.log.some(l => /Your own pillow/.test(l.text))).toBe(true);
    const night2 = runDay(night1, []).state;
    expect(night2.log.some(l => /phone dies/.test(l.text))).toBe(true);
    // The sweets, once, when the mind is nearly gone.
    const low = runDay(fed(['sweets']), [], ).state;
    expect(low.kit?.sweets).toBe(1);
    const gone = runDay({ ...fed(['sweets']), vitals: createVitals({ clarity: 5 }) }, []).state;
    expect(gone.kit?.sweets).toBe(0);
    expect(gone.log.some(l => /Saturday sweets/.test(l.text))).toBe(true);
  });

  it('lets a whistle send off a boar or a bear', () => {
    const boar = encounterById('wild-boar')!;
    const whistle = boar.options.find(o => o.id === 'whistle')!;
    expect(unmet(packed(['whistle']), whistle)).toBeNull();
    expect(unmet(packed([]), whistle)).toBe('needs a whistle');
    expect(encounterById('she-bear')!.options.some(o => o.id === 'whistle')).toBe(true);
  });

  it('softens cold nights with wool, and blizzards with a hat and mittens', () => {
    // Out in the open in the full world on a cold night: wool takes 15% off.
    const night = (pack: KitId[]) => {
      const s = createRegion1({ world: { ...FULL_WORLD, encounters: false, accidents: false } }, undefined, { id: 'w-cold', pack });
      const out = { ...s, day: 40, explore: scout(createExploration(), 1), stores: { ...s.stores, rawFood: 9, water: 9 }, character: { ...s.character, talents: [] } };
      return 100 - runDay(out, ['rest']).state.vitals.condition;
    };
    expect(night(['wool-underlayer'])).toBeLessThan(night([]));
  });
});
