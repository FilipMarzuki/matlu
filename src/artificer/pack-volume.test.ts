/**
 * Acceptance tests for #1871 (switch `pack-volume`): every kit item has a size in litres and the
 * scout's pack holds 45 L inside; some things strap on the outside, on a few strap places; and the
 * pack's weight is the Warden's own opinion in words, soft instead of a hard limit, with a heavy
 * pack costing extra Vigor on the walk until camp is made. One test per Given/When/Then of the
 * issue (1–5) and the owner's added scenario (6), in order, then the save.
 */

import { describe, it, expect } from 'vitest';
import {
  KIT, KIT_IDS, SUGGESTED_PACK, PACK_CAPACITY, PACK_VOLUME, PACK_LITRES, STRAP_PLACES, PACK_FEELS,
  packWeight, packProblem, validPack, insideLitres, canStrap, autoOutside, addToPack, placeItem,
  packFeel, comfortableWeight, heavyWalkMult, readKit, type KitId,
} from './kit';
import { createRegion1, repack, runAction, chooseSite, type Region1State } from './region1';
import { FULL_WORLD } from './world';
import { createVitals } from './vitality';
import { FEATURES, ruleFeatures } from './features';
import { makeT } from './i18n';
import { packForm } from '../artificer-app/opening-view';
import { esc } from '../artificer-app/html';
import { serialize, deserialize } from '../artificer-app/controller';
import { startProblem, startOf } from '../artificer-play/web-run';

const en = makeT('en'), sv = makeT('sv');
const ON = { volume: true } as const;
/** Weight only: with `pack-extras` off these odd things do nothing but weigh (and take room). */
const STONES: KitId[] = ['smooth-stones', 'dumbbells', 'garden-gnome', 'roller-skate'];

/** A Warden whose world has only `pack-volume` set (on, off, or absent), with no accidents to roll. */
function warden(on: boolean | 'absent', pack: KitId[], outside?: KitId[]): Region1State {
  const features: Record<string, boolean> = on === 'absent' ? {} : { [PACK_VOLUME]: on };
  return createRegion1({ world: { ...FULL_WORLD, accidents: false, features } }, undefined, { id: 'w-pack-volume', pack, ...(outside ? { outside } : {}) });
}

/** Vigor spent by a ring-2 gathering trip (a walk out and back) from fresh vitals, after a scout. */
function tripVigor(s: Region1State): number {
  const ready = { ...runAction(s, 'scout'), hoursToday: 0, vitals: createVitals() };
  return ready.vitals.vigor.current - runAction(ready, 'gather@2').vitals.vigor.current;
}

describe('The pack has a volume, some things strap outside, and the Warden says how heavy it feels (#1871)', () => {
  it('registers `pack-volume` as an experimental rules switch, on by default and off for runs from before it', () => {
    expect(FEATURES.find(f => f.id === PACK_VOLUME)).toMatchObject({ kind: 'rules', stage: 'experimental', default: true, absent: false, issue: 1871 });
    expect(ruleFeatures()[PACK_VOLUME]).toBe(true);
    expect(PACK_LITRES).toBe(45);
    expect(STRAP_PLACES).toBeGreaterThanOrEqual(3);
    expect(STRAP_PLACES).toBeLessThanOrEqual(4);
    // Every item has a size; a sleeping bag is bulky and a knife tiny.
    for (const k of KIT) expect(k.litres).toBeGreaterThan(0);
    expect(KIT.find(k => k.id === 'sleeping-bag')!.litres).toBeGreaterThan(10 * KIT.find(k => k.id === 'mora-knife')!.litres);
    // The leader's list fits, with the pad and the sit pad strapped on by default.
    expect(autoOutside(SUGGESTED_PACK)).toEqual(expect.arrayContaining(['sleeping-pad', 'sit-pad']));
    expect(validPack(SUGGESTED_PACK, ON)).toBe(true);
    expect(insideLitres(SUGGESTED_PACK, autoOutside(SUGGESTED_PACK))).toBeLessThanOrEqual(PACK_LITRES);
  });

  // 1. Given items whose litres exceed the pack's inside volume, then they can't all go inside, and the screen says it won't close.
  it('1: more litres than the pack holds can\'t all go inside, and the screen says it won\'t close', () => {
    const big: KitId[] = [...SUGGESTED_PACK, 'home-pillow', 'accordion'];
    expect(insideLitres(big, [])).toBeGreaterThan(PACK_LITRES);
    expect(packProblem(big, { volume: true, outside: [] })).toMatch(/won't close/);
    expect(validPack(big, { volume: true, outside: [] })).toBe(false);
    // Tapping one more thing into a pack that's nearly full is refused.
    const nearly: KitId[] = [...SUGGESTED_PACK, 'home-pillow'];
    expect(validPack(nearly, ON)).toBe(true);
    expect(addToPack(nearly, autoOutside(nearly), 'accordion')).toBeNull();
    // The screen: the accordion greyed, and the room said in words.
    for (const t of [en, sv]) {
      const html = packForm(nearly, t, false, {}, { outside: autoOutside(nearly), str: 10, dev: false });
      expect(html).toMatch(/data-kit="accordion"[^>]*disabled/);
      expect(html).toContain(esc(t('pack.wontClose')));
    }
    expect(en('pack.wontClose')).toMatch(/won't close/);
  });

  // 2. Given an `outside` item, then it can be strapped on without using inside volume, up to the strap places, and still weighs.
  it('2: an outside item straps on without using inside room, up to the strap places, and still weighs', () => {
    const pack: KitId[] = ['sleeping-bag', 'family-tent'];
    expect(canStrap('family-tent')).toBe(true);
    expect(insideLitres(pack, ['family-tent'])).toBe(insideLitres(['sleeping-bag'], []));
    expect(packWeight(pack)).toBeCloseTo(KIT.find(k => k.id === 'sleeping-bag')!.weight + KIT.find(k => k.id === 'family-tent')!.weight, 5);
    // The strap places run out: one more outside than there are places won't do.
    const strappable = KIT.filter(k => k.outside).map(k => k.id);
    expect(strappable.length).toBeGreaterThan(STRAP_PLACES);
    expect(validPack(strappable, { volume: true, outside: strappable.slice(0, STRAP_PLACES) })).toBe(true);
    expect(packProblem(strappable, { volume: true, outside: strappable.slice(0, STRAP_PLACES + 1) })).toMatch(/strap/);
    expect(placeItem(strappable, strappable.slice(0, STRAP_PLACES), strappable[STRAP_PLACES], true)).toBeNull();
    // And the screen lets you choose: inside or strapped on, for those items.
    const html = packForm(['sleeping-pad'], en, false, {}, { outside: ['sleeping-pad'], str: 10, dev: false });
    expect(html).toMatch(/data-kitplace="sleeping-pad" data-place="out" aria-pressed="true"/);
    expect(html).toMatch(/data-kitplace="sleeping-pad" data-place="in" aria-pressed="false"/);
  });

  // 3. Given a non-`outside` item, then it can only go inside.
  it('3: a thing that can\'t be strapped on only goes inside', () => {
    expect(canStrap('accordion')).toBe(false);
    expect(packProblem(['accordion'], { volume: true, outside: ['accordion'] })).toMatch(/strapped/);
    expect(placeItem(['accordion'], [], 'accordion', true)).toBeNull();
    // No strap choice is drawn for it.
    expect(packForm(['accordion', 'kasa'], en, false, {}, { outside: [], str: 10, dev: false })).not.toContain('data-kitplace="accordion"');
  });

  // 4. Given pack weights across the range, the line steps through the words in order, shows no numbers, and STR moves the steps up.
  it('4: the Warden\'s words step through in order with the weight, never show a number, and a stronger Warden says them later', () => {
    const steps = (str: number) => Array.from({ length: 141 }, (_, i) => PACK_FEELS.indexOf(packFeel(i * 0.25, str)));
    for (const str of [3, 6, 10, 15, 18]) {
      const s = steps(str);
      // In order, never back down as it gets heavier, from the first word to the last.
      for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThanOrEqual(s[i - 1]);
      expect(s[0]).toBe(0);
      expect(s.at(-1)).toBe(PACK_FEELS.length - 1);
      expect(new Set(s).size).toBe(PACK_FEELS.length);
    }
    // A stronger Warden is never more bothered by the same weight, and at some weight less.
    const weak = steps(6), strong = steps(15);
    expect(strong.every((v, i) => v <= weak[i])).toBe(true);
    expect(strong.some((v, i) => v < weak[i])).toBe(true);
    expect(comfortableWeight(15)).toBeGreaterThan(comfortableWeight(6));
    // …only a little: within a couple of kilograms of today's 9 kg.
    expect(Math.abs(comfortableWeight(15) - PACK_CAPACITY)).toBeLessThan(2.5);
    // The words, in both languages, with no digits; and none on the pack screen without dev mode.
    for (const t of [en, sv]) {
      for (const f of PACK_FEELS) { expect(t(`pack.feel.${f}`)).not.toMatch(/\d/); expect(t(`pack.feel.${f}`)).not.toBe(`pack.feel.${f}`); }
      const pack: KitId[] = [...SUGGESTED_PACK, ...STONES];
      const html = packForm(pack, t, false, {}, { outside: autoOutside(pack), str: 6, dev: false });
      expect(html).toContain(esc(t(`pack.feel.${packFeel(packWeight(pack), 6)}`)));
      expect(html.replace(/<[^>]*>/g, ' ')).not.toMatch(/\d\s*kg/);
      // In dev mode the kilograms show.
      expect(packForm(pack, t, false, {}, { outside: autoOutside(pack), str: 6, dev: true }).replace(/<[^>]*>/g, ' ')).toMatch(/\d\s*kg/);
    }
    expect(en(`pack.feel.${PACK_FEELS[0]}`)).toBe('Light as anything.');
    expect(sv(`pack.feel.${PACK_FEELS[0]}`)).toBe('Lätt som en fjäder.');
  });

  // 5. Given the same pack, then the same start; with the switch off or absent, the pack works as today.
  it('5: the same pack makes the same start, and with the switch off or absent the pack is today\'s 9 kg limit with no volume', () => {
    const heavy: KitId[] = [...SUGGESTED_PACK, ...STONES];
    expect(packWeight(heavy)).toBeGreaterThan(PACK_CAPACITY);
    expect(warden(true, heavy)).toEqual(warden(true, heavy));
    // On: heavy is allowed (weight is soft), and where things go is kept in the kit.
    expect(validPack(heavy, ON)).toBe(true);
    expect(warden(true, [...SUGGESTED_PACK]).kit?.outside).toEqual(autoOutside(SUGGESTED_PACK));
    expect(repack(warden(true, [...SUGGESTED_PACK]), heavy).kit?.items).toEqual(heavy);
    for (const off of [false, 'absent'] as const) {
      const s = warden(off, [...SUGGESTED_PACK]);
      // No placement is kept, and a pack over 9 kg is refused as before…
      expect(s.kit?.outside).toBeUndefined();
      expect(repack(s, heavy)).toBe(s);
      expect(packProblem(heavy)).toMatch(/^too heavy/);
      // …while volume means nothing: a pack bigger than 45 L but under 9 kg still goes.
      const bulky: KitId[] = ['home-pillow', 'board-game', 'pillow', 'flamingo', 'lots-of-socks', 'big-bag-sweets', 'hairdryer', 'roller-skate', 'garden-gnome', 'rice', 'sleeping-pad'];
      expect(insideLitres(bulky, [])).toBeGreaterThan(PACK_LITRES);
      expect(packWeight(bulky)).toBeLessThanOrEqual(PACK_CAPACITY);
      expect(validPack(bulky)).toBe(true);
      expect(repack(s, bulky).kit?.items).toEqual(bulky);
      // And a light pack's trip costs what it always did.
      expect(tripVigor(s)).toBe(tripVigor(warden(true, [...SUGGESTED_PACK])));
    }
  });

  // 6. Given a pack above the comfortable weight, walking costs more Vigor until camp is made, more the heavier; at or below, nothing extra.
  it('6: a pack over the comfortable weight costs extra Vigor on the walk, more the heavier, until camp is made', () => {
    const light = warden(true, [...SUGGESTED_PACK]);
    expect(packWeight(SUGGESTED_PACK)).toBeLessThanOrEqual(comfortableWeight(light.character.stats.str));
    const heavy = warden(true, [...SUGGESTED_PACK, 'smooth-stones', 'dumbbells']);
    const heavier = warden(true, [...SUGGESTED_PACK, ...STONES]);
    expect(packWeight(heavy.kit!.items)).toBeGreaterThan(comfortableWeight(heavy.character.stats.str));
    expect(heavyWalkMult(packWeight(SUGGESTED_PACK), 10)).toBe(1);
    expect(heavyWalkMult(comfortableWeight(10), 10)).toBe(1);
    const base = tripVigor(light);
    expect(tripVigor(heavy)).toBeGreaterThan(base);
    expect(tripVigor(heavier)).toBeGreaterThan(tripVigor(heavy));
    // At camp the pack is set down: the same trip costs what a light pack's does.
    const camped = (s: Region1State) => ({ ...chooseSite(runAction(s, 'scout'), 'cave'), hoursToday: 0, vitals: createVitals() });
    const vig = (s: Region1State) => s.vitals.vigor.current - runAction(s, 'gather@2').vitals.vigor.current;
    expect(camped(heavier).site).not.toBeNull();
    expect(vig(camped(heavier))).toBe(vig(camped(light)));
    // Off, the same heavy pack (were it allowed) costs nothing extra: the rule is the switch's.
    expect(tripVigor({ ...heavier, config: { ...heavier.config, world: { ...heavier.config.world, features: { [PACK_VOLUME]: false } } } })).toBe(base);
  });

  it('the play API checks a web run\'s pack by the same rules, and replays its straps', () => {
    const on = ruleFeatures(), off = ruleFeatures({ [PACK_VOLUME]: false });
    const heavy: KitId[] = [...SUGGESTED_PACK, ...STONES];
    const start = (features: Record<string, boolean>, pack: KitId[], outside?: KitId[]) => ({ id: 'w-pack-api', pack, ...(outside ? { outside } : {}), features, heirlooms: null });
    expect(startProblem(start(on, heavy))).toBeNull();
    expect(startProblem(start(off, heavy))).toMatch(/fits/);
    expect(startProblem(start(on, ['accordion'], ['accordion']))).toMatch(/fits/);
    expect(startProblem(start(on, [...SUGGESTED_PACK, 'home-pillow', 'accordion'], []))).toMatch(/fits/);
    const app = startOf(start(on, ['tarp', 'kasa', 'sleeping-bag'], ['sleeping-bag']));
    expect(app.sim.kit?.outside).toEqual(['sleeping-bag']);
    // …and the save keeps it.
    expect(deserialize(serialize(app))?.sim.kit?.outside).toEqual(['sleeping-bag']);
  });

  it('keeps where things went in the save, checked on load', () => {
    const feats = { [PACK_VOLUME]: true };
    const kit = warden(true, [...SUGGESTED_PACK]).kit!;
    expect(readKit(JSON.parse(JSON.stringify(kit)), feats)).toEqual(kit);
    // A strapped thing that wasn't packed, can't be strapped on, or too many: dropped, and the pack still fits inside.
    expect(readKit({ ...kit, outside: ['accordion'] }, feats)?.outside).toBeUndefined();
    expect(readKit({ ...kit, outside: ['tarp'] }, feats)?.outside).toBeUndefined();
    expect(readKit({ ...kit, outside: 'sleeping-pad' }, feats)?.outside).toBeUndefined();
    // A heavy pack loads with the switch on, and not off (today's rule).
    const heavy = warden(true, [...SUGGESTED_PACK, ...STONES]).kit!;
    expect(readKit(heavy, feats)?.items).toEqual(heavy.items);
    expect(readKit(heavy)).toBeUndefined();
    // Off, a placement is never kept.
    expect(readKit(kit, { [PACK_VOLUME]: false })?.outside).toBeUndefined();
    expect(KIT_IDS.length).toBe(KIT.length);
  });
});
