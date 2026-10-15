/**
 * Acceptance tests for #1754 — learning the map (switch `map-learning`). In the issue's order:
 *
 *   1. Start       — given a new run, the land is directions and distances only, and the first
 *                     day's journal says you looked around, and the page shows what lay where; no map is drawn.
 *   2. Unlock      — given fewer than 3 nights, 5 places, 3 directions or nothing to draw on, the
 *                     session stays shut, and each missing condition is named; with all four, it opens.
 *   3. Placement   — given a place, its own square counts, and so does one near it; the wrong side
 *                     of camp or the wrong distance doesn't, with a hint from what the Warden knows.
 *                     A sharp Warden (Intelligence or Fieldcraft) is allowed further off.
 *   4. Completion  — every place placed completes the session; the Draw your map action then sets
 *                     `mapLearned`, the map is drawn and stays drawn, and later finds go on it.
 *   5. Save        — `mapLearned` round-trips; a malformed one, or one in a run without the switch, is dropped.
 *   6. AI and API  — the AI's observation and the API say what's missing, then offer "drawmap",
 *                     and doing it draws the map for the same hours behind the same unlock.
 *   7. Switch off  — with the switch off or absent, the map is drawn by itself as #1686 has it,
 *                     there's no action and no first-day line.
 *   8. Determinism — the same run gives the same places, cells and judgements, and drawing the
 *                     map draws on no random stream: the rest of the day plays out the same.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, ACTIONS, skillLockOf, blockedReason, type Region1State } from './region1';
import { createExploration, survey, scout } from './exploration';
import { FULL_WORLD, type WorldConfig } from './world';
import { GLYPH } from './world/reach';
import { SUGGESTED_PACK, type KitId } from './kit';
import { canDrawMap, mapMode, drawnRows, knownPlaces, describeLand, mapDrawnLine, DESCRIPTIVE_MAP } from './descriptive-map';
import {
  MAP_LEARNING, MAP_NIGHTS, MAP_PLACES, MAP_DIRECTIONS, MAP_DRAW_HOURS, LOOK_AROUND_LINE, PLACED_LINE, NOT_YET_REASON, DRAWN_REASON,
  GRID, CENTRE, mapPlaces, mapProgress, needsOf, mapUnlockNeeds, mapUnlockNeedTexts, mapSessionOpen, directionsSpanned,
  distanceBand, trueCell, cellBearing, cellBand, judgePlacement, placementTolerance, placeOn, sessionDone, unplaced, moveCell,
  validMapLearned, NEW_SESSION, type MapPlace, type MapSession, type Cell,
} from './map-learning';
import { en } from './i18n/en';
import { observe } from '../artificer-ai/observe';
import { makeWarden, serialize, deserialize } from '../artificer-app/controller';
import { apply, gameFrom, view, startGame } from '../artificer-play/session';
import { lookAroundLand } from '../artificer-app/map-session-view';
import { makeT } from './i18n';

const enT = makeT('en'), svT = makeT('sv');
const ENGLISH_RE = /(?<![\p{L}])(the|you|your|and|with|of|not|yet|about|minutes|north|south|east|west|map|land|stream|camp)(?![\p{L}])/giu;
const englishIn = (text: string): string[] => [...text.matchAll(ENGLISH_RE)].map(m => m[0]);

const ON = { [DESCRIPTIVE_MAP]: true, [MAP_LEARNING]: true, 'camp-as-action': true, 'distance-not-rings': true };
/** Daylight, clear weather, no luck, accidents or encounters: what happens is the rules'. */
const world = (features: Record<string, boolean> | undefined): WorldConfig => ({ ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false, ...(features ? { features } : {}) });
const WITH_NOTEBOOK: KitId[] = [...SUGGESTED_PACK, 'notebook'];

function warden(features: Record<string, boolean> | undefined = ON, pack: KitId[] = WITH_NOTEBOOK, stats?: Region1State['character']['stats']): Region1State {
  return createRegion1({ world: world(features) }, undefined, { id: 'w-astrid', pack, ...(stats ? { stats } : {}) });
}
/** Home ground surveyed and the land half a day out scouted, four nights in: enough to draw. */
const explored = (s: Region1State, day = MAP_NIGHTS + 1): Region1State => ({ ...s, day, explore: scout(survey(createExploration(), 1), 2) });
const ready = (features: Record<string, boolean> | undefined = ON): Region1State => explored(warden(features));

/** Every place put on its own square. */
const placeAll = (s: Region1State): MapSession => mapPlaces(s).reduce((acc, p) => placeOn(s, acc, p.id, trueCell(p)).session, NEW_SESSION);

/** A square in the same band as the place's, `lo`..`hi` degrees off its bearing (the grid has one for every place here). */
function cellOff(p: MapPlace, lo: number, hi: number): Cell | null {
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
    const c = { x, y };
    if (x === CENTRE && y === CENTRE || cellBand(c) !== distanceBand(p.hours)) continue;
    const d = Math.abs(((cellBearing(c) - p.bearing) % 360 + 540) % 360 - 180);
    if (d >= lo && d <= hi) return c;
  }
  return null;
}

describe('Learning the map (#1754)', () => {
  it('1. a new run knows the land as directions and distances, and its first journal line says you looked around', () => {
    const s = warden();
    expect(mapMode(s)).toBe('described');
    expect(canDrawMap(s)).toBe(false);
    // The first day's journal looks around…
    expect(s.log.filter(l => l.text === LOOK_AROUND_LINE)).toHaveLength(1);
    // …and the page shows what lay where that morning beside it, even days later: where you are, then each place.
    const later = { ...explored(s), campSpot: undefined };
    const land = lookAroundLand(later, { text: LOOK_AROUND_LINE }, enT);
    for (const line of describeLand(s)) expect(land).toContain(line.replace(/'/g, '&#39;'));
    expect(lookAroundLand(later, { text: 'Morning: clear.' }, enT)).toBe('');
    expect(englishIn(lookAroundLand(later, { text: LOOK_AROUND_LINE }, svT).replace(/<[^>]*>/g, ' '))).toEqual([]);
    // The rest of the start is as it was: the line is the only thing added.
    expect(s.log.filter(l => l.text !== LOOK_AROUND_LINE)).toEqual(warden({ ...ON, [MAP_LEARNING]: false }).log);
    // The words are #1686's: a direction and a walking time for each place.
    expect(describeLand(s).length).toBeGreaterThan(1);
    expect(knownPlaces(s).filter(p => !p.horizon).every(p => /minutes|hour/.test(p.text))).toBe(true);
  });

  it('2. the session opens only after enough nights, places and directions, with something to draw on', () => {
    // The thresholds, on their own.
    const enough = { nights: MAP_NIGHTS, places: MAP_PLACES, directions: MAP_DIRECTIONS, surface: 'notebook' as const };
    expect([MAP_NIGHTS, MAP_PLACES, MAP_DIRECTIONS]).toEqual([3, 5, 3]);
    expect(needsOf(enough)).toEqual([]);
    expect(needsOf({ ...enough, nights: MAP_NIGHTS - 1 })).toEqual(['nights']);
    expect(needsOf({ ...enough, places: MAP_PLACES - 1 })).toEqual(['places']);
    expect(needsOf({ ...enough, directions: MAP_DIRECTIONS - 1 })).toEqual(['directions']);
    expect(needsOf({ ...enough, surface: null })).toEqual(['surface']);
    expect(needsOf({ nights: 0, places: 0, directions: 0, surface: null })).toEqual(['nights', 'places', 'directions', 'surface']);
    expect(directionsSpanned([{ bearing: 0 }, { bearing: 10 }, { bearing: 350 }])).toBe(1);
    expect(directionsSpanned([{ bearing: 0 }, { bearing: 90 }, { bearing: 180 }])).toBe(3);

    // A real run: everything holds four nights in, once home ground and the land half a day out are known.
    const s = ready();
    const p = mapProgress(s);
    expect(p.nights).toBe(MAP_NIGHTS);
    expect(p.places).toBeGreaterThanOrEqual(MAP_PLACES);
    expect(p.directions).toBeGreaterThanOrEqual(MAP_DIRECTIONS);
    expect(p.surface).toBe('notebook');
    expect(mapSessionOpen(s)).toBe(true);
    expect(mapUnlockNeeds(s)).toEqual([]);
    // Places found count once a square (a stream bank on the stream is the stream); the skyline doesn't count.
    const places = mapPlaces(s);
    expect(new Set(places.map(q => `${q.x},${q.y}`)).size).toBe(places.length);
    expect(places.some(q => q.spot)).toBe(true);
    // Each condition alone holds it shut.
    expect(mapUnlockNeeds({ ...s, day: MAP_NIGHTS })).toEqual(['nights']);
    expect(mapUnlockNeeds(explored(warden(ON, [...SUGGESTED_PACK])))).toEqual(['surface']);
    const fresh = { ...warden(), day: MAP_NIGHTS + 1 };
    expect(mapUnlockNeeds(fresh)).toContain('places');
    expect(mapSessionOpen(fresh)).toBe(false);
    // Birch bark from cutting wood is something to draw on too.
    expect(mapUnlockNeeds({ ...explored(warden(ON, [...SUGGESTED_PACK])), flags: { ...s.flags, everWood: true } })).toEqual([]);
    // The needs say how far along they are, for the AI and the page.
    expect(mapUnlockNeedTexts({ ...s, day: 2 })).toEqual([`a few nights here first (${MAP_NIGHTS}; 1 so far)`]);
    // Until then the action is shown but can't be done, and says why.
    expect(skillLockOf(fresh, 'drawmap')).toBeNull();
    expect(blockedReason(fresh, 'drawmap', 1)).toBe(NOT_YET_REASON);
    expect(blockedReason(s, 'drawmap', 1)).toBeNull();
    expect(ACTIONS.drawmap.hours).toBe(MAP_DRAW_HOURS);
  });

  it('3. placing is forgiving: its own square and nearby squares count, the wrong side of camp or distance gets a hint', () => {
    const s = ready();
    const tol = placementTolerance(s);
    expect(tol).toEqual({ degrees: 45, bands: 1, sharp: false });
    for (const p of mapPlaces(s)) {
      // Its own square, and a square a little off its bearing.
      expect(judgePlacement(p, trueCell(p), tol).ok).toBe(true);
      const near = cellOff(p, 10, 40);
      if (near) expect(judgePlacement(p, near, tol).ok).toBe(true);
      // The other side of camp: wrong, and the hint says the direction as the Warden knows it.
      const far = cellOff(p, 150, 180)!;
      const wrong = judgePlacement(p, far, tol);
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) {
        expect(wrong.hint.dirWrong).toBe(true);
        expect(wrong.hint.was).toEqual(p.dir);
        expect(wrong.hint.full).toBe(false);
      }
      // The right way but two bands off: nearer or further, with the walking time the Warden knows.
      const band = distanceBand(p.hours);
      const r = band <= 1 ? band + 3 : band - 2 + 1;
      const a = p.bearing * Math.PI / 180;
      const off = { x: CENTRE + Math.round(r * Math.sin(a)), y: CENTRE - Math.round(r * Math.cos(a)) };
      const j = judgePlacement(p, off, tol);
      if (Math.abs(cellBand(off) - band) > 1) {
        expect(j.ok).toBe(false);
        if (!j.ok) { expect(j.hint.distance).toBe(cellBand(off) > band ? 'nearer' : 'further'); expect(j.hint.time).toEqual(p.time); }
      }
      // Camp's own square is never right.
      expect(judgePlacement(p, { x: CENTRE, y: CENTRE }, tol).ok).toBe(false);
    }
    // A sharp Warden is allowed further off (60° counts), and their hints say it all.
    // (A place far enough out for the grid to have a square 60° off it.)
    const p = mapPlaces(s).find(q => cellOff(q, 50, 65))!;
    const sixty = cellOff(p, 50, 65)!;
    expect(sixty).not.toBeNull();
    expect(judgePlacement(p, sixty, tol).ok).toBe(false);
    const clever = explored(warden(ON, WITH_NOTEBOOK, { str: 10, con: 10, agi: 10, int: 14, wil: 10, cha: 10 }));
    const sharp = placementTolerance(clever);
    expect(sharp.sharp).toBe(true);
    expect(sharp.degrees).toBeGreaterThan(tol.degrees);
    expect(judgePlacement(p, sixty, sharp).ok).toBe(true);
    const miss = judgePlacement(p, cellOff(p, 150, 180)!, sharp);
    expect(!miss.ok && miss.hint.full).toBe(true);
    // Fieldcraft at Apprentice does the same.
    const campwise = { ...s, skills: { ...s.skills, fieldcraft: 25 } };
    expect(placementTolerance(campwise).sharp).toBe(true);
    // A wrong placement isn't kept; a right one is; a place you don't know, or a square off the grid, changes nothing.
    const wrongTry = placeOn(s, NEW_SESSION, p.id, cellOff(p, 150, 180)!);
    expect(wrongTry.session.placed[p.id]).toBeUndefined();
    expect(placeOn(s, NEW_SESSION, p.id, trueCell(p)).session.placed[p.id]).toEqual(trueCell(p));
    expect(placeOn(s, NEW_SESSION, 'no-such-place', trueCell(p))).toEqual({ session: NEW_SESSION, judgement: null });
    expect(placeOn(s, NEW_SESSION, p.id, { x: GRID, y: 0 }).judgement).toBeNull();
    // The keyboard's cursor stays on the grid.
    expect(moveCell({ x: 0, y: 0 }, 'ArrowLeft')).toEqual({ x: 0, y: 0 });
    expect(moveCell({ x: 5, y: 5 }, 'ArrowUp')).toEqual({ x: 5, y: 4 });
    expect(moveCell({ x: GRID - 1, y: 5 }, 'ArrowRight')).toEqual({ x: GRID - 1, y: 5 });
  });

  it('4. placing everything completes the session; drawing it sets mapLearned, the map is drawn and stays drawn, later finds go on it', () => {
    const s = ready();
    // Knowing home ground with a notebook no longer draws the map by itself.
    expect(canDrawMap(s)).toBe(false);
    expect(mapMode(s)).toBe('described');
    const done = placeAll(s);
    expect(sessionDone(s, NEW_SESSION)).toBe(false);
    expect(unplaced(s, done)).toEqual([]);
    expect(sessionDone(s, done)).toBe(true);
    // The action: two hours at camp, then the map is yours.
    const after = runAction(s, 'drawmap');
    expect(after.mapLearned).toBe(true);
    expect(after.hoursToday - s.hoursToday).toBeCloseTo(MAP_DRAW_HOURS, 5);
    expect(canDrawMap(after)).toBe(true);
    expect(mapMode(after)).toBe('drawn');
    const said = after.log.slice(s.log.length).map(l => l.text);
    expect(said).toContain(PLACED_LINE);
    expect(said).toContain(mapDrawnLine(after));
    expect(mapSessionOpen(after)).toBe(false);
    expect(blockedReason(after, 'drawmap', 1)).toBe(DRAWN_REASON);
    // It stays drawn: days go by, more is found, and the map grows with what you know.
    const later = runDay({ ...after, hoursToday: 0, stores: { ...after.stores, water: 9, rawFood: 9 } }, ['rest']).state;
    expect(mapMode(later)).toBe('drawn');
    const grown = { ...later, explore: scout(survey(survey(createExploration(), 1), 2), 3) };
    expect(mapMode(grown)).toBe('drawn');
    const seen = (rows: string[]) => rows.join('').split('').filter(c => c !== GLYPH.unknown).length;
    expect(seen(drawnRows(grown))).toBeGreaterThan(seen(drawnRows(after)));
    // Done once: the action again is skipped with why, and says no new map.
    const again = runAction({ ...after, hoursToday: 0 }, 'drawmap');
    expect(again.log.slice(after.log.length).some(l => l.text === PLACED_LINE)).toBe(false);
  });

  it('5. mapLearned round-trips through a save; a malformed one, or one in a run without the switch, is dropped', () => {
    const drawn = runAction(ready(), 'drawmap');
    const app = { ...makeWarden({ id: 'w-astrid' }), sim: drawn };
    const back = deserialize(serialize(app))!;
    expect(back.sim.mapLearned).toBe(true);
    expect(mapMode(back.sim)).toBe('drawn');
    for (const bad of ['yes', 1, false, {}, null]) {
      const raw = JSON.parse(serialize(app));
      raw.sim.mapLearned = bad;
      const read = deserialize(JSON.stringify(raw))!;
      expect(read.sim.mapLearned).toBeUndefined();
      expect(mapMode(read.sim)).toBe('described');
    }
    const raw = JSON.parse(serialize(app));
    raw.sim.config.world.features[MAP_LEARNING] = false;
    expect(deserialize(JSON.stringify(raw))!.sim.mapLearned).toBeUndefined();
    expect(validMapLearned(true)).toBe(true);
    expect(validMapLearned('true')).toBe(false);
  });

  it('6. the AI and the API: told what is missing, then offered "drawmap", which draws the map for the same hours', () => {
    const shut = { ...ready(), day: 2 };
    const text = observe(shut);
    expect(text).toContain(`To draw your own map you need a few nights here first (${MAP_NIGHTS}; 1 so far).`);
    expect(text).toMatch(new RegExp(`- drawmap · ${MAP_DRAW_HOURS}h · .* · BLOCKED: ${NOT_YET_REASON}`));
    const open = observe(ready());
    expect(open).toContain('You can draw your own map now: do "drawmap"');
    expect(open).toMatch(/- drawmap · 2h · [^\n]*/);
    expect(open.split('\n').find(l => l.startsWith('- drawmap'))).not.toContain('BLOCKED');

    // The API: refused before the unlock, the same move draws the map after it.
    const before = gameFrom({ ...makeWarden({ id: 'w-astrid' }), sim: shut }, 'g-map');
    const refused = apply(before, { do: 'drawmap' });
    expect(refused.ok).toBe(false);
    const g = gameFrom({ ...makeWarden({ id: 'w-astrid' }), sim: ready() }, 'g-map');
    expect(view(g).moves.some(m => (m.move as { do?: string }).do === 'drawmap')).toBe(true);
    const r = apply(g, { do: 'drawmap' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.game.app.sim.mapLearned).toBe(true);
      expect(r.view.text).toContain('you have drawn your own map');
    }
    // A new API game plays with the switch on, and its first day says you looked around.
    expect(startGame({ seed: 'learn-1' }).app.sim.log.map(l => l.text)).toContain(LOOK_AROUND_LINE);
  });

  it('7. with the switch off or absent, the map is drawn by itself as #1686 has it: no action, no first-day line', () => {
    for (const f of [{ ...ON, [MAP_LEARNING]: false }, (() => { const { [MAP_LEARNING]: _, ...rest } = ON; return rest; })()]) {
      const s = ready(f);
      expect(s.log.some(l => l.text === LOOK_AROUND_LINE)).toBe(false);
      // Home ground known and a notebook: drawn, as before.
      expect(canDrawMap(s)).toBe(true);
      expect(mapMode(s)).toBe('drawn');
      expect(skillLockOf(s, 'drawmap')).not.toBeNull();
      expect(mapSessionOpen(s)).toBe(false);
      expect(mapUnlockNeeds(s)).toEqual([]);
      expect(observe(s)).not.toContain('drawmap');
    }
    // Without the descriptive map there's nothing to learn either.
    const plain = ready({ [MAP_LEARNING]: true });
    expect(skillLockOf(plain, 'drawmap')).not.toBeNull();
    expect(mapPlaces(plain)).toEqual([]);
    expect(plain.log.some(l => l.text === LOOK_AROUND_LINE)).toBe(false);
  });

  it('8. determinism: the same run gives the same places and judgements, and drawing the map draws on no random stream', () => {
    const a = ready(), b = ready();
    expect(mapPlaces(a)).toEqual(mapPlaces(b));
    expect(mapPlaces(a).map(trueCell)).toEqual(mapPlaces(b).map(trueCell));
    const sa = { ...a, stores: { ...a.stores, water: 9, rawFood: 9 } };
    const one = runDay(sa, ['drawmap', 'gather', 'water']).state;
    const two = runDay(sa, ['drawmap', 'gather', 'water']).state;
    expect(one).toEqual(two);
    // The same day with a rest in its place: weather, stores and the body come out alike but for the action's own effect.
    const rested = runDay(sa, ['rest', 'gather', 'water']).state;
    expect(one.weatherToday).toBe(rested.weatherToday);
    expect(one.forecast).toEqual(rested.forecast);
    expect(one.stores).toEqual(rested.stores);
  });

  it('the English the page shows is the sim\'s own, word for word', () => {
    expect(en['log.lookAround']).toBe(LOOK_AROUND_LINE);
    expect(en['log.mapPlaced']).toBe(PLACED_LINE);
    expect(en['reason.mapNotYet']).toBe(NOT_YET_REASON);
    expect(en['reason.mapDrawn']).toBe(DRAWN_REASON);
    const s = { ...ready(), day: 1, explore: createExploration(), kit: undefined, flags: { ...ready().flags, everWood: false, everHide: false } };
    const p = mapProgress(s);
    const fill = (k: keyof typeof en, n: number, m: number) => en[k].replace('{m}', String(m)).replace('{n}', String(n));
    expect(mapUnlockNeedTexts(s)).toEqual([
      fill('map.need.nights', p.nights, MAP_NIGHTS), fill('map.need.places', p.places, MAP_PLACES), fill('map.need.directions', p.directions, MAP_DIRECTIONS), en['map.need.surface'],
    ]);
  });
});
