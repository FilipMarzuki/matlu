/**
 * Acceptance tests for #1901 — heading out crosses into the next hex (hex world step 8). Scenario 1
 * (the switch off, byte-identical) is the existing suites (directed-explore.test.ts,
 * walk-the-map.test.ts, descriptive-map.test.ts, camp-site-ratings.test.ts, and the app/golden
 * suites), run unedited. This file covers scenarios 2–6, with `hex-world` on.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, type Region1State, type QueueItem } from './region1';
import { createExploration, survey } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { ruleFeatures } from './features';
import { seedOf } from './rng';
import { hexOfCell, packCell } from '../../worldmap/coords';
import { hexName } from '../../worldmap/hex-names';
import { WORLDGEN_VERSION } from '../../worldmap/version';
import { REACH_W } from './world/reach';
import { landOfRun, toWorld, toLocal } from './world/hex-window';
import { inReach } from './world/hex-knowledge';
import { DIRS, standingAt, headOutPlan, walkBackHours, type Dir } from './directed-explore';
import { knownPlaces, campBiome } from './descriptive-map';
import { knownSpots } from './camp-sites';
import { walkTrip, wardenAt } from './walk-the-map';
import { makeT } from './i18n';

const world = (): WorldConfig => ({
  ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false,
  features: ruleFeatures({ 'hex-world': true, 'directed-explore': true, 'camp-as-action': true, 'walk-the-map': true, 'compass-heading': false }),
});
const warden = (id: string): Region1State => createRegion1({ world: world() }, undefined, { id });
const head = (dir: Dir, ring: 1 | 2 | 3): QueueItem => ({ q: ring === 1 ? 'explore' : `explore@${ring}`, opts: { way: dir } });

/** Make camp at the start spot (the same pattern directed-explore.test.ts uses). */
const camp = (s: Region1State): Region1State =>
  runAction({ ...s, explore: survey(createExploration(), 1) }, { q: 'camp', opts: { spot: knownSpots(s)[0].id } });

interface Crossing { id: string; dir: Dir; camped: Region1State }

/**
 * A seed and direction where a ring-3 head-out from camp lands outside the Reach, in a different
 * hex from the one camp's in — asserting that precondition on the chosen seed, as the issue asks.
 */
function findCrossing(): Crossing {
  for (let n = 0; n < 300; n++) {
    const id = `w-hexplay-${n}`;
    const camped = camp(warden(id));
    const land = landOfRun(camped);
    const from = standingAt(camped);
    const fromWorld = toWorld(land, from.x, from.y);
    const fromHex = hexOfCell(fromWorld);
    for (const dir of DIRS) {
      const plan = headOutPlan(land, from, dir, 3);
      if (!plan.to) continue;
      const toWorldCell = toWorld(land, plan.to.x, plan.to.y);
      if (inReach(toWorldCell.cx, toWorldCell.cy)) continue;
      const toHex = hexOfCell(toWorldCell);
      if (toHex.q !== fromHex.q || toHex.r !== fromHex.r) return { id, dir, camped };
    }
  }
  throw new Error('no seed found where a ring-3 head-out crosses into another hex outside the Reach');
}

const found = findCrossing();

describe('#1901 heading out crosses into the next hex (hex world step 8)', () => {
  it('precondition: the chosen seed’s land runs past the Reach’s edge that way, into another hex, within a day’s walk', () => {
    const land = landOfRun(found.camped);
    const from = standingAt(found.camped);
    const plan = headOutPlan(land, from, found.dir, 3);
    expect(plan.to).not.toBeNull();
    const toWorldCell = toWorld(land, plan.to!.x, plan.to!.y);
    expect(inReach(toWorldCell.cx, toWorldCell.cy)).toBe(false);
  });

  it('2. headOut(s, dir, 3) ends outside the Reach, in a new hex, and the journal names it', () => {
    const land = landOfRun(found.camped);
    const from = standingAt(found.camped);
    const plan = headOutPlan(land, from, found.dir, 3);
    const after = runAction(found.camped, head(found.dir, 3));
    expect(after.afield).toBeDefined();
    expect(inReach(after.afield!.x, after.afield!.y)).toBe(false);
    const hex = hexOfCell({ cx: after.afield!.x, cy: after.afield!.y });
    expect(hex).not.toEqual({ q: 0, r: 0 });
    const seed = seedOf(found.camped.character.id);
    const expected = `and by evening you're in ${hexName(seed, hex, 'en')}.`;
    expect(after.log.some(l => l.text.endsWith(expected))).toBe(true);
    // Sanity: the destination afield matches the plan's.
    expect(toLocal(land, after.afield!.x, after.afield!.y)).toEqual(plan.to);
  });

  it('3. every seen cell inside the Reach is seenOut, every one outside is seenWorld, none in both, and worldGen matches', () => {
    const land = landOfRun(found.camped);
    const from = standingAt(found.camped);
    const plan = headOutPlan(land, from, found.dir, 3);
    const after = runAction(found.camped, head(found.dir, 3));
    expect(plan.seen.length).toBeGreaterThan(0);
    const seenOut = new Set(after.seenOut ?? []);
    const seenWorld = new Set(after.seenWorld ?? []);
    let sawOutside = false;
    for (const i of plan.seen) {
      const w = toWorld(land, i % land.w, Math.floor(i / land.w));
      if (inReach(w.cx, w.cy)) {
        expect(seenOut.has(w.cy * REACH_W + w.cx)).toBe(true);
        expect(seenWorld.has(packCell(w))).toBe(false);
      } else {
        sawOutside = true;
        expect(seenWorld.has(packCell(w))).toBe(true);
        expect(seenOut.has(w.cy * REACH_W + w.cx)).toBe(false);
      }
    }
    expect(sawOutside).toBe(true);
    expect(after.worldGen).toBe(WORLDGEN_VERSION);
  });

  it('4. knownPlaces, campBiome, walkBackHours, knownSpots and a walkTrip all read, afield outside the Reach; the walk home ends at camp', () => {
    const after = runAction(found.camped, head(found.dir, 3));
    expect(() => knownPlaces(after)).not.toThrow();
    expect(() => campBiome(after)).not.toThrow();
    const back = walkBackHours(after);
    expect(Number.isFinite(back)).toBe(true);
    expect(back).toBeGreaterThan(0);
    expect(() => knownSpots(after)).not.toThrow();
    expect(() => walkTrip(after, 'wood', 1)).not.toThrow();
    // The walk home (any action away from camp walks back first) ends at camp's world cell.
    const rested = runAction(after, 'rest');
    expect(rested.afield).toBeUndefined();
    const land = landOfRun(rested);
    const campSq = /@(\d+),(\d+)$/.exec(rested.campSpot!.at)!;
    const campLocal = toLocal(land, Number(campSq[1]), Number(campSq[2]))!;
    expect(wardenAt(rested)).toEqual(campLocal);
  });

  it('5. a short ring-1 head-out that stays in the start hex has no hex clause, and matches the switch-off line', () => {
    const land = landOfRun(found.camped);
    const from = standingAt(found.camped);
    const fromHex = hexOfCell(toWorld(land, from.x, from.y));
    const dir = DIRS.find(d => {
      const plan = headOutPlan(land, from, d, 1);
      if (!plan.to) return false;
      const toHex = hexOfCell(toWorld(land, plan.to.x, plan.to.y));
      return toHex.q === fromHex.q && toHex.r === fromHex.r;
    });
    expect(dir).toBeDefined();
    const on = runAction(found.camped, head(dir!, 1));
    const offBase: Region1State = { ...found.camped, config: { ...found.camped.config, world: { ...found.camped.config.world, features: { ...found.camped.config.world.features, 'hex-world': false } } } };
    const off = runAction(offBase, head(dir!, 1));
    // Compare the head-out's own journal lines: the new ones each run wrote today.
    const onNew = on.log.slice(found.camped.log.length);
    const offNew = off.log.slice(offBase.log.length);
    expect(onNew.map(l => l.text)).toEqual(offNew.map(l => l.text));
    expect(onNew[0].text).not.toContain('evening');
  });

  it('6. viewed in Swedish, the hex clause carries hexName(seed, hex, "sv")', () => {
    const after = runAction(found.camped, head(found.dir, 3));
    const hex = hexOfCell({ cx: after.afield!.x, cy: after.afield!.y });
    const seed = seedOf(found.camped.character.id);
    const sv = makeT('sv');
    const rendered = sv('log.headout.hex', { heading: sv(`heading.${found.dir}` as never), h: '8', hex: hexName(seed, hex, 'sv') });
    expect(rendered).toContain(hexName(seed, hex, 'sv'));
    expect(hexName(seed, hex, 'sv')).not.toBe(hexName(seed, hex, 'en'));
  });
});
