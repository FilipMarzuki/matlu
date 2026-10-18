/**
 * Acceptance tests for #1839 — explore in a chosen direction, or look around a centre (switch
 * `directed-explore`). One test per Given/When/Then of the owner's final comment, in order:
 *
 *   1. Sector and map  — heading out in D finds places in D's 45° sector of the Reach (from the
 *                        start), and their biomes and yields are the map's cells there.
 *   2. Water           — a direction whose sector holds water finds it; the opposite way, with none
 *                        within that distance, finds none.
 *   3. Moving          — the Warden ends the day at the new spot; the next day's centre, distances,
 *                        walking times and the walk back to camp are measured from there.
 *   4. Look around     — learns a little in every direction and stays put; before camp the centre is
 *                        where you stand, after camp it's "around here" or "around camp".
 *   5. One way only    — heading out learns nothing new about the other seven directions.
 *   6. Same game       — the same seed and moves give the same finds and positions; with the switch
 *                        off or absent, explore is today's and the run is identical.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, queueHours, ACTIONS, type Region1State, type QueueItem } from './region1';
import { explore as exploreRing, createExploration, survey } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { ruleFeatures } from './features';
import { reachOfRun, knownPlaces } from './descriptive-map';
import { knownSpots } from './camp-sites';
import { walkFrom, YIELDS, type Biome, type Reach } from './world/reach';
import {
  DIRECTED_EXPLORE, DIRS, HEAD_OUT_HOURS, LOOK_HOURS, headOutPlan, inSector, sectorOf, standingAt, walkBackHours, wayOptions, type Dir,
} from './directed-explore';

/** Daylight, clear weather, no luck, accidents or encounters: what happens is the rules'. */
const world = (on: boolean | 'absent'): WorldConfig => {
  const features = ruleFeatures();
  if (on === 'absent') delete features[DIRECTED_EXPLORE];
  else features[DIRECTED_EXPLORE] = on;
  return { ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false, features };
};
const warden = (on: boolean | 'absent' = true, id = 'w-astrid'): Region1State => createRegion1({ world: world(on) }, undefined, { id });
const head = (dir: Dir, ring: 1 | 2 | 3 = 2): QueueItem => ({ q: ring === 1 ? 'explore' : `explore@${ring}`, opts: { way: dir } });
const WATER: readonly Biome[] = ['river', 'lake', 'marsh'];
const xy = (r: Reach, i: number) => ({ x: i % r.w, y: Math.floor(i / r.w) });
const opposite = (d: Dir): Dir => DIRS[(DIRS.indexOf(d) + 4) % 8];

/** Is there water in a direction's sector within heading out's reach, by the map alone? */
function waterThatWay(r: Reach, from: { x: number; y: number }, d: Dir, ring: 1 | 2 | 3): boolean {
  const walk = walkFrom(r, from.x, from.y);
  return r.cells.some((c, i) => {
    const { x, y } = xy(r, i);
    if (!WATER.includes(c.biome) || !inSector(from, x, y, d)) return false;
    // Open water is reached from its shore.
    const hrs = c.biome === 'lake' ? Math.min(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => (x + dx >= 0 && y + dy >= 0 && x + dx < r.w && y + dy < r.h ? walk[(y + dy) * r.w + x + dx] : Infinity))) : walk[i];
    return hrs <= HEAD_OUT_HOURS[ring];
  });
}

describe('#1839 directed explore', () => {
  it('1. heading out in D finds places in D’s sector of the Reach, with the map’s own biomes and yields', () => {
    const s = warden();
    const r = reachOfRun(s);
    const start = standingAt(s, r);
    for (const d of DIRS) {
      const after = runAction(s, head(d));
      const plan = headOutPlan(r, start, d, 2);
      expect(after.seenOut).toEqual(plan.seen);
      for (const i of after.seenOut ?? []) expect(sectorOf(start, xy(r, i).x, xy(r, i).y)).toBe(d);
      for (const f of plan.found) {
        expect(inSector(start, f.x, f.y, d)).toBe(true);
        expect(r.cells[f.y * r.w + f.x].biome).toBe(f.biome);
        expect(f.yields).toEqual(YIELDS[f.biome]);
      }
      // What the journal says it found is the plan's, by the map's names.
      const said = after.log.filter(l => l.text.startsWith('Out that way: ')).length;
      expect(said).toBe(plan.found.length);
    }
  });

  it('2. a direction with water on the map finds water; the opposite way, with none that far, finds none', () => {
    let pair: { id: string; d: Dir } | null = null;
    for (let n = 0; n < 60 && !pair; n++) {
      const id = `w-water-${n}`;
      const s = warden(true, id);
      const r = reachOfRun(s), from = standingAt(s, r);
      const d = DIRS.find(x => waterThatWay(r, from, x, 1) && !waterThatWay(r, from, opposite(x), 1));
      if (d) pair = { id, d };
    }
    expect(pair).not.toBeNull();
    const s = warden(true, pair!.id);
    const r = reachOfRun(s);
    const foundWater = (st: Region1State): boolean => (st.seenOut ?? []).some(i => WATER.includes(r.cells[i].biome));
    const there = runAction(s, head(pair!.d, 1));
    expect(foundWater(there)).toBe(true);
    expect(there.log.some(l => /^Out that way: (River|Lake|Marsh),/.test(l.text))).toBe(true);
    const away = runAction(s, head(opposite(pair!.d), 1));
    expect(foundWater(away)).toBe(false);
    expect(away.log.some(l => /^Out that way: (River|Lake|Marsh),/.test(l.text))).toBe(false);
  });

  it('3. the Warden ends the day out there, and the next day is measured from there, the walk back to camp too', () => {
    const s = warden();
    const r = reachOfRun(s);
    const plan = headOutPlan(r, standingAt(s, r), 'n', 2);
    const out = runDay(s, [head('n')]).state;
    expect(out.day).toBe(2);
    expect(out.afield).toEqual(plan.to);
    expect(standingAt(out, r)).toEqual(plan.to);
    // The next head-out sets out from there.
    expect(headOutPlan(r, standingAt(out, r), 'n', 2).from).toEqual(plan.to);
    // Walking times to places and camp sites are from where you stand.
    const walk = walkFrom(r, plan.to!.x, plan.to!.y);
    for (const p of knownSpots(out)) expect(p.hours).toBe(p.atYou ? 0 : walk[p.y * r.w + p.x]);
    for (const p of knownPlaces(out)) if (!p.horizon) expect(p.hours).toBeLessThan(Infinity);
    // With a camp: heading out from it, the walk back is from where you end up, and other work starts with it.
    const camped = runAction({ ...s, explore: survey(createExploration(), 1) }, { q: 'camp', opts: { spot: knownSpots(s)[0].id } });
    const away = runAction(camped, head('e'));
    expect(away.afield).toBeDefined();
    const back = walkBackHours(away);
    const campSq = /@(\d+),(\d+)$/.exec(away.campSpot!.at)!;
    expect(back).toBe(walkFrom(r, away.afield!.x, away.afield!.y)[Number(campSq[2]) * r.w + Number(campSq[1])]);
    expect(back).toBeGreaterThan(0);
    expect(queueHours('rest', away)).toBeCloseTo(queueHours('rest', camped) + back, 6);
    const rested = runAction(away, 'rest');
    expect(rested.afield).toBeUndefined();
    expect(rested.log.some(l => l.text.startsWith('Walked back to camp first'))).toBe(true);
  });

  it('4. look around learns a little in every direction and stays put; around here or around camp once camp exists', () => {
    const s = warden();
    // Before camp: look around (here) and the eight ways; no "around camp".
    const before = wayOptions(s, {})[0];
    expect(before.choices.map(c => c.value)).toEqual(['here', ...DIRS]);
    expect(before.value).toBe('here');
    // At the start it's today's explore: the rings, every direction, and you stay where you are.
    const looked = runAction(s, 'explore@1');
    expect(looked.explore).toEqual(exploreRing(s.explore, 1));
    expect(looked.afield).toBeUndefined();
    expect(runAction(s, { q: 'explore', opts: { way: 'here' } })).toEqual(looked);
    // Moved away before camp: the centre is where you stand, and looking around sees every direction from there.
    const out = runAction(s, head('w'));
    const r = reachOfRun(s);
    const here = runAction(out, { q: 'explore', opts: { way: 'here' } });
    expect(here.afield).toEqual(out.afield);
    // Every way the land goes on from there (the map's edge may cut some off), it saw some of it.
    const walk = walkFrom(r, out.afield!.x, out.afield!.y);
    const open = new Set(r.cells.map((_c, i) => i).filter(i => walk[i] > 0 && walk[i] <= LOOK_HOURS[1]).map(i => sectorOf(out.afield!, xy(r, i).x, xy(r, i).y)));
    const sectors = new Set((here.seenOut ?? []).map(i => sectorOf(out.afield!, xy(r, i).x, xy(r, i).y)));
    expect(open.size).toBeGreaterThan(2);
    for (const d of open) expect(sectors.has(d)).toBe(true);
    expect(here.explore).toEqual(out.explore);
    // After camp, away from it: around here, or around camp.
    const camped = runAction({ ...s, explore: survey(createExploration(), 1) }, { q: 'camp', opts: { spot: knownSpots(s)[0].id } });
    const away = runAction(camped, head('s'));
    expect(wayOptions(away, {})[0].choices.map(c => c.value)).toEqual(['here', 'camp', ...DIRS]);
    expect(wayOptions(camped, {})[0].choices.map(c => c.value)).toEqual(['here', ...DIRS]);
    const atCamp = runAction(away, { q: 'explore', opts: { way: 'camp' } });
    expect(atCamp.afield).toBeUndefined();
    expect(atCamp.explore).toEqual(exploreRing(away.explore, 1));
    const stayed = runAction(away, { q: 'explore', opts: { way: 'here' } });
    expect(stayed.afield).toEqual(away.afield);
    expect(stayed.explore).toEqual(away.explore);
  });

  it('5. heading out teaches nothing about the other seven directions', () => {
    const s = warden();
    const r = reachOfRun(s);
    const start = standingAt(s, r);
    for (const d of DIRS) {
      const after = runAction(s, head(d, 3));
      // The rings (which have no direction) are untouched.
      expect(after.explore).toEqual(s.explore);
      // Every square seen is in D's sector, none in another's.
      for (const i of after.seenOut ?? []) for (const o of DIRS) if (o !== d) expect(inSector(start, xy(r, i).x, xy(r, i).y, o)).toBe(false);
      // Camp sites newly known lie that way too, as seen from the start.
      const spotsBefore = new Set(knownSpots(s).map(p => p.id));
      for (const p of knownSpots(after)) if (!spotsBefore.has(p.id)) expect(inSector(start, p.x, p.y, d)).toBe(true);
      // And so do newly described places: those you'd not know of from the same spot without the trip.
      const without = new Set(knownPlaces({ ...after, seenOut: s.seenOut }).map(p => `${p.at.x},${p.at.y}`));
      for (const p of knownPlaces(after)) if (!p.horizon && !without.has(`${p.at.x},${p.at.y}`)) expect(inSector(start, p.at.x, p.at.y, d)).toBe(true);
    }
  });

  it('6. the same seed and moves give the same run; off or absent, explore is today’s', () => {
    const plan: QueueItem[] = [head('ne'), 'rest'];
    const a = runDay(runDay(warden(), plan).state, [head('e', 1)]).state;
    const b = runDay(runDay(warden(), plan).state, [head('e', 1)]).state;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.afield).toBeDefined();
    for (const off of [false, 'absent'] as const) {
      const s = warden(off);
      expect(ACTIONS.explore.options?.(s, {}) ?? []).toEqual([]);
      const chosen = runDay(s, [head('n'), { q: 'explore', opts: { way: 'camp' } }]).state;
      const today = runDay(s, ['explore@2', 'explore']).state;
      expect(JSON.stringify(chosen)).toBe(JSON.stringify(today));
      expect(chosen.afield).toBeUndefined();
      expect(chosen.seenOut).toBeUndefined();
    }
    // Off and absent are the same game.
    const offRun = runDay(warden(false), ['explore@2', 'rest']).state;
    const absentRun = runDay(warden('absent'), ['explore@2', 'rest']).state;
    expect(JSON.stringify({ ...offRun, config: null })).toBe(JSON.stringify({ ...absentRun, config: null }));
  });
});
