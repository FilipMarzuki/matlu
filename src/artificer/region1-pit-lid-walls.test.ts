/**
 * Acceptance tests for #1857 (a lid for the cold pit, switch `cold-pit-lid`) and #1858 (meat kept in
 * a walled shelter is safe from everything but mice, switch `walled-larder`), both built on #1823's
 * scavengers and #1859's protection rating. One test per Given/When/Then, as the owner's comments
 * updated them:
 *
 * #1857
 *   1. Lidded, away   — a lidded cold pit holding raw meat, the Warden away with no fire: no fox, raven
 *                        or wolf takes any of it.
 *   2. Bear           — on a rare bear night the lidded pit can still be raided, at a lower chance than
 *                        meat lying out and no more often than hung meat (tuned to equal it, so Store
 *                        the meat's pit-first order never picks a worse place); never in winter.
 *   3. Mice           — over many seeded nights mice sometimes take a small share from the pit, less
 *                        often than behind walls (#1858), never more than a small share.
 *   4. Store the meat — with a lidded pit, the meat goes in the pit up to what it holds and the rest is
 *                        hung or cached as before. There's no separate action.
 *   5. No pit         — the lid can't be made ("dig a cold pit first").
 *   6. Same seed      — the same results; with the switch off or absent nothing changes (with #1858-5).
 *
 * #1858
 *   1. Walls          — a walled shelter at camp, raw meat in it, the Warden away all day with no fire:
 *                        no fox, raven, wolf or bear takes any of it.
 *   2. Mice           — over many seeded nights, mice sometimes take 5–10% of the loose raw meat, never
 *                        more, with a journal line.
 *   3. Put by         — hung meat and smoked or dried rations: mice take nothing; the lidded pit, less.
 *   4. Roof only      — a lean-to or brush hut, no walls: #1823's risks apply unchanged.
 *   5. Same seed      — the same nibbles; with the switch off or absent nothing changes.
 *   6. Determinism    — string-keyed seeds only, each draw from a stream of its own.
 *   7. Mice come late — a camp made fewer than 4 days ago at its site: mice never take anything.
 *   8. Then more      — the nightly chance rises with days at the site up to a cap; moving camp sets
 *                        it back to zero.
 *
 * And the views: the camp view and the AI's observation say the meat is behind walls or in the lidded
 * pit, in #1859's protection words; and the save keeps the new fields only with the switch on.
 */

import { describe, it, expect } from 'vitest';
import {
  createRegion1, runAction, runDay, endDay, chooseSite, blockedReason, ACTIONS, placeGuard, meatOf, storedMeatOf, openMeatOf, pitMeatOf, hungMeatOf, campDaysOf, miceAbout, coldPitHolds,
  type Region1State, type QueueItem, type SiteId,
} from './region1';
import { visibilityOf, shown } from './action-visibility';
import { scout, survey, createExploration } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { ruleFeatures } from './features';
import { seedOf, streamFor } from './rng';
import { seasonOf } from './winter';
import {
  GUARDS, NIGHT_BASE, MICE_CAP, MICE_FREE_DAYS, MICE_RAMP, LID_COST, LID_LINE, leftover, protectionOf, miceChance, rollNibble, miceLine, pitMiceLine, pitTheftLine,
  pitScavengers, verminScavengers, pitVerminScavengers, nightScavengers, storedScavengers,
} from './camp-scavengers';
import { validSiteBuilds } from './camp-builds';
import { observe } from '../artificer-ai/observe';
import { meatBlock } from '../artificer-app/camp-blocks';
import { simLine } from '../artificer-app/sim-words';
import { makeWarden, serialize, deserialize } from '../artificer-app/controller';
import { makeT } from './i18n';

const svT = makeT('sv'), enT = makeT('en');

type Sw = boolean | 'absent';
const sw = (id: string, on: Sw): Record<string, boolean> => (on === 'absent' ? {} : { [id]: on });

/** Daylight, clear weather (no frost, no spoiling), no accidents or encounters, luck on, the scavengers on. */
const world = (lid: Sw, walls: Sw): WorldConfig => ({
  ...FULL_WORLD, luck: true, accidents: false, darkness: false, weather: 'clear', encounters: false,
  features: { 'action-visibility': true, 'camp-scavengers': true, ...sw('cold-pit-lid', lid), ...sw('walled-larder', walls) },
});

interface Camp {
  meat?: number; firewood?: number; materials?: number; stone?: number; rations?: number;
  /** A cold pit at camp with its lid on, and the meat already in it. */
  lidded?: boolean; pitMeat?: number;
  /** The shelter: walls (tier 2), a roof only (tier 1), or none. */
  shelter?: 'walls' | 'roof' | 'none';
  /** The days camp has stood at its site (siteDay that many days back). */
  age?: number; site?: SiteId; lid?: Sw; walls?: Sw;
}

/** A Warden camped at `site` who knows the near and far ground, with `meat` raw meat (from a hunt) and nothing else to eat but rations. */
function warden(id: string, c: Camp = {}): Region1State {
  const { meat = 8, firewood = 0, materials = 0, stone = 0, rations = 2, lidded = false, pitMeat = 0, shelter = 'none', age = 0, site = 'tree', lid = true, walls = true } = c;
  const s = createRegion1({ world: world(lid, walls) }, undefined, { id });
  return {
    ...s, site, siteDay: s.day - age, explore: scout(scout(createExploration(), 1), 2),
    stores: { ...s.stores, rawFood: meat, materials, stone, water: 5, firewood, rations },
    meat,
    ...(lidded ? { coldPitAt: site, pitLid: true as const } : {}),
    ...(pitMeat ? { meatPit: pitMeat } : {}),
    ...(shelter === 'walls' ? { tier: 2 as const, shelterGrade: 'sound' as const, shelter: { type: 'leanto' as const, walls: 'timber' as const } }
      : shelter === 'roof' ? { tier: 1 as const, shelterGrade: 'sound' as const, shelter: { type: 'leanto' as const, walls: null } } : {}),
  };
}

const ids = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
const said = (s: Region1State, re: RegExp): boolean => s.log.some(e => re.test(e.text));
/** A fox, ravens, wolves or a bear at the meat (#1823's lines, and the pit's bear). */
const THIEVES = /got at the meat|came into camp in the night/;
const MICE = /^Mice /;
/** A long trip away (the far ring's wood) and the fireless night after it. */
const awayAndNight = (s: Region1State): Region1State => endDay(runAction(s, 'wood@2'));

describe('A lid for the cold pit (#1857)', () => {
  it('1. a lidded cold pit holding raw meat, the Warden away with no fire: no fox, raven or wolf takes any of it', () => {
    // The table: nothing small gets past the stones, and the big part is only ever a bear (raidPit).
    expect(GUARDS.lidded.small).toBe(0);
    let open = 0;
    for (const id of ids('w-lid-away', 120)) {
      const s = awayAndNight(warden(id, { lidded: true, pitMeat: 8 }));
      expect(said(s, /fox|ravens|Wolves/)).toBe(false);
      if (said(s, /heaved the stones off the cold pit/)) continue;
      // Only supper (one raw food) came out of it, and the rest is still in the pit.
      expect(meatOf(s)).toBe(7);
      expect(pitMeatOf(s)).toBe(7);
      // The same meat lying out, for comparison: it does get taken.
      if (said(awayAndNight(warden(id)), THIEVES)) open++;
    }
    expect(open).toBeGreaterThan(10);
  });

  it('2. a rare bear night: the lidded pit can still be raided, at a lower chance than meat lying out, never in winter', () => {
    // A bear gets into the pit no more often than it pulls hung meat down, and less often than it
    // takes meat lying out (the owner left the chance "to tune"; tuned to equal hung meat's).
    const lying = leftover(['asleep'], NIGHT_BASE).big, pit = leftover(['asleep', 'lidded'], NIGHT_BASE).big;
    expect(GUARDS.lidded.big).toBeLessThanOrEqual(GUARDS.hung.big);
    expect(pit).toBeLessThanOrEqual(leftover(['asleep', 'hung'], NIGHT_BASE).big);
    expect(pit).toBeLessThan(lying);
    expect(pit).toBeGreaterThan(0);
    const s0 = warden('w-probe');
    expect(seasonOf(s0.day, s0.config.calendar)).not.toBe('winter');
    const id = ids('w-pit-bear', 20000).find(i => pitScavengers(seedOf(i), s0.day)() < pit)!;
    expect(id).toBeDefined();
    const s = warden(id, { lidded: true, pitMeat: 8 });
    const night = endDay(s);
    const calm = endDay({ ...s, pitLid: undefined, coldPitAt: null, meatPit: undefined, meat: 0 });
    // Supper took one; the bear all the rest of the pit's meat.
    expect(pitMeatOf(night)).toBe(0);
    expect(night.meatPit).toBeUndefined();
    const line = night.log.find(e => /heaved the stones off the cold pit/.test(e.text))!.text;
    expect(line).toBe(pitTheftLine(7));
    expect(simLine(line, svT)).toBe('En björn kom in i lägret i natt, vältrade stenarna av kylgropen och slet bort locket: 7 mat borta.');
    expect(night.vitals.clarity.current).toBeLessThan(calm.vitals.clarity.current);
    expect(night.injuries ?? []).toEqual(calm.injuries ?? []);
    // In winter the bear is asleep: the same kind of draw raids nothing.
    let w = s0.day;
    while (seasonOf(w, s0.config.calendar) !== 'winter') w++;
    const wid = ids('w-pit-bear-winter', 20000).find(i => pitScavengers(seedOf(i), w)() < pit)!;
    const winter = endDay({ ...warden(wid, { lidded: true, pitMeat: 8 }), day: w });
    expect(said(winter, /heaved the stones/)).toBe(false);
  });

  it('3. over many seeded nights, mice sometimes take a small share from the pit, less often than behind walls, never more than that', () => {
    // Half #1858's rate (the owner): the lid lets half the vermin through that walls do.
    expect(GUARDS.lidded.vermin).toBe(GUARDS.walled.vermin / 2);
    let inPit = 0, behindWalls = 0;
    for (const id of ids('w-pit-mice', 200)) {
      const pit = endDay(warden(id, { lidded: true, pitMeat: 8, age: 20 }));
      const k = pitMeatOf(warden(id, { lidded: true, pitMeat: 8 })) - 1 - pitMeatOf(pit);
      if (said(pit, /^Mice got into the cold pit/)) {
        inPit++;
        // A small share of the seven left after supper: a tenth, rounded up to a whole piece.
        expect(k).toBe(1);
        expect(pit.log.find(e => MICE.test(e.text))!.text).toBe(pitMiceLine(1));
      } else if (!said(pit, /heaved the stones/)) expect(k).toBe(0);
      if (said(endDay(warden(id, { shelter: 'walls', age: 20 })), /^Mice have been at the meat/)) behindWalls++;
    }
    expect(inPit).toBeGreaterThan(0);
    expect(inPit).toBeLessThan(behindWalls);
    expect(simLine(pitMiceLine(1), svT)).toBe('Möss tog sig in i kylgropen genom springorna i locket: 1 mat borta.');
  });

  it('2b. with the default switches, the lidded pit is rated at least as well as hung meat, so Store the meat never picks a worse place', () => {
    const rank = { open: 0, fair: 1, well: 2, secure: 3 } as const;
    for (const age of [0, 20]) {
      const w = warden(`w-pit-word-${age}`, { lidded: true, pitMeat: 8, age });
      const s: Region1State = { ...w, config: { ...w.config, world: { ...w.config.world, features: ruleFeatures() } } };
      expect(pitMeatOf(s)).toBe(8);
      const pitWord = protectionOf([placeGuard('pit')], miceAbout(s)), hungWord = protectionOf([placeGuard('hung')]);
      expect(rank[pitWord]).toBeGreaterThanOrEqual(rank[hungWord]);
    }
  });

  it('4. with a lidded pit, Store the meat puts the meat in the pit up to what it holds, the rest hung or cached; no separate action', () => {
    // There's one storing action, and the lid is a place it uses, not an action of its own.
    expect(Object.keys(ACTIONS).filter(k => /store/i.test(k))).toEqual(['storemeat']);
    // 12 raw meat at the treeline (the pit holds 8), cord for the rest: 8 in the pit, 4 hung.
    expect(coldPitHolds('tree')).toBe(8);
    const corded = runAction(warden('w-lid-store', { meat: 12, lidded: true, materials: 2 }), 'storemeat');
    expect(corded.meatPit).toBe(8);
    expect(corded.meatStored).toEqual({ n: 4, place: 'hung' });
    expect([pitMeatOf(corded), hungMeatOf(corded), openMeatOf(corded)]).toEqual([8, 4, 0]);
    const stored = (x: Region1State): string => x.log.find(e => /^Put \d+ raw meat in the cold pit/.test(e.text))!.text;
    expect(stored(corded)).toBe('Put 8 raw meat in the cold pit, under its lid and the stones, and hung 4 more high in a tree with cord.');
    expect(simLine(stored(corded), svT)).toBe('Lade 8 rått kött i kylgropen, under locket och stenarna, och hängde 4 till högt upp i ett träd med snöre.');
    // With stone too, the rest goes under a cache (the next best place), and nothing is used up.
    const stoned = runAction(warden('w-lid-store', { meat: 12, lidded: true, materials: 2, stone: 3 }), 'storemeat');
    expect(stoned.meatStored).toEqual({ n: 4, place: 'cache' });
    expect([stoned.stores.materials, stoned.stores.stone]).toEqual([2, 3]);
    // At the river the pit holds 12: all of it goes in, and the pit alone is enough to store with.
    const river = runAction(warden('w-lid-store', { meat: 12, lidded: true, site: 'river' }), 'storemeat');
    expect([river.meatPit, river.meatStored]).toEqual([12, undefined]);
    expect(simLine(stored(river), svT)).toBe('Lade 12 rått kött i kylgropen, under locket och stenarna.');
    // Nothing for the rest: the pit takes what it holds, and the rest still lies out.
    const full = runAction(warden('w-lid-store', { meat: 12, lidded: true }), 'storemeat');
    expect([pitMeatOf(full), openMeatOf(full)]).toEqual([8, 4]);
    expect(simLine(stored(full), svT)).toBe('Lade 8 rått kött i kylgropen, under locket och stenarna. Resten får inte plats.');
    // A pit with no lid isn't a place to store meat: as #1823, cord or stone or nothing.
    const unlidded = warden('w-lid-store', { meat: 12 });
    expect(blockedReason({ ...unlidded, coldPitAt: 'tree' }, 'storemeat', 1)).toBe('needs 1 materials for cord, or 3 stone for a cache');
    // Meat eaten comes off what lies out, then what's hung, and the pit's last.
    const supper = endDay(corded);
    expect([pitMeatOf(supper), hungMeatOf(supper)]).toEqual([8, 3]);
    // The camp view and the observation say so.
    expect(meatBlock(corded, enT)).toContain('8 raw meat lies in the cold pit, covered and weighed down: well protected');
    expect(meatBlock(corded, svT)).toContain('8 rått kött ligger i kylgropen, täckt och tyngd med sten: väl skyddat');
    expect(observe(corded)).toMatch(/MEAT: 8 raw meat lies in the cold pit, covered and weighed down — well protected; 4 raw meat hangs out of reach/);
  });

  it('5. no cold pit: the lid can\'t be made; with one, it is a short camp job that stays with the pit', () => {
    expect(ACTIONS.lidpit.name).toBe('Lid the cold pit');
    expect(enT('act.lidpit')).toBe('Lid the cold pit');
    expect(svT('act.lidpit')).toBe('Lägg lock på kylgropen');
    const bare = warden('w-lid-make', { materials: 3, stone: 3 });
    expect(visibilityOf(bare, 'lidpit').status).toBe('greyed');
    expect(blockedReason(bare, 'lidpit', 1)).toBe('dig a cold pit first');
    expect(simLine('dig a cold pit first', svT)).toBe('gräv en kylgrop först');
    // With the pit, and wood and stone for the lid: made in an hour, the cost spent.
    const pit = { ...bare, coldPitAt: 'tree' as const };
    expect(blockedReason({ ...pit, stores: { ...pit.stores, stone: 1 } }, 'lidpit', 1)).toBe(`needs ${LID_COST.stone} stone (have 1)`);
    const lidded = runAction(pit, 'lidpit');
    expect(lidded.pitLid).toBe(true);
    expect([lidded.stores.materials, lidded.stores.stone]).toEqual([3 - LID_COST.materials, 3 - LID_COST.stone]);
    expect(lidded.hoursToday - pit.hoursToday).toBe(1);
    expect(lidded.log.some(e => e.text === LID_LINE)).toBe(true);
    expect(simLine(LID_LINE, svT)).toBe('Lade ett lock av kluvet trä över kylgropen och tyngde ner det med tunga stenar.');
    expect(blockedReason(lidded, 'lidpit', 1)).toBe('the cold pit already has a lid');
    // It stays with the pit: moving camp leaves it there, and a pit left at a camp you'll come back to keeps it.
    const moved = chooseSite(lidded, 'river');
    expect(moved.pitLid).toBe(true);
    expect(pitMeatOf({ ...moved, meatPit: 3, meat: 3, stores: { ...moved.stores, rawFood: 3 } })).toBe(0);
    expect(validSiteBuilds({ 'tree@1,1': { left: 3, pit: { food: 0, lid: true } } })).toBe(true);
    expect(validSiteBuilds({ 'tree@1,1': { left: 3, pit: { food: 0, lid: 'yes' } } })).toBe(false);
    // With the switch off or absent, there's no such action.
    for (const lid of [false, 'absent'] as const) {
      const off = { ...warden('w-lid-make', { materials: 3, stone: 3, lid }), coldPitAt: 'tree' as const };
      expect(shown(off, 'lidpit')).toBe(false);
      expect(blockedReason(off, 'lidpit', 1)).toMatch(/isn't part of this game's rules/);
    }
  });
});

describe('Walls keep the meat safe; only mice nibble (#1858)', () => {
  it('1. a walled shelter at camp and raw meat in it, the Warden away all day with no fire: no fox, raven, wolf or bear takes any of it', () => {
    for (const th of ['small', 'big'] as const) expect(GUARDS.walled[th]).toBe(0);
    let roofed = 0;
    for (const id of ids('w-walls-away', 150)) {
      const s = awayAndNight(warden(id, { shelter: 'walls' }));
      expect(said(s, THIEVES)).toBe(false);
      expect(meatOf(s)).toBe(7);
      if (said(awayAndNight(warden(id, { shelter: 'roof' })), THIEVES)) roofed++;
    }
    // A roof alone keeps nothing off.
    expect(roofed).toBeGreaterThan(10);
  });

  it('2. over many seeded nights, mice sometimes take 5–10% of the loose raw meat, never more, with a journal line', () => {
    // The share itself: 20 meat, they always come (chance 1), so 1 or 2 of it: 5–10%.
    const rand = streamFor(seedOf('w-share'), 1, 'test@share');
    for (let i = 0; i < 2000; i++) {
      const k = rollNibble(rand, 20, 1);
      expect(k).toBeGreaterThanOrEqual(1);
      expect(k).toBeLessThanOrEqual(2);
    }
    let nights = 0;
    for (const id of ids('w-walls-mice', 200)) {
      const s = warden(id, { shelter: 'walls', age: 20, meat: 21 });
      const night = endDay(s);
      const line = night.log.find(e => MICE.test(e.text));
      // Supper took one: the mice's share is of the twenty left.
      const k = 20 - meatOf(night);
      expect(said(night, THIEVES)).toBe(false);
      if (!line) { expect(k).toBe(0); continue; }
      nights++;
      expect(k).toBeGreaterThanOrEqual(1);
      expect(k).toBeLessThanOrEqual(2);
      expect(line.text).toBe(miceLine(k));
      expect(simLine(line.text, svT)).toBe(`Möss har varit åt köttet i natt: ${k} mat borta, och spillning längs hela väggen.`);
    }
    // Some nights, not most: about the cap's chance at a camp this old.
    expect(nights / 200).toBeGreaterThan(MICE_CAP / 3);
    expect(nights / 200).toBeLessThan(MICE_CAP * 1.6);
  });

  it('3. hung meat and smoked or dried rations: mice take nothing; the lidded pit, less (#1857-3)', () => {
    for (const id of ids('w-walls-hung', 150)) {
      const hung = runAction(warden(id, { shelter: 'walls', age: 20, materials: 1 }), 'storemeat');
      expect(hung.meatStored?.place).toBe('hung');
      const night = endDay(hung);
      expect(said(night, MICE)).toBe(false);
      // Rations only (smoked or dried): no mice, and every ration still there but supper's.
      const smoked = endDay(warden(id, { shelter: 'walls', age: 20, meat: 0, rations: 4 }));
      expect(said(smoked, MICE)).toBe(false);
      expect(smoked.stores.rations).toBe(3);
    }
    expect(GUARDS.preserved.vermin).toBe(0);
    expect(GUARDS.lidded.vermin).toBeLessThan(GUARDS.walled.vermin);
  });

  it('4. only a lean-to or brush hut, no walls: #1823\'s risks apply unchanged', () => {
    const view = (s: Region1State) => ({ log: s.log, stores: s.stores, meat: s.meat, meatStored: s.meatStored, vitals: s.vitals });
    for (const id of ids('w-roof', 120)) {
      for (const type of ['leanto', 'hut'] as const) {
        const on = { ...warden(id, { shelter: 'roof', age: 20 }), shelter: { type, walls: null } };
        const off = { ...warden(id, { shelter: 'roof', age: 20, walls: false }), shelter: { type, walls: null } };
        expect(view(awayAndNight(on))).toEqual(view(awayAndNight(off)));
      }
    }
  });

  it('5 (and #1857-6). the same seed and moves bring the same results; with the switches off or absent nothing changes', () => {
    // A camp with walls and a lidded pit, standing two weeks: every new guard and the mice are in play.
    const days: QueueItem[][] = [['wood@2', 'water', 'rest'], [{ q: 'hunt', opts: { target: 'small' } }, 'storemeat', 'wood'], ['traps', 'gather@2', 'rest'], ['wood@2', 'gather'], ['rest', 'water', 'rest'], ['wood@2', 'rest'], ['gather@2', 'water']];
    const play = (lid: Sw, walls: Sw): Region1State => {
      const f: Record<string, boolean> = { ...ruleFeatures() };
      for (const [k, v] of [['cold-pit-lid', lid], ['walled-larder', walls]] as const) { if (v === 'absent') delete f[k]; else f[k] = v; }
      // The journal's hash below was taken with the rings' trips (#1876 off), as #1823's was.
      f['walk-the-map'] = false;
      let s = createRegion1({ world: { ...FULL_WORLD, features: f } }, undefined, { id: 'w-lid-walls-same' });
      s = {
        ...s, site: 'tree', siteDay: s.day - 14, tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' }, coldPitAt: 'tree', pitLid: true,
        explore: survey(scout(createExploration(), 1), 1), tools: [...s.tools, { item: 'sling', grade: 'sound' }],
        stores: { ...s.stores, materials: 10, stone: 6, rawFood: 14, water: 5, firewood: 0 }, meat: 14,
      };
      for (const q of days) s = runDay(s, q).state;
      return s;
    };
    expect(play(true, true)).toEqual(play(true, true));
    // On, it plays differently: the walls keep the thieves off and the pit takes the meat.
    expect(seedOf(JSON.stringify(play(true, true).log))).not.toBe(seedOf(JSON.stringify(play(false, false).log)));
    // Off or absent, each alone or both: the journal is the one main played before #1857 and #1858
    // (its hash taken on main, where neither switch exists and `pitLid` is just an unknown field).
    for (const [lid, walls] of [[false, false], ['absent', 'absent'], [false, 'absent'], ['absent', false]] as const) {
      const s = play(lid, walls);
      expect(s.meatPit).toBeUndefined();
      expect(seedOf(JSON.stringify(s.log))).toBe(MAIN_LOG_HASH);
    }
  });

  it('6. determinism: string-keyed seeds only, each new draw from a stream of its own', () => {
    const seed = seedOf('w-streams');
    const first = (f: () => number) => f();
    expect(first(verminScavengers(seed, 9))).toBe(first(streamFor(seed, 9, 'scavengers@night-vermin')));
    expect(first(pitVerminScavengers(seed, 9))).toBe(first(streamFor(seed, 9, 'scavengers@night-vermin-pit')));
    expect(first(pitScavengers(seed, 9))).toBe(first(streamFor(seed, 9, 'scavengers@night-pit')));
    // Five different streams, so none moves another.
    const draws = [verminScavengers, pitVerminScavengers, pitScavengers, nightScavengers, storedScavengers].map(f => first(f(seed, 9)));
    expect(new Set(draws).size).toBe(5);
    // The same Warden on the same night nibbles the same.
    const s = warden('w-same-mice', { shelter: 'walls', age: 20, lidded: true, pitMeat: 8, meat: 20 });
    expect(endDay(s)).toEqual(endDay(s));
  });

  it(`7. a camp made fewer than ${MICE_FREE_DAYS} days ago at its site: mice never take anything, whatever the storage`, () => {
    for (let d = 0; d < MICE_FREE_DAYS; d++) expect(miceChance(d)).toBe(0);
    for (const id of ids('w-mice-early', 50)) {
      for (let age = 0; age < MICE_FREE_DAYS; age++) {
        const s = warden(id, { shelter: 'walls', age, lidded: true, pitMeat: 8, meat: 16 });
        expect(miceAbout(s)).toBe(false);
        expect(said(endDay(s), MICE)).toBe(false);
      }
    }
  });

  it('8. a camp standing longer: the chance rises with days at the site up to a cap, and moving camp sets it back to zero', () => {
    const chances = Array.from({ length: 30 }, (_, d) => miceChance(d));
    for (let d = 1; d < chances.length; d++) expect(chances[d]).toBeGreaterThanOrEqual(chances[d - 1]);
    expect(miceChance(MICE_FREE_DAYS)).toBeCloseTo(MICE_RAMP, 12);
    expect(miceChance(MICE_FREE_DAYS + 3)).toBeGreaterThan(miceChance(MICE_FREE_DAYS));
    expect(Math.max(...chances)).toBe(MICE_CAP);
    expect(miceChance(365)).toBe(MICE_CAP);
    // Moving camp: the days at the site start again, and so does the mouse-free stretch.
    const old = warden('w-mice-move', { shelter: 'walls', age: 20 });
    expect(campDaysOf(old)).toBe(20);
    expect(miceAbout(old)).toBe(true);
    const moved = chooseSite(old, 'river');
    expect(campDaysOf(moved)).toBe(0);
    expect(miceAbout(moved)).toBe(false);
  });

  it('the camp view and the observation say the meat is behind walls, in #1859\'s words, and say when mice can come', () => {
    const fresh = warden('w-walls-word', { shelter: 'walls' });
    expect(observe(fresh)).toMatch(/MEAT: 8 raw meat lies in the shelter, behind walls — while you're away: secure · tonight \(asleep\): secure/);
    expect(meatBlock(fresh, enT)).toMatch(/8 raw meat lies in the shelter, behind walls — while you(&#39;|')re away: secure · tonight \(asleep\): secure/);
    expect(meatBlock(fresh, svT)).toContain('8 rått kött ligger i skyddet, innanför väggarna — medan du är borta: säkert · i natt (du sover): säkert');
    // Once mice can come, nothing bigger still can, so it's well protected rather than secure.
    expect(protectionOf(['walled'], true)).toBe('well');
    expect(observe(warden('w-walls-word', { shelter: 'walls', age: 20 }))).toMatch(/behind walls — while you're away: well protected · tonight \(asleep\): well protected/);
    // A roof alone: as #1823 says it.
    expect(observe(warden('w-walls-word', { shelter: 'roof' }))).toMatch(/MEAT: 8 raw meat lies in camp — while you're away: lies open/);
    // The rules are told to the AI with the switches, and not without.
    expect(observe(fresh)).toMatch(/WALLED LARDER:/);
    expect(observe(fresh)).toMatch(/COLD PIT LID:/);
    const off = warden('w-walls-word', { shelter: 'walls', lid: false, walls: false });
    expect(observe(off)).not.toMatch(/WALLED LARDER:|COLD PIT LID:|behind walls/);
    expect(meatBlock(off, enT)).not.toContain('behind walls');
  });

  it('the save keeps the lid and the pit\'s meat only with the switch on, and drops what isn\'t one', () => {
    const app = makeWarden({ id: 'w-lid-save' });
    const sim = { ...app.sim, site: 'tree' as const, coldPitAt: 'tree' as const, pitLid: true as const, meatPit: 5, meat: 5, stores: { ...app.sim.stores, rawFood: 5 } };
    const back = deserialize(serialize({ ...app, sim }))!;
    expect([back.sim.pitLid, back.sim.meatPit]).toEqual([true, 5]);
    const raw = JSON.parse(serialize({ ...app, sim }));
    // Malformed: dropped.
    expect(deserialize(JSON.stringify({ ...raw, sim: { ...raw.sim, pitLid: 'yes', meatPit: -2 } }))!.sim.pitLid).toBeUndefined();
    expect(deserialize(JSON.stringify({ ...raw, sim: { ...raw.sim, meatPit: 2.5 } }))!.sim.meatPit).toBeUndefined();
    // No pit: no lid.
    expect(deserialize(JSON.stringify({ ...raw, sim: { ...raw.sim, coldPitAt: null } }))!.sim.pitLid).toBeUndefined();
    // The switch off: neither is kept.
    const features = { ...raw.sim.config.world.features, 'cold-pit-lid': false };
    const off = deserialize(JSON.stringify({ ...raw, sim: { ...raw.sim, config: { ...raw.sim.config, world: { ...raw.sim.config.world, features } } } }))!;
    expect([off.sim.pitLid, off.sim.meatPit]).toEqual([undefined, undefined]);
    expect(storedMeatOf(off.sim)).toBe(0);
  });
});

/**
 * The journal's hash for #1858-5's play with both switches off or absent, taken on main before
 * #1857 and #1858 (the same play, in a copy of main's src).
 */
const MAIN_LOG_HASH = 341687699;
