/**
 * Who you are, then what you pack (#1872, switch `stats-before-pack`): the rules side. The pack
 * ticked for a new Warden follows their stats and talents (acceptance 2), how much they carry
 * follows Strength (3), and the same choices always give the same start, with the switch off or
 * absent packing as before (6). The intro's order is in artificer-app/stats-before-pack-app.test.ts,
 * the AI's packing turn in artificer-ai/stats-before-pack-ai.test.ts.
 *
 * The carry weight is #1871's comfortableWeight (kit.ts), on the Warden's Strength now: a child
 * carries with the arms they have today. So the stats here are the young body's, on that scale:
 * STR 6 is the usual 12-year-old (STR 10 grown up, growing.ts), 9 kg, about 1 kg per point. Most of
 * these run with `pack-volume` off, where that weight is the pack's hard limit; the last block has
 * both switches on, where weight is soft and this switch only shapes the suggested pack.
 */

import { describe, it, expect } from 'vitest';
import { ruleFeatures } from './features';
import { createRegion1, repack } from './region1';
import { makeWarden, serialize } from '../artificer-app/controller';
import { startProblem } from '../artificer-play/web-run';
import { talentOffer, seedOf } from './talents';
import { DEFAULT_STATS, type Stats } from './stats';
import { grownStats, DEFAULT_AGE } from './growing';
import {
  SUGGESTED_PACK, PACK_CAPACITY, PACK_FEELS, PACK_FEEL_LINE, comfortableWeight, carryLimit, suggestedPack, suggestedPackOf, packWeight, validPack,
  packProblem, packFeel, packWalkMult, offeredKit, autoOutside, type KitId,
} from './kit';
import { makeT } from './i18n';
import { observePack } from '../artificer-ai/observe';
import { packForm } from '../artificer-app/opening-view';

/** `stats-before-pack` on, with the weight-only rules (`pack-volume` off, #1871): the carry weight is a hard limit. */
const ON = ruleFeatures({ 'pack-volume': false });
const OFF = ruleFeatures({ 'stats-before-pack': false, 'pack-volume': false });
/** Chosen (adult) stats, as the point-buy and makeWarden take them. */
const stats = (o: Partial<Stats>): Stats => ({ ...DEFAULT_STATS, ...o });
/** The usual new scout's stats now: average, grown to 12 (STR 6, INT 8). */
const KID = grownStats(DEFAULT_STATS, DEFAULT_AGE);
/** Stats now (the young body's), on the scale the carry weight and the suggestions read. */
const now = (o: Partial<Stats>): Stats => ({ ...KID, ...o });
/** The leader's list plus the patrol's tarp and stove, spare socks and a thermos: 9.12 kg, over 9 but under 11. */
const HEAVY: KitId[] = [...SUGGESTED_PACK, 'tarp', 'trangia', 'spare-socks', 'thermos'];

describe('the pack ticked for who you are (#1872, acceptance 2)', () => {
  it('the usual new scout with no talents ticks exactly the leader\'s list', () => {
    expect(suggestedPack(ON, KID, [])).toEqual([...SUGGESTED_PACK]);
  });

  it('a strong Warden is suggested the hand axe, the tarp and the stove; a weak one a lighter list', () => {
    // STR 9 and 7 now (13 and 11 chosen, at 12); STR 3 now, 6 kg, the floor.
    const strong = suggestedPack(ON, now({ str: 9 }));
    expect(strong).toEqual([...SUGGESTED_PACK, 'hand-axe', 'tarp', 'trangia']);
    expect(suggestedPack(ON, now({ str: 7 }))).toEqual([...SUGGESTED_PACK, 'hand-axe']);
    const weak = suggestedPack(ON, now({ str: 3 }));
    expect(packWeight(weak)).toBeLessThan(packWeight(SUGGESTED_PACK));
    expect(packWeight(weak)).toBeLessThanOrEqual(comfortableWeight(3));
    expect(weak).not.toContain('toilet-paper');
    // What a Warden can't do without stays: the sleeping bag, the knife, the food.
    for (const id of ['sleeping-bag', 'mora-knife', 'weekend-food'] as const) expect(weak).toContain(id);
  });

  it('a clever Warden gets the map and compass and a notebook; talents add what they would reach for', () => {
    // INT 10 now is INT 12 chosen (a young mind is 2 behind at every starting age).
    expect(suggestedPack(ON, now({ int: 10 }))).toEqual([...SUGGESTED_PACK, 'notebook']);
    expect(suggestedPack(ON, KID, ['hunter'])).toContain('fishing-kit');
    expect(suggestedPack(ON, KID, ['waterfinder'])).toContain('fishing-kit');
    expect(suggestedPack(ON, KID, ['hardy'])).toContain('hand-axe');
    expect(suggestedPack(ON, KID, ['keenEye'])).toContain('binoculars');
    expect(suggestedPack(ON, KID, ['quickLearner'])).toContain('notebook');
    // A talent with nothing to pack leaves the list as it was.
    expect(suggestedPack(ON, KID, ['steady'])).toEqual([...SUGGESTED_PACK]);
  });

  it('suggests only what the run offers and what does something in it', () => {
    const noAxe = ruleFeatures({ 'pack-axe-fishing': false, 'pack-volume': false });
    expect(suggestedPack(noAxe, now({ str: 9 }), ['hunter'])).toEqual([...SUGGESTED_PACK, 'tarp', 'trangia']);
    // The odd things only weigh with `pack-extras` off, so they aren't suggested then.
    expect(suggestedPack(ruleFeatures({ 'pack-extras': false, 'pack-volume': false }), KID, ['keenEye'])).toEqual([...SUGGESTED_PACK]);
  });

  it('every suggestion fits the Warden who carries it, and the run\'s list', () => {
    for (const str of [3, 4, 5, 6, 7, 8, 9, 10, 11]) for (const int of [5, 8, 10, 13]) {
      const p = suggestedPack(ON, now({ str, int }), ['hardy', 'hunter']);
      expect(validPack(p, { features: ON, limit: comfortableWeight(str) })).toBe(true);
    }
  });

  it('is only the starting ticks: the player can still change any item', () => {
    const offer = talentOffer(seedOf('w-1872-edit'));
    const app = makeWarden({ id: 'w-1872-edit', stats: stats({ str: 12, int: 12 }), chosen: offer.slice(0, 2) }, undefined, ON);
    expect(app.sim.kit?.items).toEqual(suggestedPackOf(app.sim));
    // Take things out, put others in: repack takes any pack that fits.
    const mine: KitId[] = ['sleeping-bag', 'mora-knife', 'comic', 'phone'];
    expect(repack(app.sim, mine).kit?.items).toEqual(mine);
    expect(repack(app.sim, []).kit?.items).toEqual([]);
  });
});

describe('how much you carry follows Strength (#1872, acceptance 3)', () => {
  it('is 9 kg at STR 6 now (the usual 12-year-old), about 1 kg per point either way, between 6 and 13', () => {
    // #1871's formula, the one both switches share: STR now, 9 kg at 6.
    expect(comfortableWeight(6)).toBe(PACK_CAPACITY);
    expect(comfortableWeight(8)).toBe(11);
    expect(comfortableWeight(4)).toBe(7);
    expect(comfortableWeight(3)).toBe(6);
    expect(comfortableWeight(18)).toBe(13);
    // Only Strength moves it (the owner's call: not CON).
    const run = (o: Partial<Stats>) => ({ config: { world: { features: ON } }, character: { stats: now(o) } });
    expect(carryLimit(run({ con: 15 }))).toBe(PACK_CAPACITY);
    expect(carryLimit(run({ str: 8 }))).toBe(11);
    for (let str = 3; str < 18; str++) expect(comfortableWeight(str + 1)).toBeGreaterThanOrEqual(comfortableWeight(str));
  });

  it('a strong Warden packs more than 9 kg, an average one can\'t, and a weak one less', () => {
    // Chosen STR 12, 10 and 8 are STR 8, 6 and 4 at 12: 11, 9 and 7 kg.
    const strong = makeWarden({ id: 'w-1872-strong', stats: stats({ str: 12 }) }, undefined, ON);
    const average = makeWarden({ id: 'w-1872-avg', stats: stats({}) }, undefined, ON);
    const weak = makeWarden({ id: 'w-1872-weak', stats: stats({ str: 8 }) }, undefined, ON);
    expect(carryLimit(strong.sim)).toBe(11);
    expect(carryLimit(weak.sim)).toBe(7);
    expect(repack(strong.sim, HEAVY).kit?.items).toEqual(HEAVY);
    expect(repack(average.sim, HEAVY).kit?.items).toEqual(average.sim.kit?.items);
    // 7.22 kg: fine for the average Warden, too much for the weak one.
    const mid: KitId[] = [...SUGGESTED_PACK, 'tarp'];
    expect(repack(average.sim, mid).kit?.items).toEqual(mid);
    expect(repack(weak.sim, mid).kit?.items).toEqual(weak.sim.kit?.items);
  });

  it('reads the young body\'s Strength now, not the stats chosen at creation', () => {
    // A child carries with the arms they have today: the same choices carry more at 14 than at 11.
    const kid = makeWarden({ id: 'w-1872-kid', stats: stats({ str: 12 }), age: 11 }, undefined, ON);
    const older = makeWarden({ id: 'w-1872-older', stats: stats({ str: 12 }), age: 14 }, undefined, ON);
    expect(kid.sim.character.stats.str).toBe(8);
    expect(older.sim.character.stats.str).toBe(9);
    expect(carryLimit(kid.sim)).toBe(11);
    expect(carryLimit(older.sim)).toBe(12);
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
    const n = grownStats(who.stats, DEFAULT_AGE);
    expect(suggestedPack(ON, n, who.chosen)).toEqual(suggestedPack(ON, n, who.chosen));
  });

  it('off, every Warden gets the leader\'s list and 9 kg, whatever their stats', () => {
    for (const str of [7, 10, 13]) {
      const app = makeWarden({ id: `w-1872-off-${str}`, stats: stats({ str }), chosen: ['hardy', 'hunter'] }, undefined, OFF);
      expect(app.sim.kit?.items).toEqual([...SUGGESTED_PACK]);
      expect(carryLimit(app.sim)).toBe(PACK_CAPACITY);
      expect(suggestedPack(OFF, app.sim.character.stats, ['hardy'])).toEqual([...SUGGESTED_PACK]);
    }
  });

  it('a run from before the switch (absent) packs as it did', () => {
    const old = createRegion1({}, undefined, { id: 'w-1872-old', stats: stats({ str: 13 }), pack: [...SUGGESTED_PACK] });
    expect(carryLimit(old)).toBe(PACK_CAPACITY);
    expect(suggestedPackOf(old)).toEqual([...SUGGESTED_PACK]);
    expect(repack(old, HEAVY).kit?.items).toEqual([...SUGGESTED_PACK]);
  });
});

describe('with the pack\'s volume on too (#1871 and #1872, the defaults)', () => {
  // Both switches on: weight is soft (no hard limit), so this switch only shapes the suggested pack;
  // the Warden's words for the weight and the walk's Vigor already follow STR now through #1871's
  // comfortableWeight, the one formula both use.
  const BOTH = ruleFeatures();

  it('a strong and a weak Warden get different packs that close, and the words come from comfortableWeight', () => {
    // Chosen STR 13 and 7 are STR 9 and 3 at 12.
    const strong = makeWarden({ id: 'w-1872-both-s', stats: stats({ str: 13 }) }, undefined, BOTH).sim;
    const weak = makeWarden({ id: 'w-1872-both-w', stats: stats({ str: 7 }) }, undefined, BOTH).sim;
    expect([strong.character.stats.str, weak.character.stats.str]).toEqual([9, 3]);
    const ps = strong.kit!.items, pw = weak.kit!.items;
    expect(ps).toEqual(suggestedPackOf(strong));
    expect(pw).toEqual(suggestedPackOf(weak));
    expect(ps).not.toEqual(pw);
    expect(ps).toContain('hand-axe');
    expect(pw).not.toContain('toilet-paper');
    // Both close: 45 L inside with the default straps, by #1871's own check.
    for (const p of [ps, pw]) expect(packProblem(p, { features: BOTH })).toBeNull();
    // At or under the comfortable weight, so neither costs extra on the walk at the start.
    expect(packWeight(ps)).toBeLessThanOrEqual(comfortableWeight(9));
    expect(packWeight(pw)).toBeLessThanOrEqual(comfortableWeight(3));
    expect([packWalkMult(strong), packWalkMult(weak)]).toEqual([1, 1]);
    // The words are #1871's, from comfortableWeight of STR now: the strong pack feels fine on the
    // strong back, and heavier on the weak one.
    const feel = (kg: number, str: number) => PACK_FEELS.indexOf(packFeel(kg, str));
    expect(feel(packWeight(ps), 9)).toBeLessThanOrEqual(PACK_FEELS.indexOf('good'));
    expect(feel(packWeight(ps), 3)).toBeGreaterThan(feel(packWeight(ps), 9));
    // The AI's turn and the pack screen say them, with the list ticked for this Warden.
    const msg = observePack(strong);
    expect(msg).toContain('THE LIST TICKED FOR YOU');
    expect(msg).toContain(PACK_FEEL_LINE[packFeel(packWeight(ps), 9)]);
    const en = makeT('en');
    const html = packForm(ps, en, false, {}, offeredKit(BOTH), { outside: strong.kit!.outside ?? autoOutside(ps), str: 9, dev: false, forYou: true });
    expect(html).toContain(en(`pack.feel.${packFeel(packWeight(ps), 9)}`));
    expect(html).toContain('TICKED FOR YOU');
  });
});
