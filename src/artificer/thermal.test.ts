/**
 * Acceptance tests for #1770: with `thermal-model`, a night at camp is a heat balance (ISO 11079
 * IREQ in clo, ISO 23537 bag ratings, ASTM F3340 pad R-values, JAG/TI wind chill, a cave at the
 * region's mean annual temperature). One test per Given/When/Then, in the issue's order:
 *
 *   1. Midwinter cave     — −19 °C with wind: a pad of R ≥ 3 and a bag sleep cool or better;
 *                           on bare rock with no pad, cold.
 *   2. Early autumn       — +10 °C: a cave is cooler than a treeline camp.
 *   3. Hilltop and hut    — wind makes the open hilltop colder than its air; a walled hut with a
 *                           fire is warm.
 *   4. Better gear        — a better bag or pad improves the night, in line with its rating.
 *   5. IREQ               — matches the ISO 11079 program within 0.05 clo.
 *   6. Off or absent      — built-warmth and the older behaviour unchanged; the same seed the same run.
 *
 * Plus determinism (no draws), the words and the dev numbers.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRegion1, runAction, runDay, chooseSite, warmth, tonightThermal, type Region1State, type SiteId, type QueueItem } from './region1';
import { FULL_WORLD, type WorldConfig } from './world';
import { nightTemp } from './weather';
import { DEFAULT_CALENDAR, MIDWINTER_AFTER } from './winter';
import { BUILT_WARMTH } from './built-warmth';
import { CAMP_AS_ACTION } from './camp-sites';
import { kitColdCost, type KitState } from './kit';
import { createVitals } from './vitality';
import { makeT } from './i18n';
import { observe } from '../artificer-ai/observe';
import { nightBlock } from '../artificer-app/camp-blocks';
import {
  THERMAL_MODEL, CAVE_TEMP, ASTM_R, BAG_RATING, PAD_R, TEST_CLOTHES, TEST_PAD_R, SLEEP_MET, NIGHT_WORDS,
  ireq, windChillC, bagClo, effectiveClo, insulationHeld, sleeperEnvironment, thermalNight, nightQuality, thermalEffects,
  type NightQuality,
} from './thermal';

const en = makeT('en');
const sv = makeT('sv');

const world = (on: boolean | 'absent', built: boolean | 'absent' = true): WorldConfig => ({
  ...FULL_WORLD, luck: false, accidents: false, encounters: false,
  features: { [CAMP_AS_ACTION]: false, ...(built === 'absent' ? {} : { [BUILT_WARMTH]: built }), ...(on === 'absent' ? {} : { [THERMAL_MODEL]: on }) },
});

/** The deepest midwinter night: a clear one, about −19 °C. */
const MIDWINTER = DEFAULT_CALENDAR.winterDay + MIDWINTER_AFTER;
const kit = (items: KitState['items']): KitState => ({ items, matches: 0, lamp: 0, thermos: 0, stove: 0, sweets: 0, comic: 0 });
/** The scout's three-season bag and foam pad (the pack turns them into a fine bedroll). */
const BAG_AND_PAD: Partial<Region1State> = { kit: kit(['sleeping-bag', 'sleeping-pad']), tools: [{ item: 'bedroll', grade: 'fine' }] };
const BAG_ONLY: Partial<Region1State> = { kit: kit(['sleeping-bag']), tools: [{ item: 'bedroll', grade: 'sound' }] };
const WOOD_HUT: Partial<Region1State> = { tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' } };

function campAt(site: SiteId, on: boolean | 'absent' = true, over: Partial<Region1State> = {}): Region1State {
  const s = chooseSite(runAction(createRegion1({ world: world(on) }, undefined, { id: 'w-astrid' }), 'scout'), site);
  return { ...s, day: MIDWINTER, hoursToday: 0, weatherToday: 'clear', vitals: createVitals(), tools: [], stores: { ...s.stores, rawFood: 10, water: 10, firewood: 40 }, ...over };
}

const RANK: Readonly<Record<NightQuality, number>> = { dangerous: 0, cold: 1, cool: 2, warm: 3 };
const atLeast = (q: NightQuality, floor: NightQuality): boolean => RANK[q] >= RANK[floor];
/** Whether the night, slept through in play, was a cold one (the sim's own line). */
const coldInPlay = (s: Region1State): boolean => runDay(s, []).state.log.slice(s.log.length).some(l => /A cold, broken night/.test(l.text));
const mid = nightTemp(MIDWINTER, 'clear', DEFAULT_CALENDAR);
const midWind = nightTemp(MIDWINTER, 'wind', DEFAULT_CALENDAR);

describe('A night at camp as a heat balance (#1770)', () => {
  it('1. given a midwinter night of −19 °C with wind, a cave with a pad of R ≥ 3 and a bag sleeps cool or better; on bare rock with no pad it is cold', () => {
    expect(mid).toBeCloseTo(-19, 0);
    // The cave's air is the region's constant, whatever the night outside.
    const cave = campAt('cave', true, { ...BAG_AND_PAD, weatherToday: 'wind' });
    const env = sleeperEnvironment(cave, { tempC: -19, weather: 'wind', fire: 0 });
    expect(env.airC).toBe(CAVE_TEMP);
    expect(env.ground.tempC).toBe(CAVE_TEMP);
    expect(env.ground.resistance).toBe(0); // bare rock
    // A pad of R 3 (a self-inflating mat) under the scout's three-season bag.
    const held = { ...insulationHeld(cave), padSI: 3 * ASTM_R };
    const need = ireq(env, SLEEP_MET);
    expect(atLeast(nightQuality(effectiveClo(held, env, SLEEP_MET), need), 'cool')).toBe(true);
    // The scout's own foam pad (R 2) does it too, as played: no cold night.
    expect(atLeast(thermalNight(cave, { tempC: -19, weather: 'wind', fire: 0 }).quality, 'cool')).toBe(true);
    expect(coldInPlay(cave)).toBe(false);
    // On bare rock, no pad: cold (a broken night), not yet dangerous.
    const bare = campAt('cave', true, { ...BAG_ONLY, weatherToday: 'wind' });
    expect(insulationHeld(bare).padR).toBe(0);
    expect(thermalNight(bare, { tempC: -19, weather: 'wind', fire: 0 }).quality).toBe('cold');
    expect(coldInPlay(bare)).toBe(true);
    // The cave asks for no fire at +4 °C: the woodpile is untouched.
    expect(runDay(cave, []).state.stores.firewood).toBe(40);
  });

  it('2. given an early-autumn night of +10 °C, a cave is cooler than a treeline camp', () => {
    const night = { tempC: 10, weather: 'overcast' as const, fire: 0 };
    const cave = thermalNight(campAt('cave', true, { ...BAG_AND_PAD, day: 2 }), night);
    const tree = thermalNight(campAt('tree', true, { ...BAG_AND_PAD, day: 2 }), night);
    expect(cave.env.airC).toBeLessThan(tree.env.airC);
    expect(cave.required.neutral).toBeGreaterThan(tree.required.neutral);
    // Same gear: the margin over what's needed is smaller in the cave.
    expect(cave.heldClo - cave.required.neutral).toBeLessThan(tree.heldClo - tree.required.neutral);
    expect(RANK[cave.quality]).toBeLessThanOrEqual(RANK[tree.quality]);
  });

  it('3. given a hilltop with no shelter in wind, the night is colder than the air suggests; a walled hut with a fire makes it warm', () => {
    const hill = campAt('hill', true, { ...BAG_AND_PAD, weatherToday: 'wind' });
    const windy = thermalNight(hill, { tempC: midWind, weather: 'wind', fire: 1 });
    // Wind chill (JAG/TI 2001): it feels far colder than the air.
    expect(windy.env.feelsC).toBeLessThan(midWind - 8);
    // The same air, still, asks less of you: the wind is what makes it worse.
    const still = ireq({ ...windy.env, windMs: 0.4 }, SLEEP_MET);
    expect(windy.required.min).toBeGreaterThan(still.min);
    expect(windy.quality).toBe('dangerous');
    expect(coldInPlay(hill)).toBe(true);
    // Timber walls, soundly built, with the fire kept in all night: warm.
    const hut = campAt('hill', true, { ...BAG_AND_PAD, ...WOOD_HUT, weatherToday: 'wind' });
    const inHut = thermalNight(hut, { tempC: midWind, weather: 'wind', fire: 1 });
    expect(inHut.env.airC).toBeGreaterThan(midWind + 15);
    expect(inHut.env.windMs).toBeLessThan(windy.env.windMs / 5);
    expect(inHut.quality).toBe('warm');
    expect(coldInPlay(hut)).toBe(false);
    // Without the fire the same hut is a cold night.
    expect(thermalNight(hut, { tempC: midWind, weather: 'wind', fire: 0 }).quality).toBe('cold');
  });

  it('4. given the same camp, a better sleeping bag or pad improves the night, in line with its rating', () => {
    // A bag's insulation follows its ISO 23537 comfort rating: the lower the rating, the more it holds.
    expect(bagClo(BAG_RATING.winter.comfort)).toBeGreaterThan(bagClo(BAG_RATING['three-season'].comfort));
    expect(bagClo(BAG_RATING['three-season'].comfort)).toBeGreaterThan(bagClo(BAG_RATING.summer.comfort));
    // In line with its rating: in the standard's test (still air, a good pad) each bag is warm at
    // its comfort temperature and cold (a broken night, not a dangerous one) at its limit.
    for (const k of Object.keys(BAG_RATING) as (keyof typeof BAG_RATING)[]) {
      const { comfort, limit } = BAG_RATING[k];
      for (const [T, want] of [[comfort, 'warm'], [limit, 'cold']] as const) {
        const env = { airC: T, radiantC: T, windMs: 0.4, rh: 50, ground: { tempC: T, resistance: 0 } };
        const held = effectiveClo({ clothingClo: TEST_CLOTHES, bagClo: bagClo(comfort), padSI: TEST_PAD_R * ASTM_R, permeability: 50 }, env, SLEEP_MET);
        expect(nightQuality(held + 1e-9, ireq(env, SLEEP_MET)), `${k} at ${T} °C`).toBe(want);
      }
    }
    // The same lean-to at the treeline on a −10 °C night with a fire: bag by bag, and pad by pad.
    const camp = campAt('tree', true, { ...BAG_AND_PAD, tier: 1, shelterGrade: 'sound', shelter: { type: 'leanto', walls: null } });
    const env = sleeperEnvironment(camp, { tempC: -10, weather: 'clear', fire: 1 });
    const base = insulationHeld(camp);
    const withBag = (comfort: number): number => effectiveClo({ ...base, bagClo: bagClo(comfort) }, env, SLEEP_MET);
    expect(withBag(BAG_RATING.winter.comfort)).toBeGreaterThan(withBag(BAG_RATING['three-season'].comfort));
    expect(withBag(BAG_RATING['three-season'].comfort)).toBeGreaterThan(withBag(BAG_RATING.summer.comfort));
    const need = ireq(env, SLEEP_MET);
    expect(RANK[nightQuality(withBag(BAG_RATING.winter.comfort), need)]).toBeGreaterThan(RANK[nightQuality(withBag(BAG_RATING['three-season'].comfort), need)]);
    const withPad = (r: number): number => effectiveClo({ ...base, padSI: r * ASTM_R }, env, SLEEP_MET);
    const pads = [0, PAD_R.foam, PAD_R.selfInflating, PAD_R.winterInflatable].map(withPad);
    for (let i = 1; i < pads.length; i++) expect(pads[i]).toBeGreaterThan(pads[i - 1]);
    // Stacked pads add (ASTM F3340): the sit pad under the foam pad helps a little more.
    expect(insulationHeld({ ...camp, kit: kit(['sleeping-bag', 'sleeping-pad', 'sit-pad']) }).padR).toBeGreaterThan(base.padR);
    // Clothes count: the wool underlayer adds to what's held.
    expect(insulationHeld({ ...camp, kit: kit(['sleeping-bag', 'sleeping-pad', 'wool-underlayer']) }).clothingClo).toBeGreaterThan(base.clothingClo);
  });

  it('5. given the IREQ function, it matches the ISO 11079 program within 0.05 clo', () => {
    // The ISO 11079 Annex program (Holmér & Nilsson), as `comf::calcIREQ`, run on these inputs:
    // M (W/m²), ta = tr (°C), va (m/s), rh (%) → IREQ_min, IREQ_neutral (clo). W = 0, w = 0.
    const REF: [number, number, number, number, number, number, number][] = [
      [116, -15, -15, 0.4, 85, 2.525, 2.853],
      [58, -10, -10, 0.4, 80, 5.081, 5.463],
      [70, -20, -20, 1, 80, 5.227, 5.595],
      [90, 0, 0, 0.4, 70, 2.155, 2.498],
      [58, 4, 4, 0.4, 95, 3.190, 3.571],
      [100, -30, -30, 5, 60, 4.378, 4.718],
      [58, -19, -25, 3, 80, 6.479, 6.860],
    ];
    for (const [M, ta, tr, v, rh, min, neutral] of REF) {
      const r = ireq({ airC: ta, radiantC: tr, windMs: v, rh }, M);
      expect(Math.abs(r.min - min), `IREQmin at ${ta} °C, M ${M}`).toBeLessThan(0.05);
      expect(Math.abs(r.neutral - neutral), `IREQneutral at ${ta} °C, M ${M}`).toBeLessThan(0.05);
      expect(r.limit).toBeLessThan(r.min);
    }
    // More wind, colder air or less work each ask more.
    const at = (ta: number, v: number, M: number) => ireq({ airC: ta, radiantC: ta, windMs: v, rh: 80 }, M).min;
    expect(at(-20, 0.4, 70)).toBeGreaterThan(at(-10, 0.4, 70));
    expect(at(-10, 5, 70)).toBeGreaterThan(at(-10, 0.4, 70));
    expect(at(-10, 0.4, 58)).toBeGreaterThan(at(-10, 0.4, 100));
    // JAG/TI 2001 wind chill against its chart: −20 °C at 30 km/h is −33; −10 °C at 20 km/h is −18.
    expect(windChillC(-20, 30 / 3.6)).toBeCloseTo(-32.6, 1);
    expect(windChillC(-10, 20 / 3.6)).toBeCloseTo(-17.9, 1);
    expect(windChillC(-10, 1)).toBe(-10); // below 4.8 km/h it isn't defined
  });

  describe('6. off or absent: built-warmth and the older behaviour unchanged, and the same seed the same run', () => {
    it('reads nothing of the thermal model with the switch off or absent', () => {
      for (const sw of [false, 'absent'] as const) {
        const s = campAt('cave', sw, BAG_AND_PAD);
        expect(tonightThermal(s)).toBeNull();
        expect(nightBlock(s, en, { dev: true })).toBe('');
        expect(observe(s)).not.toContain('NIGHT AT CAMP');
        // The kit's wool and pad still take their share off cold nights, as before.
        expect(kitColdCost({ ...s, kit: kit(['wool-underlayer', 'sleeping-pad']) })).toBeCloseTo(0.85 * 0.9);
        // built-warmth's fraction, as #1763 has it: a cave with a bed.
        expect(warmth(s)).toBeCloseTo(Math.min(1, 0.65 + 0.1));
        // The midwinter cave with a bed and no fire is the old cold night (the fire is what warms it).
        expect(coldInPlay({ ...s, stores: { ...s.stores, firewood: 0 } })).toBe(true);
      }
      // With it on, the wool and pad are insulation instead (not counted twice).
      expect(kitColdCost({ ...campAt('cave', true), kit: kit(['wool-underlayer', 'sleeping-pad']) })).toBe(1);
    });

    it('plays the same seed the same way, on, off and absent (off and absent alike)', () => {
      const plan: QueueItem[] = ['gather', 'wood', 'water'];
      const play = (sw: boolean | 'absent', built: boolean | 'absent' = true): Region1State => {
        const s0 = chooseSite(runAction(createRegion1({ world: world(sw, built) }, undefined, { id: 'w-astrid' }), 'scout'), 'tree');
        let s: Region1State = { ...s0, ...BAG_AND_PAD };
        for (let i = 0; i < 40 && !s.outcome; i++) s = runDay({ ...s, hoursToday: 0 }, plan).state;
        return s;
      };
      expect(play(true)).toEqual(play(true));
      for (const built of [true, false, 'absent'] as const) {
        const off = play(false, built);
        const absent = play('absent', built);
        expect({ ...absent, config: null }).toEqual({ ...off, config: null });
      }
      // On, the nights differ (it is a different rule), so the runs part ways.
      expect({ ...play(true), config: null }).not.toEqual({ ...play(false), config: null });
    });
  });

  it('determinism: pure arithmetic, no draws on the sim\'s streams', () => {
    const src = readFileSync(new URL('./thermal.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from '\.\/rng'|Math\.random|streamFor/);
    const s = campAt('hill', true, { ...BAG_AND_PAD, weatherToday: 'wind' });
    const a = thermalNight(s, { tempC: -12.5, weather: 'wind', fire: 0.5 });
    const b = thermalNight(structuredClone(s), { tempC: -12.5, weather: 'wind', fire: 0.5 });
    expect(a).toEqual(b);
  });

  it('maps the qualities onto the old cold-night effects, in their range', () => {
    const req = { min: 4, neutral: 4.4, limit: 2 };
    expect(thermalEffects({ quality: 'warm', debtWh: 0, heldClo: 5, required: req, env: { airC: -10 } })).toEqual({ warmth: 0.9, coldNight: false, coldShortfall: 0, freeze: 0 });
    expect(thermalEffects({ quality: 'cool', debtWh: 0, heldClo: 4.1, required: req, env: { airC: -10 } }).coldNight).toBe(false);
    const cold = thermalEffects({ quality: 'cold', debtWh: 0, heldClo: 3, required: req, env: { airC: -10 } });
    expect(cold.coldNight).toBe(true);
    expect(cold.coldShortfall).toBeCloseTo(0.25);
    expect(cold.freeze).toBe(0);
    const danger = thermalEffects({ quality: 'dangerous', debtWh: 400, heldClo: 1, required: req, env: { airC: -19 } });
    expect(danger.coldShortfall).toBeCloseTo(0.5);
    expect(danger.freeze).toBe(20); // at most 20, the old rule's fireless night at −15 °C
    expect(danger.warmth).toBeLessThan(0.5); // no healing
    // Never more than the old rule's fireless night at the same air: 8 at −5 °C, 2 above freezing.
    expect(thermalEffects({ quality: 'dangerous', debtWh: 400, heldClo: 1, required: req, env: { airC: -5 } }).freeze).toBeCloseTo(8);
    expect(thermalEffects({ quality: 'dangerous', debtWh: 400, heldClo: 1, required: req, env: { airC: 3 } }).freeze).toBeCloseTo(2);
    // A little past the limit costs a little.
    expect(thermalEffects({ quality: 'dangerous', debtWh: 20, heldClo: 1.9, required: req, env: { airC: -19 } }).freeze).toBeCloseTo(2.5);
  });

  it('says tonight in words to the player (English and Swedish), the numbers in dev mode only, and the clo to the AI', () => {
    const s = campAt('cave', true, BAG_AND_PAD);
    const n = tonightThermal(s)!;
    expect(n).not.toBeNull();
    for (const t of [en, sv]) {
      const page = nightBlock(s, t);
      expect(page).toContain(t(`night.look.${n.quality}`));
      expect(page).not.toMatch(/clo|°C|m\/s/);
      expect(nightBlock(s, t, { dev: true })).toMatch(/IREQ .* clo/);
    }
    expect(nightBlock(s, sv)).toContain('Natten ser');
    const ai = observe(s);
    expect(ai).toContain(`NIGHT AT CAMP (as it stands, with the fire the woodpile allows): ${NIGHT_WORDS[n.quality]} (insulation`);
    expect(ai).toMatch(/clo needed at least/);
    expect(ai).not.toContain('At the sleeper');
  });
});
