/**
 * Who you are, then what you pack (#1872, switch `stats-before-pack`): the rules side. The pack
 * ticked for a new Warden follows their stats and talents (acceptance 2), how much they carry
 * follows Strength (3), and the same choices always give the same start, with the switch off or
 * absent packing as before (6). The intro's order is in artificer-app/stats-before-pack-app.test.ts,
 * the AI's packing turn in artificer-ai/stats-before-pack-ai.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { ruleFeatures } from './features';
import { createRegion1, repack } from './region1';
import { makeWarden, serialize } from '../artificer-app/controller';
import { startProblem } from '../artificer-play/web-run';
import { talentOffer, seedOf } from './talents';
import { DEFAULT_STATS, type Stats } from './stats';
import {
  SUGGESTED_PACK, PACK_CAPACITY, comfortableWeight, carryLimit, suggestedPack, suggestedPackOf, packWeight, validPack, type KitId,
} from './kit';

const ON = ruleFeatures();
const OFF = ruleFeatures({ 'stats-before-pack': false });
const stats = (o: Partial<Stats>): Stats => ({ ...DEFAULT_STATS, ...o });
/** The leader's list plus the patrol's tarp and stove, spare socks and a thermos: 9.12 kg, over 9 but under 11. */
const HEAVY: KitId[] = [...SUGGESTED_PACK, 'tarp', 'trangia', 'spare-socks', 'thermos'];

describe('the pack ticked for who you are (#1872, acceptance 2)', () => {
  it('average stats and no talents tick exactly the leader\'s list', () => {
    expect(suggestedPack(ON, DEFAULT_STATS, [])).toEqual([...SUGGESTED_PACK]);
  });

  it('a strong Warden is suggested the hand axe, the tarp and the stove; a weak one a lighter list', () => {
    const strong = suggestedPack(ON, stats({ str: 13 }));
    expect(strong).toEqual([...SUGGESTED_PACK, 'hand-axe', 'tarp', 'trangia']);
    expect(suggestedPack(ON, stats({ str: 11 }))).toEqual([...SUGGESTED_PACK, 'hand-axe']);
    const weak = suggestedPack(ON, stats({ str: 7 }));
    expect(packWeight(weak)).toBeLessThan(packWeight(SUGGESTED_PACK));
    expect(packWeight(weak)).toBeLessThanOrEqual(comfortableWeight(stats({ str: 7 })));
    expect(weak).not.toContain('toilet-paper');
    // What a Warden can't do without stays: the sleeping bag, the knife, the food.
    for (const id of ['sleeping-bag', 'mora-knife', 'weekend-food'] as const) expect(weak).toContain(id);
  });

  it('a clever Warden gets the map and compass and a notebook; talents add what they would reach for', () => {
    expect(suggestedPack(ON, stats({ int: 12 }))).toEqual([...SUGGESTED_PACK, 'notebook']);
    expect(suggestedPack(ON, DEFAULT_STATS, ['hunter'])).toContain('fishing-kit');
    expect(suggestedPack(ON, DEFAULT_STATS, ['waterfinder'])).toContain('fishing-kit');
    expect(suggestedPack(ON, DEFAULT_STATS, ['hardy'])).toContain('hand-axe');
    expect(suggestedPack(ON, DEFAULT_STATS, ['keenEye'])).toContain('binoculars');
    expect(suggestedPack(ON, DEFAULT_STATS, ['quickLearner'])).toContain('notebook');
    // A talent with nothing to pack leaves the list as it was.
    expect(suggestedPack(ON, DEFAULT_STATS, ['steady'])).toEqual([...SUGGESTED_PACK]);
  });

  it('suggests only what the run offers and what does something in it', () => {
    const noAxe = ruleFeatures({ 'pack-axe-fishing': false });
    expect(suggestedPack(noAxe, stats({ str: 13 }), ['hunter'])).toEqual([...SUGGESTED_PACK, 'tarp', 'trangia']);
    // The odd things only weigh with `pack-extras` off, so they aren't suggested then.
    expect(suggestedPack(ruleFeatures({ 'pack-extras': false }), DEFAULT_STATS, ['keenEye'])).toEqual([...SUGGESTED_PACK]);
  });

  it('every suggestion fits the Warden who carries it, and the run\'s list', () => {
    for (const str of [7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const int of [7, 10, 12, 15]) {
      const s = stats({ str, int });
      const p = suggestedPack(ON, s, ['hardy', 'hunter']);
      expect(validPack(p, { features: ON }, comfortableWeight(s))).toBe(true);
    }
  });

  it('is only the starting ticks: the player can still change any item', () => {
    const offer = talentOffer(seedOf('w-1872-edit'));
    const app = makeWarden({ id: 'w-1872-edit', stats: stats({ str: 12, int: 12 }), chosen: offer.slice(0, 2) });
    expect(app.sim.kit?.items).toEqual(suggestedPackOf(app.sim));
    // Take things out, put others in: repack takes any pack that fits.
    const mine: KitId[] = ['sleeping-bag', 'mora-knife', 'comic', 'phone'];
    expect(repack(app.sim, mine).kit?.items).toEqual(mine);
    expect(repack(app.sim, []).kit?.items).toEqual([]);
  });
});

describe('how much you carry follows Strength (#1872, acceptance 3)', () => {
  it('is 9 kg at STR 10, about 1 kg per point either way, between 6 and 13', () => {
    expect(comfortableWeight(stats({ str: 10 }))).toBe(PACK_CAPACITY);
    expect(comfortableWeight(stats({ str: 12 }))).toBe(11);
    expect(comfortableWeight(stats({ str: 8 }))).toBe(7);
    expect(comfortableWeight(stats({ str: 7 }))).toBe(6);
    expect(comfortableWeight(stats({ str: 3 }))).toBe(6);
    expect(comfortableWeight(stats({ str: 18 }))).toBe(13);
    // Only Strength moves it (the owner's call: not CON).
    expect(comfortableWeight(stats({ con: 15 }))).toBe(PACK_CAPACITY);
    for (let str = 3; str < 18; str++) expect(comfortableWeight(stats({ str: str + 1 }))).toBeGreaterThanOrEqual(comfortableWeight(stats({ str })));
  });

  it('a strong Warden packs more than 9 kg, an average one can\'t, and a weak one less', () => {
    const strong = makeWarden({ id: 'w-1872-strong', stats: stats({ str: 12 }) });
    const average = makeWarden({ id: 'w-1872-avg', stats: stats({}) });
    const weak = makeWarden({ id: 'w-1872-weak', stats: stats({ str: 8 }) });
    expect(carryLimit(strong.sim)).toBe(11);
    expect(carryLimit(weak.sim)).toBe(7);
    expect(repack(strong.sim, HEAVY).kit?.items).toEqual(HEAVY);
    expect(repack(average.sim, HEAVY).kit?.items).toEqual(average.sim.kit?.items);
    // 7.22 kg: fine for the average Warden, too much for the weak one.
    const mid: KitId[] = [...SUGGESTED_PACK, 'tarp'];
    expect(repack(average.sim, mid).kit?.items).toEqual(mid);
    expect(repack(weak.sim, mid).kit?.items).toEqual(weak.sim.kit?.items);
  });

  it('reads the stats chosen at creation, not the young body\'s', () => {
    const kid = makeWarden({ id: 'w-1872-kid', stats: stats({ str: 12 }), age: 11 });
    expect(kid.sim.character.stats.str).toBeLessThan(12);
    expect(carryLimit(kid.sim)).toBe(11);
  });

  it('the play API checks a log\'s pack against its Warden\'s stats', () => {
    const id = 'w-1872-api';
    const base = { id, name: 'Vega', portrait: 'loke', chosen: talentOffer(seedOf(id)).slice(0, 2), age: 12, heirlooms: null } as const;
    expect(startProblem({ ...base, stats: stats({ str: 12, con: 9 }), pack: HEAVY, features: ON })).toBeNull();
    expect(startProblem({ ...base, stats: stats({}), pack: HEAVY, features: ON })).toMatch(/pack/);
    expect(startProblem({ ...base, pack: HEAVY, features: ON })).toMatch(/pack/);
    expect(startProblem({ ...base, stats: stats({ str: 12, con: 9 }), pack: HEAVY, features: OFF })).toMatch(/pack/);
  });
});

describe('the same start, and the switch (#1872, acceptance 6)', () => {
  it('the same seed and choices give the same start', () => {
    const who = { id: 'w-1872-same', stats: stats({ str: 13, int: 12, cha: 9 }), chosen: talentOffer(seedOf('w-1872-same')).slice(0, 2) };
    expect(serialize(makeWarden(who))).toBe(serialize(makeWarden(who)));
    expect(suggestedPack(ON, who.stats, who.chosen)).toEqual(suggestedPack(ON, who.stats, who.chosen));
  });

  it('off, every Warden gets the leader\'s list and 9 kg, whatever their stats', () => {
    for (const str of [7, 10, 13]) {
      const app = makeWarden({ id: `w-1872-off-${str}`, stats: stats({ str }), chosen: ['hardy', 'hunter'] }, undefined, { 'stats-before-pack': false });
      expect(app.sim.kit?.items).toEqual([...SUGGESTED_PACK]);
      expect(carryLimit(app.sim)).toBe(PACK_CAPACITY);
      expect(suggestedPack(OFF, stats({ str }), ['hardy'])).toEqual([...SUGGESTED_PACK]);
    }
  });

  it('a run from before the switch (absent) packs as it did', () => {
    const old = createRegion1({}, undefined, { id: 'w-1872-old', stats: stats({ str: 13 }), pack: [...SUGGESTED_PACK] });
    expect(carryLimit(old)).toBe(PACK_CAPACITY);
    expect(suggestedPackOf(old)).toEqual([...SUGGESTED_PACK]);
    expect(repack(old, HEAVY).kit?.items).toEqual([...SUGGESTED_PACK]);
  });
});
