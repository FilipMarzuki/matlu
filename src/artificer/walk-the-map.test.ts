/**
 * Acceptance tests for #1876 — tasks that travel walk the map (switch `walk-the-map`). One test per
 * Given/When/Then of the issue, in order:
 *
 *   1. Wood close by   — from camp to a birch or pine square in the near ring that the Warden knows,
 *                        the work, and back; the hours are the path's walking cost plus the work.
 *   2. Water unknown   — with no known water in the ring, the trip goes to the likeliest unseen square
 *                        (the nearest that has water) and the squares passed become seen.
 *   3. A stop          — the Warden's square is on the path where they stopped, and the next action
 *                        starts from there, with the walk back.
 *   4. Heading out     — uses the same walking (its path goes on the trail) and ends the day out there.
 *   5. Any day         — the position is always a valid square, and camp's square only moves by
 *                        making camp elsewhere.
 *   6. Same game       — the same seed and moves give the same paths and squares; off or absent, trips
 *                        are the rings' as today.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, queueHours, ACTIONS, type Region1State, type QueueItem } from './region1';
import { createExploration, survey, TRAVEL_HOURS } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { ruleFeatures, featureById } from './features';
import { reachOfRun } from './descriptive-map';
import { knownSpots } from './camp-sites';
import { walkFrom, sightFor, ringOfHours, COST, YIELDS, type Reach } from './world/reach';
import { headOutPlan, standingAt } from './directed-explore';
import { WALK_THE_MAP, planTrip, homeOf, wardenAt, legAt, validTrail, TRAIL_DAYS, type Trip } from './walk-the-map';

/** Daylight, clear weather, no luck, accidents or encounters: what happens is the rules'. Keeping a heading (#1868) is off, as in #1839's tests. */
const world = (on: boolean | 'absent'): WorldConfig => {
  const features: Record<string, boolean> = { ...ruleFeatures(), 'compass-heading': false };
  if (on === 'absent') delete features[WALK_THE_MAP];
  else features[WALK_THE_MAP] = on;
  return { ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false, features };
};
const warden = (on: boolean | 'absent' = true, id = 'w-walker'): Region1State => createRegion1({ world: world(on) }, undefined, { id });
/** Home ground surveyed and camp made at the first spot known: a Warden with a camp square to walk from. */
function camped(on: boolean | 'absent' = true, id = 'w-walker', open = false): Region1State {
  const s = { ...warden(on, id), explore: survey(createExploration(), 1) };
  const r = reachOfRun(s);
  // `open`: camp out of the trees, so a wood trip has a walk to make.
  const spots = knownSpots(s).filter(p => !open || !['birch', 'pine'].includes(r.cells[idx(r, p)].biome));
  return runAction(s, { q: 'camp', opts: { spot: spots[0].id } });
}
const campSquare = (s: Region1State) => { const m = /@(\d+),(\d+)$/.exec(s.campSpot!.at)!; return { x: Number(m[1]), y: Number(m[2]) }; };
const idx = (r: Reach, at: { x: number; y: number }) => at.y * r.w + at.x;
const adjacent = (r: Reach, a: number, b: number) => Math.abs((a % r.w) - (b % r.w)) + Math.abs(Math.floor(a / r.w) - Math.floor(b / r.w)) === 1;
/** A path's walking cost, from the map alone: each square entered costs its crossing. */
const pathCost = (r: Reach, p: readonly number[]) => p.slice(1).reduce((h, i) => h + COST[r.cells[i].biome], 0);
const used = (a: Region1State, b: Region1State) => b.hoursToday - a.hoursToday;
/** The same state with the switch off: the work's hours alone, as a near trip had them. */
const off = (s: Region1State): Region1State => ({ ...s, config: { ...s.config, world: { ...s.config.world, features: { ...s.config.world.features, [WALK_THE_MAP]: false } } } });

function expectPath(r: Reach, trip: Trip) {
  expect(trip.path[0]).toBe(idx(r, trip.home));
  expect(trip.path.at(-1)).toBe(idx(r, trip.dest));
  for (let k = 1; k < trip.path.length; k++) expect(adjacent(r, trip.path[k - 1], trip.path[k])).toBe(true);
  // A shortest path: its cost is the walking time the map gives the far end.
  expect(pathCost(r, trip.path)).toBeCloseTo(walkFrom(r, trip.home.x, trip.home.y)[trip.path.at(-1)!], 9);
}

describe('#1876 walk the map', () => {
  it('registers walk-the-map as an experimental rule feature, on by default, off for runs from before it', () => {
    expect(featureById(WALK_THE_MAP)).toMatchObject({ kind: 'rules', stage: 'experimental', default: true, absent: false, issue: 1876 });
  });

  it('1. a wood trip close by walks from camp to a known birch or pine square in the near ring, works, and walks back', () => {
    let walked = 0;
    for (const id of ['w-walker', 'w-a', 'w-b', 'w-c', 'w-d']) {
      const s = camped(true, id, true);
      const r = reachOfRun(s);
      const home = campSquare(s);
      const trip = planTrip(s, 'timber', 1)!;
      expect(trip.home).toEqual(home);
      const dest = idx(r, trip.dest);
      expect(['birch', 'pine']).toContain(r.cells[dest].biome);
      const walk = walkFrom(r, home.x, home.y);
      expect(ringOfHours(walk[dest])).toBe(1);
      // Known: in view from camp, or a ring known.
      expect(sightFor({ ...r, hours: walk }, s.explore)(trip.dest.x, trip.dest.y)).toBeGreaterThan(0);
      // The nearest such square: none in the near ring that has timber is closer.
      for (let i = 0; i < r.cells.length; i++) if (YIELDS[r.cells[i].biome].includes('timber') && walk[i] < walk[dest] - 1e-9) expect(ringOfHours(walk[i])).not.toBe(1);
      expectPath(r, trip);
      // The plan's hours are the walk's and the work's.
      const back = pathCost(r, [...trip.path].reverse());
      expect(queueHours('wood', s)).toBeCloseTo(pathCost(r, trip.path) + back + queueHours('wood', off(s)), 9);
      // So are the run's, carrying aside: an overloaded haul slows the walk home (#1296), which the plan can't know.
      const light = { ...s, config: { ...s.config, world: { ...s.config.world, carrying: false } } };
      const after = runAction(light, 'wood');
      // There and back: the path out, and the same path walked home (it enters every square but the far end, and camp).
      expect(used(s, after)).toBeCloseTo(pathCost(r, trip.path) + back + queueHours('wood', off(s)), 9);
      // Back at camp, and the journal says where the work was.
      expect(after.afield).toBeUndefined();
      expect(wardenAt(after)).toEqual(home);
      if (trip.path.length > 1) {
        walked++;
        expect(after.log.some(l => /^Where the work was: (Birch wood|Pine forest), /.test(l.text))).toBe(true);
        expect(after.trail?.at(-1)?.path).toEqual([...trip.path, ...trip.path.slice(0, -1).reverse()]);
      }
    }
    expect(walked).toBeGreaterThan(0);
  });

  it('2. with no known water in the ring, a water trip goes to the likeliest unseen square that way, and the squares passed become seen', () => {
    const s = camped();
    const r = reachOfRun(s);
    const home = campSquare(s);
    const walk = walkFrom(r, home.x, home.y);
    // Nothing of the far ring is known: its squares are all unseen.
    const sight = sightFor({ ...r, hours: walk }, s.explore);
    const unseenWater = r.cells.map((_c, i) => i).filter(i => ringOfHours(walk[i]) === 2 && sight(i % r.w, Math.floor(i / r.w)) === 0 && !(s.seenOut ?? []).includes(i)
      && (YIELDS[r.cells[i].biome].includes('water') || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => r.cells[(Math.floor(i / r.w) + dy) * r.w + (i % r.w) + dx]?.biome === 'lake')));
    expect(unseenWater.length).toBeGreaterThan(0);
    const trip = planTrip(s, 'water', 2)!;
    expect(trip.known).toBe(false);
    const dest = idx(r, trip.dest);
    // The likeliest unseen square: the nearest of them by walking time (ties to the first).
    expect(dest).toBe(unseenWater.reduce((a, b) => (walk[b] < walk[a] ? b : a)));
    expectPath(r, trip);
    const after = runAction(s, 'water@2');
    for (const i of trip.path) expect(after.seenOut).toContain(i);
    expect(after.log.some(l => l.text.startsWith("Into land you hadn't seen: "))).toBe(true);
    // The hours are the walk's, not the ring's flat +3h.
    expect(used(s, after)).toBeCloseTo(trip.outHours + trip.backHours + queueHours('water', off(s)), 9);
    expect(trip.outHours + trip.backHours).toBeGreaterThan(TRAVEL_HOURS[2]);
    // Seen now, the next water trip that way knows the square it goes to.
    expect(planTrip(after, 'water', 2)!.known).toBe(true);
  });

  it('3. a stop leaves the Warden on the path where they stopped, and the next action starts from there with the walk back', () => {
    const s = camped();
    const r = reachOfRun(s);
    const trip = planTrip(s, 'water', 2)!;
    const planned = queueHours('water@2', s);
    const travel = trip.outHours + trip.backHours;
    // Stopped a third of the way out: on the path, the hours walked and no more.
    const stopAt = travel / 2 / 3;
    const stopped = runAction(s, 'water@2', stopAt);
    expect(stopped.afield).toBeDefined();
    const at = idx(r, stopped.afield!);
    expect(trip.path).toContain(at);
    expect(at).not.toBe(trip.path[0]);
    expect(used(s, stopped)).toBeCloseTo(stopAt, 9);
    expect(stopped.stores.water).toBe(s.stores.water);
    expect(stopped.log.at(-1)?.text).toMatch(/^You stopped out on the land, .* from camp: the next work starts with the walk back\.$/);
    // The next action starts with the walk back from there, then the trip from camp.
    const next = runAction(stopped, 'wood');
    const backHome = walkFrom(r, stopped.afield!.x, stopped.afield!.y)[idx(r, trip.home)];
    expect(next.log.some(l => l.text.startsWith('Walked back to camp first'))).toBe(true);
    expect(used(stopped, next)).toBeCloseTo(backHome + queueHours('wood', { ...stopped, afield: undefined }), 9);
    expect(next.afield).toBeUndefined();
    expect(queueHours('wood', stopped)).toBeCloseTo(used(stopped, next), 9);
    // Stopped on the last walk home (where nothing of the work is cut), you're still on the path, with the water.
    const late = runAction(s, 'water@2', planned - trip.backHours / 4);
    expect(late.stores.water).toBeGreaterThan(s.stores.water);
    expect(late.afield).toBeDefined();
    expect(trip.path).toContain(idx(r, late.afield!));
    expect(used(s, late)).toBeCloseTo(planned - trip.backHours / 4, 9);
    // The legs as the stop reads them: out, the work, back.
    expect(legAt([{ travel, work: planned - travel }], stopAt)?.leg).toBe('out');
    expect(legAt([{ travel, work: planned - travel }], travel / 2 + 0.1)?.leg).toBe('work');
    expect(legAt([{ travel, work: planned - travel }], planned - 0.1)?.leg).toBe('back');
    expect(legAt([{ travel, work: planned - travel }], planned + 0.1)).toBeNull();
  });

  it('4. heading out uses the same walking and ends the day out there, as before', () => {
    const s = warden();
    const r = reachOfRun(s);
    const start = standingAt(s, r);
    const item: QueueItem = { q: 'explore@2', opts: { way: 'ne' } };
    const after = runDay(s, [item]).state;
    const plan = headOutPlan(r, start, 'ne', 2);
    expect(after.afield).toEqual(plan.to);
    // The walk is on the trail: a path of neighbouring squares from where you set out to where you are.
    const path = after.trail!.find(d => d.day === s.day)!.path;
    expect(path[0]).toBe(idx(r, start));
    expect(path.at(-1)).toBe(idx(r, plan.to!));
    for (let k = 1; k < path.length; k++) expect(adjacent(r, path[k - 1], path[k])).toBe(true);
    expect(pathCost(r, path)).toBeCloseTo(plan.hours, 9);
    // Where you end up, what you see and what it costs are heading out's own, switch or not.
    const before = runDay(warden(false), [item]).state;
    expect(after.afield).toEqual(before.afield);
    expect(after.seenOut).toEqual(before.seenOut);
    expect(after.hoursToday).toBeCloseTo(before.hoursToday, 9);
  });

  it('5. on any day the position is a valid square, and camp only moves by making camp elsewhere', () => {
    let s = camped();
    const r = reachOfRun(s);
    const camp = s.campSpot!.at;
    const days: { queue: QueueItem[]; stop?: { action: number; hours: number } }[] = [
      { queue: ['wood', 'water', 'gather'] },
      { queue: ['water@2', 'wood'], stop: { action: 0, hours: 1 } },
      { queue: ['wood', 'traps'] },
      { queue: [{ q: 'explore@2', opts: { way: 's' } }] },
      { queue: ['water', 'gather@2'], stop: { action: 1, hours: 5 } },
      { queue: ['gatherstone', 'wood'] },
    ];
    for (const d of days) {
      let out = runDay(s, d.queue, d.stop);
      // A stopped day pauses: end it with nothing more, the night out where you are.
      if (d.stop) out = runDay(out.state, []);
      s = out.state;
      const at = wardenAt(s, r);
      expect(at.x >= 0 && at.x < r.w && at.y >= 0 && at.y < r.h).toBe(true);
      expect(Number.isFinite(walkFrom(r, homeOf(s, r).x, homeOf(s, r).y)[idx(r, at)])).toBe(true);
      expect(s.campSpot!.at).toBe(camp);
      expect(validTrail(s.trail)).toBe(true);
      expect(s.trail!.length).toBeLessThanOrEqual(TRAIL_DAYS);
    }
    // Making camp elsewhere is what moves it.
    const other = knownSpots(s).find(p => p.id !== camp);
    if (other) expect(runAction(s, { q: 'camp', opts: { spot: other.id } }).campSpot?.at).not.toBe(camp);
  });

  it('6. the same seed and moves give the same paths and squares; off or absent, trips are the rings’ as today', () => {
    const play = (on: boolean | 'absent') => {
      let s = camped(on);
      s = runDay(s, ['wood', 'water@2', 'gather'], { action: 1, hours: 1.5 }).state;
      s = runDay(s, []).state;
      return runDay(s, ['wood', 'water']).state;
    };
    const a = play(true), b = play(true);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.trail?.length).toBeGreaterThan(0);
    const offRun = play(false), absentRun = play('absent');
    expect(JSON.stringify({ ...offRun, config: null })).toBe(JSON.stringify({ ...absentRun, config: null }));
    for (const s of [offRun, absentRun]) expect(s.trail).toBeUndefined();
    // With it off a trip's walk is the ring's flat travel, and there's no square to go to.
    const s = camped(false);
    expect(queueHours('water@2', s)).toBeCloseTo(ACTIONS.water.hours + TRAVEL_HOURS[2], 9);
    expect(queueHours('wood', s)).toBeCloseTo(ACTIONS.wood.hours, 9);
    const stopped = runAction(s, 'water@2', 1);
    expect(stopped.afield).toBeUndefined();
    // Stopped on the walk out, you turned back: the walk back as long as the walk out (#1815).
    expect(used(s, stopped)).toBeCloseTo(2, 9);
  });
});
