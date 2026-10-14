/**
 * Acceptance tests for #1686 — the land is described, not mapped, until you draw your own map
 * (switch `descriptive-map`). One test per Given/When/Then, in the issue's order:
 *
 *   1. New run       — given a new run, there is no drawn map, and the description names the near
 *                       places with a direction and a walking time (in the app, the AI's view and the API's).
 *   2. Compass       — given the map and compass in the pack, directions are exact ("due west, about
 *                       15 minutes"); without it they're vague ("west-ish, maybe a quarter hour").
 *   3. Drawing a map — given enough scouting and something to draw on, the map is drawn (with a
 *                       journal line), and it shows only the places you've seen.
 *   4. Switch off    — given the switch off, the map is the Reach map as today, and nothing is described.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, type Region1State } from './region1';
import { createExploration, survey, scout, type Exploration } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { sightFor, ringOfHours, GLYPH, IN_VIEW_HOURS, type Reach, type Sight } from './world/reach';
import { SUGGESTED_PACK, type KitId } from './kit';
import { describeLand, knownPlaces, mapMode, mapDrawn, canDrawMap, drawnRows, reachOfRun, DESCRIPTIVE_MAP } from './descriptive-map';
import { observe } from '../artificer-ai/observe';
import { startGame, view } from '../artificer-play/session';

/** Daylight, clear weather, no luck, accidents or encounters: what happens is the rules'. */
const world = (on: boolean | 'absent'): WorldConfig => ({ ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false, ...(on === 'absent' ? {} : { features: { [DESCRIPTIVE_MAP]: on } }) });

const NO_COMPASS: KitId[] = SUGGESTED_PACK.filter(k => k !== 'map-compass');

/** w-astrid camps on heath with the stream two squares west: a good camp to describe. */
function warden(on: boolean | 'absent' = true, pack: KitId[] = [...SUGGESTED_PACK]): Region1State {
  return createRegion1({ world: world(on) }, undefined, { id: 'w-astrid', pack });
}
/** A lake square with a seen square beside it: you've seen it from the shore. */
const shoreSeen = (r: Reach, sight: Sight, x: number, y: number): boolean =>
  [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < r.w && y + dy < r.h && sight(x + dx, y + dy) > 0);
const withLand = (s: Region1State, explore: Exploration): Region1State => ({ ...s, explore });

const EXACT_DIR = /\b(due (north|east|south|west)|north-east|south-east|south-west|north-west)\b/;
const VAGUE_DIR = /\b(north|east|south|west)-ish\b/;

describe('The land is described, not mapped, until you draw your own map (#1686)', () => {
  it('1. a new run has no map: the description names near places with a direction and a walking time', () => {
    const s = warden();
    expect(mapMode(s)).toBe('described');
    expect(mapDrawn(s)).toBe(false);
    const places = knownPlaces(s);
    expect(places.length).toBeGreaterThan(1);
    // The stream two squares west of camp is named, west, with a walking time.
    const stream = places.find(p => p.kind === 'stream');
    expect(stream?.text).toMatch(/^The stream is due west, about \d+ minutes\.$/);
    // Only places you've seen (in view from camp) or can see from afar (high ground, never visited).
    const r = reachOfRun(s);
    const sight = sightFor(r, s.explore);
    for (const p of places) {
      if (p.horizon) { expect(p.kind).toBe('high'); expect(p.text).toMatch(/you haven't been\.$/); continue; }
      // A lake is seen from its shore (open water has no walking time of its own).
      expect(p.kind === 'lake' ? shoreSeen(r, sight, p.at.x, p.at.y) : sight(p.at.x, p.at.y) > 0).toBe(true);
      if (p.kind !== 'lake') expect(r.hours[p.at.y * r.w + p.at.x]).toBeLessThanOrEqual(IN_VIEW_HOURS);
      // Every line says where and how far.
      expect(p.text).toMatch(EXACT_DIR);
      expect(p.text).toMatch(/minutes|hour/);
    }
    // Further-out places come with exploring: scouting the far ring adds what's out there.
    const farther = knownPlaces(withLand(s, scout(scout(createExploration(), 1), 2)));
    expect(farther.filter(p => !p.horizon).length).toBeGreaterThanOrEqual(places.filter(p => !p.horizon).length);
    expect(farther.some(p => !p.horizon && (ringOfHours(r.hours[p.at.y * r.w + p.at.x]) ?? 1) >= 2 || p.kind === 'lake')).toBe(true);
    // The AI's view (and so the API's, which is the same text) gets the description, not a map.
    const text = observe(s);
    expect(text).toContain('WHAT YOU KNOW OF THE LAND');
    for (const line of describeLand(s)) expect(text).toContain(line);
    const api = view(startGame({ seed: 'map-1' }));
    expect(api.text).toContain('WHAT YOU KNOW OF THE LAND');
    expect(api.text).toMatch(/no map yet/);
  });

  it('2. with the compass, directions are exact; without it, vague', () => {
    const exact = knownPlaces(warden(true, [...SUGGESTED_PACK])).filter(p => !p.horizon);
    const vague = knownPlaces(warden(true, NO_COMPASS)).filter(p => !p.horizon);
    expect(exact.length).toBeGreaterThan(0);
    expect(vague.map(p => p.kind)).toEqual(exact.map(p => p.kind));
    for (const p of exact) { expect(p.text).toMatch(EXACT_DIR); expect(p.text).toMatch(/about (\d+ minutes|an hour|\d)/); expect(p.text).not.toMatch(VAGUE_DIR); }
    for (const p of vague) { expect(p.text).toMatch(VAGUE_DIR); expect(p.text).not.toMatch(EXACT_DIR); expect(p.text).not.toMatch(/about \d+ minutes/); }
    expect(vague.find(p => p.kind === 'stream')?.text).toMatch(/^The stream is west-ish, (a few minutes|maybe a quarter hour|maybe half an hour|the better part of an hour|an hour or so)\.$/);
    // Surveying sharpens the walking time, though without a compass the bearing stays rough.
    const surveyed = knownPlaces(withLand(warden(true, NO_COMPASS), survey(createExploration(), 1))).find(p => p.kind === 'stream');
    expect(surveyed?.text).toMatch(/^The stream is west-ish, about \d+ minutes\.$/);
  });

  it('3. enough scouting and something to draw on: the map is drawn, and shows only what you have seen', () => {
    // Not yet: the near ring only glimpsed, or nothing to draw on.
    const fresh = warden(true, NO_COMPASS);
    expect(canDrawMap(fresh)).toBe(false);
    expect(canDrawMap(withLand(fresh, survey(createExploration(), 1)))).toBe(false); // knows home ground, but no notebook, hide or bark
    const notebook = warden(true, [...NO_COMPASS, 'notebook']);
    expect(canDrawMap(notebook)).toBe(false); // something to draw on, but hasn't learned the land
    // Knowing home ground well (every part of the near ring observed) with the notebook: the map is drawn.
    const nearly = withLand(notebook, { ...survey(createExploration(), 1) });
    expect(canDrawMap(nearly)).toBe(true);
    expect(mapMode(nearly)).toBe('drawn');
    // The journal says so once, on the trip that makes it possible.
    const almost = withLand(notebook, (() => { const e = survey(createExploration(), 1); e.known[1].water = 1.7; return e; })());
    expect(mapDrawn(almost)).toBe(false);
    const after = runAction(almost, 'water');
    expect(mapDrawn(after)).toBe(true);
    const said = after.log.slice(almost.log.length).map(l => l.text).filter(t => /draw/i.test(t));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/notebook/);
    expect(runAction({ ...after, hoursToday: 0 }, 'water').log.slice(after.log.length).some(l => /you draw/i.test(l.text))).toBe(false);
    // The drawn map shows only seen ground: unseen squares stay blank; nothing beyond what sight allows.
    const r = reachOfRun(nearly);
    const sight = sightFor(r, nearly.explore);
    const rows = drawnRows(nearly);
    let blank = 0;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
      const lake = r.cells[y * r.w + x].biome === 'lake';
      if (sight(x, y) === 0 && !(lake && shoreSeen(r, sight, x, y))) expect(rows[y][x]).toBe(GLYPH.unknown);
      if (rows[y][x] === GLYPH.unknown) blank++;
    }
    expect(blank).toBeGreaterThan(0);
    // Without a compass, ground only glimpsed from afar can't be placed: it stays off the map; with it, it's on.
    const glimpsed = withLand(nearly, scout(survey(createExploration(), 1), 2));
    const withCompass = withLand(createRegion1({ world: world(true) }, undefined, { id: 'w-astrid', pack: [...SUGGESTED_PACK, 'notebook'] }), glimpsed.explore);
    const roughCount = drawnRows(glimpsed).join('').split('').filter(c => c !== GLYPH.unknown).length;
    const exactCount = drawnRows(withCompass).join('').split('').filter(c => c !== GLYPH.unknown).length;
    expect(exactCount).toBeGreaterThan(roughCount);
  });

  it('4. with the switch off, the map is the Reach map as today and nothing is described', () => {
    for (const on of [false, 'absent'] as const) {
      const s = warden(on);
      expect(mapMode(s)).toBe('reach');
      expect(mapDrawn(s)).toBe(false);
      expect(describeLand(s)).toEqual([]);
      expect(observe(s)).not.toContain('WHAT YOU KNOW OF THE LAND');
      // A notebook and a surveyed near ring draw nothing, and say nothing.
      const known = withLand(createRegion1({ world: world(on) }, undefined, { id: 'w-astrid', pack: [...SUGGESTED_PACK, 'notebook'] }), (() => { const e = survey(createExploration(), 1); e.known[1].water = 1.7; return e; })());
      expect(canDrawMap(known)).toBe(false);
      expect(runAction(known, 'water').log.slice(known.log.length).some(l => /draw/i.test(l.text))).toBe(false);
    }
    expect(view(startGame({ seed: 'map-4', features: { [DESCRIPTIVE_MAP]: false } })).text).not.toContain('WHAT YOU KNOW OF THE LAND');
  });
});
