/**
 * Acceptance tests for #1823 — raw meat left at camp draws animals unless it's guarded (switch
 * `camp-scavengers`) — built on #1859's combined protection rating. One test per Given/When/Then,
 * #1823's in its order, then #1859's first three (the fourth, determinism and the switch, is #1823's 6):
 *
 *   1. Away         — raw meat in camp, no fire, not stored: on a long trip there's a seeded chance a
 *                      fox or ravens take 25–50% of it, with a journal line (and tracks).
 *   2. At camp      — the same, but the Warden stays at camp that day: nothing is taken by day.
 *   3. The night    — a fire burning through it: near zero; no fire, asleep: half the risk of away.
 *   4. Stored       — Store the meat (hung with cord, or a stone cache): no fox, raven or wolf ever
 *                      gets it; a bear only rarely (the owner: "a bear sometimes gets it"), all of it.
 *   5. Big night    — wolves or a bear take all the unguarded meat; the fright costs Clarity, nobody is hurt.
 *   6. Same seed    — the same thefts; with the switch off or absent nothing changes (the journal is
 *                      the one main played before #1823).
 *
 *   #1859-1. Each guard alone leaves each threat's risk as its row of the table.
 *   #1859-2. Two guards leave the product of the two, below either alone, never zero unless one is full.
 *   #1859-3. The camp view and the observation say the protection word, matching the rating's band.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, endDay, ACTIONS, meatOf, storedMeatOf, type Region1State, type QueueItem } from './region1';
import { shown, visibilityOf } from './action-visibility';
import { scout, survey, createExploration } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { ruleFeatures } from './features';
import { seedOf } from './rng';
import {
  GUARDS, THREATS, NIGHT_BASE, DAY_BASE, BIG_CLARITY, PROTECTION_WORDS, leftover, protectionOf, rollTheft, nightScavengers, storedScavengers, storedTheftLine,
  type Guard,
} from './camp-scavengers';
import { observe } from '../artificer-ai/observe';
import { meatBlock } from '../artificer-app/camp-blocks';
import { simLine } from '../artificer-app/sim-words';
import { makeT } from './i18n';

const svT = makeT('sv'), enT = makeT('en');

/** Daylight, clear weather (no frost, no spoiling), no accidents or encounters, luck on. `absent`: a run from before the switch. */
const world = (on: boolean | 'absent'): WorldConfig => ({
  ...FULL_WORLD, luck: true, accidents: false, darkness: false, weather: 'clear', encounters: false,
  features: { 'action-visibility': true, ...(on === 'absent' ? {} : { 'camp-scavengers': on }) },
});

/**
 * A Warden camped at the treeline who knows the near and far ground, with `meat` raw meat (from a
 * hunt) among the raw food and `firewood` for the night.
 */
function warden(id: string, { meat = 8, firewood = 0, on = true as boolean | 'absent' } = {}): Region1State {
  const s = createRegion1({ world: world(on) }, undefined, { id });
  return {
    ...s, site: s.site ?? 'tree', explore: scout(scout(createExploration(), 1), 2),
    stores: { ...s.stores, rawFood: meat, materials: 0, stone: 0, water: 5, firewood, rations: 2 },
    ...(on === true ? { meat } : {}),
  };
}

const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
/** Meat lost between two states. */
const lost = (a: Region1State, b: Region1State): number => meatOf(a) - meatOf(b);
/** Whether an animal got at the meat (the journal says so: supper eats meat too, so the count alone can't tell). */
const robbed = (s: Region1State): boolean => s.log.some(e => /got at the meat|came into camp in the night/.test(e.text));

describe('Meat left at camp draws animals unless it is guarded (#1823, #1859)', () => {
  it('1. away on a long trip, with no fire and nothing stored: a seeded fox or ravens take 25–50% of the meat, with a journal line', () => {
    let thefts = 0;
    for (const id of ids('w-away', 200)) {
      const s = warden(id);
      const back = runAction(s, 'wood@2');
      const n = lost(s, back);
      // Plants and firewood are no one's business: only the meat (and the raw food it is) goes.
      expect(back.stores.rawFood).toBe(s.stores.rawFood - n);
      expect(back.stores.rations).toBe(s.stores.rations);
      if (n === 0) continue;
      thefts++;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
      const line = back.log.find(e => /got at the meat/.test(e.text))!;
      expect(line.text).toMatch(/^While you were away, (a fox|ravens) got at the meat: \d+ raw food gone, and (its|their) tracks all round camp\.$/);
      expect(line.text).toContain(`${n} raw food gone`);
      expect(simLine(line.text, svT)).toMatch(/räv|korpar/);
      expect(simLine(line.text, svT)).not.toMatch(/raw food/);
    }
    // About one long trip in four (DAY_BASE.small), give or take the sample.
    expect(DAY_BASE.small).toBe(0.25);
    expect(thefts / 200).toBeGreaterThan(0.12);
    expect(thefts / 200).toBeLessThan(0.4);
  });

  it('2. the Warden stays at camp that day: nothing is taken by day', () => {
    // The Warden at camp keeps animals off: by day, nothing gets through.
    for (const th of ['small', 'big'] as const) expect(leftover(['campDay'], DAY_BASE)[th]).toBe(0);
    for (const id of ids('w-home', 200)) {
      const s = warden(id);
      // A day of camp work, rest and a short errand (water close by, 2h: too short for a fox to come in).
      let d = s;
      for (const q of ['tinker', 'rest', 'water', 'rest'] as QueueItem[]) d = runAction(d, q);
      expect(meatOf(d)).toBe(meatOf(s));
      expect(robbed(d)).toBe(false);
    }
  });

  it('3. a fire burning through the night: near zero; no fire, asleep at camp: half the risk of away', () => {
    const away = leftover([], NIGHT_BASE), asleep = leftover(['asleep'], NIGHT_BASE), fire = leftover(['asleep', 'fire'], NIGHT_BASE);
    expect(asleep.small).toBeCloseTo(away.small / 2, 10);
    expect(asleep.big).toBeCloseTo(away.big / 2, 10);
    expect(fire.small + fire.big).toBeLessThan(0.02);
    // In play: 300 nights each, with and without a fire.
    let dark = 0, lit = 0;
    for (const id of ids('w-night', 300)) {
      if (robbed(endDay(warden(id)))) dark++;
      if (robbed(endDay(warden(id, { firewood: 5 })))) lit++;
    }
    expect(dark / 300).toBeGreaterThan(0.08);
    expect(dark / 300).toBeLessThan(0.24);
    expect(lit / 300).toBeLessThan(0.03);
    expect(lit).toBeLessThan(dark / 4);
  });

  it('4. stored safely (Store the meat), no small animal or wolf ever takes it; a bear only rarely', () => {
    expect(ACTIONS.storemeat.name).toBe('Store the meat');
    expect(enT('act.storemeat')).toBe('Store the meat');
    expect(svT('act.storemeat')).toBe('Förvara köttet');
    // Nothing to store it with: greyed, saying what it needs.
    const bare = warden('w-store');
    expect(visibilityOf(bare, 'storemeat').status).toBe('greyed');
    // Cord: hung in a tree. Stone (the best place camp has): a stone cache. Neither is used up.
    const corded = runAction({ ...bare, stores: { ...bare.stores, materials: 2 } }, 'storemeat');
    expect(corded.meatStored).toEqual({ n: 8, place: 'hung' });
    expect(corded.stores.materials).toBe(2);
    const stoned = runAction({ ...bare, stores: { ...bare.stores, materials: 2, stone: 3 } }, 'storemeat');
    expect(stoned.meatStored).toEqual({ n: 8, place: 'cache' });
    expect(stoned.stores.stone).toBe(3);
    // Long trips and fireless nights: no fox, raven or wolf ever gets at stored meat, and rations
    // are never touched. A bear can, rarely: then all of what was put by is gone.
    let bears = 0;
    for (const id of ids('w-stored', 150)) {
      let s = runAction({ ...warden(id), stores: { ...warden(id).stores, materials: 2 } }, 'storemeat');
      s = endDay(runAction(s, 'wood@2'));
      expect(s.log.some(e => /fox|ravens|Wolves/.test(e.text))).toBe(false);
      expect(s.stores.rations).toBe(2);
      if (robbed(s)) { bears++; expect(meatOf(s)).toBe(0); continue; }
      // Only supper (one raw food) came out of it, and what's left is still stored.
      expect(meatOf(s)).toBe(7);
      expect(storedMeatOf(s)).toBe(7);
    }
    expect(bears).toBeLessThanOrEqual(3);
    // The AI's observation and the camp view say it's guarded.
    expect(observe(corded)).toMatch(/MEAT: 8 raw meat hangs out of reach \(hung with cord\) — well protected/);
    expect(meatBlock(corded, enT)).toMatch(/hangs out of reach/);
    expect(meatBlock(corded, svT)).toMatch(/hänger utom räckhåll/);
  });

  it('4b. a bear at the stored meat: rare, its own stream, all of what was put by goes, the fright costs Clarity', () => {
    // Asleep, no fire, the meat hung: a bear's chance is a small fraction of the meat lying out's.
    const risk = leftover(['asleep', 'hung'], NIGHT_BASE);
    expect(risk.small).toBe(0);
    expect(risk.big).toBeGreaterThan(0);
    expect(risk.big).toBeLessThan(leftover(['asleep'], NIGHT_BASE).big / 5);
    const id = ids('w-bear-store', 20000).find(i => storedScavengers(seedOf(i), 1)() < risk.big)!;
    expect(id).toBeDefined();
    const s = { ...warden(id, { meat: 10 }), meatStored: { n: 6, place: 'hung' as const } };
    const night = endDay(s);
    const calm = endDay({ ...s, meat: 4, stores: { ...s.stores, rawFood: 4 }, meatStored: undefined });
    // All six put by are gone; what lay out took its own (separate) chance.
    expect(storedMeatOf(night)).toBe(0);
    expect(night.meatStored).toBeUndefined();
    const line = night.log.find(e => /got at the meat you'd put by/.test(e.text))!.text;
    expect(line).toBe(storedTheftLine(6));
    expect(simLine(line, svT)).toBe('En björn kom in i lägret i natt och kom åt köttet du lagt undan: 6 mat borta.');
    expect(night.vitals.clarity.current).toBeLessThan(calm.vitals.clarity.current);
    expect(night.injuries ?? []).toEqual(calm.injuries ?? []);
  });

  it('5. a rare big-animal night: all unguarded raw meat is gone, the fright costs Clarity, nobody is injured', () => {
    // A night the stream makes big, found from the pure draw (asleep, no fire, as below).
    const risk = leftover(['asleep'], NIGHT_BASE);
    const id = ids('w-big', 3000).find(i => rollTheft(nightScavengers(seedOf(i), 1), 8, risk, true, false)?.big)!;
    expect(id).toBeDefined();
    // Some of the meat hung, some lying out: only what's lying out goes.
    const s = { ...warden(id, { meat: 10 }), meatStored: { n: 2, place: 'hung' as const } };
    const night = endDay(s);
    const calm = endDay({ ...s, meat: 2 });
    expect(meatOf(night)).toBe(2);
    expect(night.stores.rawFood).toBe(2);
    expect(night.vitals.clarity.current).toBeCloseTo(Math.max(0, calm.vitals.clarity.current - BIG_CLARITY), 6);
    expect(night.vitals.condition).toBe(calm.vitals.condition);
    expect(night.injuries ?? []).toEqual(calm.injuries ?? []);
    const line = night.log.find(e => /came into camp in the night/.test(e.text))!.text;
    expect(line).toMatch(/^(Wolves|A bear) came into camp/);
    expect(simLine(line, svT)).toMatch(/Vargar|En björn/);
  });

  it('6. the same seed and moves bring the same thefts; with the switch off or absent nothing changes', () => {
    const days: QueueItem[][] = [['wood@2', 'water', 'rest'], [{ q: 'hunt', opts: { target: 'small' } }, 'wood', 'tinker'], ['traps', 'gather@2', 'rest'], ['hunt', 'preserve', 'rest'], ['wood@2', 'gather']];
    const play = (on: boolean | 'absent'): Region1State => {
      const f: Record<string, boolean> = { ...ruleFeatures() };
      if (on === 'absent') delete f['camp-scavengers']; else f['camp-scavengers'] = on;
      // The journal's hash below was taken before #1876: its trips are the rings', so walking the map is off.
      f['walk-the-map'] = false;
      let s = createRegion1({ world: { ...FULL_WORLD, features: f } }, undefined, { id: 'w-scav-same' });
      s = { ...s, site: s.site ?? 'tree', explore: survey(scout(createExploration(), 1), 1), tools: [...s.tools, { item: 'sling', grade: 'sound' }], stores: { ...s.stores, materials: 10, rawFood: 5, water: 5, firewood: 0 } };
      for (const q of days) s = runDay(s, q).state;
      return s;
    };
    expect(play(true)).toEqual(play(true));
    // On, the hunts' meat is counted; off or absent, nothing is kept and Store the meat isn't there.
    expect(play(true).meat).toBeDefined();
    for (const on of [false, 'absent'] as const) {
      const s = play(on);
      expect(s.meat).toBeUndefined();
      expect(shown(s, 'storemeat')).toBe(false);
      expect(observe(s)).not.toMatch(/MEAT:/);
      expect(meatBlock(s, enT)).toBe('');
      // The journal's hash was taken on main before this change.
      expect(seedOf(JSON.stringify(s.log))).toBe(1598564469);
    }
  });

  it('#1859-1. each guard alone leaves each threat as its row of the table', () => {
    const table: Record<Guard, [number, number, number]> = {
      campDay: [0, 0, 1], asleep: [0.5, 0.5, 1], fire: [0.1, 0.02, 0.8], hung: [0, 0.1, 0.2], cache: [0, 0.1, 0.2], preserved: [0, 0, 0],
      // #1857's lidded pit and #1858's walls (region1-pit-lid-walls.test.ts says why these numbers).
      lidded: [0, 0.25, 0.5], walled: [0, 0, 1],
    };
    for (const [g, row] of Object.entries(table) as [Guard, [number, number, number]][]) {
      expect(leftover([g])).toEqual({ small: row[0], big: row[1], vermin: row[2] });
      // Against a base risk, it scales it.
      expect(leftover([g], NIGHT_BASE).small).toBeCloseTo(NIGHT_BASE.small * row[0], 12);
    }
  });

  it('#1859-2. two guards leave the product of the two, below either alone, never zero unless one is full', () => {
    const guards = Object.keys(GUARDS) as Guard[];
    for (const a of guards) for (const b of guards) {
      if (a === b) continue;
      const both = leftover([a, b]);
      for (const th of THREATS) {
        expect(both[th]).toBeCloseTo(GUARDS[a][th] * GUARDS[b][th], 12);
        expect(both[th]).toBeLessThanOrEqual(Math.min(GUARDS[a][th], GUARDS[b][th]));
        expect(both[th] === 0).toBe(GUARDS[a][th] === 0 || GUARDS[b][th] === 0);
      }
    }
    // Asleep with a fire beats either.
    expect(leftover(['asleep', 'fire']).small).toBeLessThan(leftover(['fire']).small);
  });

  it('#1859-3. the camp view and the observation say the protection word, matching the rating', () => {
    expect(protectionOf([])).toBe('open');
    expect(protectionOf(['asleep'])).toBe('fair');
    expect(protectionOf(['asleep', 'fire'])).toBe('well');
    expect(protectionOf(['hung'])).toBe('well');
    expect(protectionOf(['preserved'])).toBe('secure');
    // Meat lying out: away it lies open; tonight, asleep without a fire, fairly safe; with one, well protected.
    const open = warden('w-word');
    expect(observe(open)).toMatch(/MEAT: 8 raw meat lies in camp — while you're away: lies open · tonight \(asleep\): fairly safe/);
    expect(observe(warden('w-word', { firewood: 5 }))).toMatch(/tonight \(asleep, a fire\): well protected/);
    for (const t of [enT, svT]) {
      const html = meatBlock(open, t);
      expect(html).toContain(t('meat.prot.open'));
      expect(html).toContain(t('meat.prot.fair'));
      expect(html).not.toMatch(/\d+ ?%/);
    }
    expect(PROTECTION_WORDS.open).toBe(enT('meat.prot.open'));
    expect(svT('meat.prot.open')).toBe('ligger öppet');
    expect(svT('meat.prot.secure')).toBe('säkert');
    // No meat: nothing to say.
    expect(meatBlock(warden('w-word', { meat: 0 }), enT)).toBe('');
  });
});
