/**
 * Learning the map (#1754, switch `map-learning`).
 *
 * The owner's idea: "we want to start by just direction and distance between things. But then some
 * kind of mode / adventure, maybe after a few nights of sleep, locked by finding enough places,
 * where the player gets to place all the things they found on the map. After that the basic map is
 * unlocked."
 *
 * So, with the switch on (and the descriptive map, #1686, which it builds on):
 *
 * - **At the start** the Warden knows the land only as directions and walking times, and the
 *   journal's first day says so (`LOOK_AROUND_LINE`); the page shows what lay where that morning
 *   beside it (`onArrival`).
 * - **The unlock.** The map-drawing session opens once all of these hold (`mapUnlockNeeds`):
 *   `MAP_NIGHTS` nights slept, `MAP_PLACES` places found, those places in `MAP_DIRECTIONS`
 *   directions (of the compass's eight points), and something to draw on (`mapSurface`).
 * - **The session.** "Draw your map" is an action (region1.ts `drawmap`, `MAP_DRAW_HOURS`). On the
 *   page it opens a blank grid first, where the player places each place by what the Warden knows
 *   of it (its bearing and walking time from camp); `judgePlacement` is forgiving (a bearing within
 *   `placementTolerance`'s degrees, a distance within a band) and a wrong one gets a hint from what
 *   the Warden knows. Done, the page queues the action. The AI and the API take the action itself:
 *   their Warden draws the map from what it knows, for the same hours behind the same unlock.
 * - **The result.** The action sets the save's one new field, `mapLearned` (validated, written only
 *   with the switch on), and that is what draws the map now (descriptive-map.ts `canDrawMap`).
 *   Places found later go on the drawn map by themselves: it's drawn from what you know.
 *
 * Pure and deterministic: everything comes from the run's state (its Reach, what it knows, its day,
 * its pack and flags, its stats and skills). Nothing draws on a random stream.
 */

import { featureOn } from './features';
import { skillLevel } from './skills';
import { createExploration } from './exploration';
import {
  descriptiveMapOn, knownPlaces, landOrigin, mapNeedIds, mapSurface, reachOfRun, directionIndex,
  type MapSurface, type PlaceKind, type TimeWord,
} from './descriptive-map';
import { campAsActionOn, knownSpots, whereYouAre } from './camp-sites';
import type { Region1State, SiteId } from './region1';

/** The rule switch (features.ts). */
export const MAP_LEARNING = 'map-learning';

export const mapLearningOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, MAP_LEARNING);

// ── The unlock ──────────────────────────────────────────────────────────────

/** Nights slept before you'd sit down to draw the land: a few, to know it. */
export const MAP_NIGHTS = 3;
/** Places found (seen, not just on the skyline; places to camp count too). */
export const MAP_PLACES = 5;
/** …and in this many directions, of the compass's eight points: a map needs more than one line out of camp. */
export const MAP_DIRECTIONS = 3;
/** Hours the Draw your map action takes, at camp. */
export const MAP_DRAW_HOURS = 2;

/** The first day's journal line (#1754): you look around; the land is directions and distances. */
export const LOOK_AROUND_LINE = 'You stop and look around before anything else, and note what lies in which direction from here, and about how far. There\'s no map of this land; for now you know it only as directions and distances.';
/** The Draw your map action's own line, before the journal's "you have a map of your own" (descriptive-map.ts `mapDrawnLine`). */
export const PLACED_LINE = 'You place each thing you\'ve found by its direction and distance from camp. What you find from now on goes on the map too.';
/** Why the action can't be done now. */
export const NOT_YET_REASON = 'not yet: a few nights here, enough places found in enough directions, and something to draw on';
export const DRAWN_REASON = "you've drawn your map already";

/** What a run needs for this. */
type Run = Pick<Region1State, 'config' | 'character' | 'explore' | 'kit' | 'flags' | 'day' | 'skills'> & Partial<Pick<Region1State, 'campSpot' | 'mapLearned'>>;

/**
 * The run as it was on the first morning, as far as the land goes: nothing explored and no camp
 * made yet (the pack and the Reach never change). What the journal's first line looked out on.
 */
export const onArrival = <S extends Run>(s: S): S => ({ ...s, explore: createExploration(), campSpot: undefined });

/** Nights slept: every day before today ended with one. */
export const nightsSlept = (s: Pick<Region1State, 'day'>): number => Math.max(0, s.day - 1);

/** A place to put on the map: a place you know of (descriptive-map.ts) or a place to camp you know (camp-sites.ts). */
export interface MapPlace {
  /** `stream`, `lake`…, or a camp spot's id (`cave@3,4`). */
  id: string;
  /** What it is: a kind of place, or a kind of camp site. */
  kind: PlaceKind | SiteId;
  spot: boolean;
  /** Its square on the Reach. */
  x: number;
  y: number;
  /** Hours on foot from camp, and the bearing from camp, degrees clockwise from north. */
  hours: number;
  bearing: number;
  /** What the Warden knows of it, as parts: the direction they'd say, and the walking time. */
  dir: { exact: boolean; i: number };
  time: TimeWord;
}

/**
 * The places you've found, to put on a map: each place you've seen (not one only on the skyline:
 * you don't know how far that is), then each place to camp you know other than where you are, one
 * per square (a stream bank on the stream's square is the stream). Places to camp are told from
 * where you are, so they count only while that's where the land is told from (#1752).
 */
export function mapPlaces(s: Run): MapPlace[] {
  if (!descriptiveMapOn(s)) return [];
  const out: MapPlace[] = knownPlaces(s).filter(p => !p.horizon)
    .map(p => ({ id: p.kind, kind: p.kind, spot: false, x: p.at.x, y: p.at.y, hours: p.hours, bearing: p.bearing, dir: p.dir, time: p.time }));
  if (!campAsActionOn(s)) return out;
  const r = reachOfRun(s);
  const from = landOrigin(s, r), you = whereYouAre({ campSpot: s.campSpot }, r);
  if (from.x !== you.x || from.y !== you.y) return out;
  const spots = knownSpots({ ...s, campSpot: s.campSpot });
  for (const p of spots) {
    if (p.atYou || out.some(q => q.x === p.x && q.y === p.y)) continue;
    out.push({ id: p.id, kind: p.kind, spot: true, x: p.x, y: p.y, hours: p.hours, bearing: p.bearing, dir: p.dir, time: p.time });
  }
  return out;
}

/** How many of the compass's eight points the places lie on. */
export const directionsSpanned = (places: readonly Pick<MapPlace, 'bearing'>[]): number => new Set(places.map(p => directionIndex(p.bearing, true))).size;

/** Where the unlock stands. */
export interface MapProgress { nights: number; places: number; directions: number; surface: MapSurface | null }

export function mapProgress(s: Run): MapProgress {
  const places = mapPlaces(s);
  return { nights: nightsSlept(s), places: places.length, directions: directionsSpanned(places), surface: mapSurface(s) };
}

export type MapLearnNeed = 'nights' | 'places' | 'directions' | 'surface';

/** What a progress still lacks, in the order it's said. Pure, so the thresholds can be tested on their own. */
export function needsOf(p: MapProgress): MapLearnNeed[] {
  const out: MapLearnNeed[] = [];
  if (p.nights < MAP_NIGHTS) out.push('nights');
  if (p.places < MAP_PLACES) out.push('places');
  if (p.directions < MAP_DIRECTIONS) out.push('directions');
  if (!p.surface) out.push('surface');
  return out;
}

/** What's still missing before the map-drawing session opens (empty once it can, once drawn, or with the switch off). */
export function mapUnlockNeeds(s: Run): MapLearnNeed[] {
  if (!mapLearningOn(s) || !descriptiveMapOn(s) || s.mapLearned) return [];
  return needsOf(mapProgress(s));
}

/** Can the map-drawing session be done now? With the switch on, not drawn yet, and nothing missing. */
export const mapSessionOpen = (s: Run): boolean => mapLearningOn(s) && descriptiveMapOn(s) && !s.mapLearned && mapUnlockNeeds(s).length === 0;

/** Why Draw your map can't be done now, or null. */
export function drawMapGate(s: Run): string | null {
  if (s.mapLearned) return DRAWN_REASON;
  return mapSessionOpen(s) ? null : NOT_YET_REASON;
}

/** A saved `mapLearned` that reads right: only `true` (absent means not yet). */
export const validMapLearned = (x: unknown): x is true => x === true;

/**
 * What's still needed to draw a map, by id, whichever rule the run plays: this module's with the
 * switch on, #1686's (home ground, something to draw on) with it off.
 */
export function mapNeedsFor(s: Run): (MapLearnNeed | 'home')[] {
  return mapLearningOn(s) ? mapUnlockNeeds(s) : mapNeedIds(s);
}

const NEED_TEXT: Readonly<Record<MapLearnNeed, (p: MapProgress) => string>> = {
  nights: p => `a few nights here first (${MAP_NIGHTS}; ${p.nights} so far)`,
  places: p => `more places found (${MAP_PLACES}; ${p.places} so far: explore, survey, find places to camp)`,
  directions: p => `places found in more directions (${MAP_DIRECTIONS}; ${p.directions} so far)`,
  surface: () => 'something to draw on (a notebook, a hide, or birch bark from cutting wood)',
};

/** What's still missing before the session opens, in words for the AI and the API (empty when nothing is). */
export function mapUnlockNeedTexts(s: Run): string[] {
  const p = mapProgress(s);
  return mapUnlockNeeds(s).map(n => NEED_TEXT[n](p));
}

// ── The session: a blank grid, camp in the middle ───────────────────────────

/** The grid is GRID × GRID squares, camp at (CENTRE, CENTRE), north up. */
export const GRID = 11;
export const CENTRE = 5;

export interface Cell { x: number; y: number }

/**
 * How far a place is, in the grid's rings: 0 within twenty minutes, 1 within three quarters of an
 * hour, 2 within an hour and a half, 3 within three hours, 4 beyond. A place in band b sits b + 1
 * squares from camp, so the near ones aren't crammed together and the far ones still fit.
 */
export function distanceBand(hours: number): number {
  if (hours < 1 / 3) return 0;
  if (hours < 0.75) return 1;
  if (hours < 1.5) return 2;
  if (hours < 3) return 3;
  return 4;
}

/** The square a place truly belongs on: its bearing, at its band's distance from camp. */
export function trueCell(p: Pick<MapPlace, 'bearing' | 'hours'>): Cell {
  const r = distanceBand(p.hours) + 1, a = p.bearing * Math.PI / 180;
  return { x: CENTRE + Math.round(r * Math.sin(a)), y: CENTRE - Math.round(r * Math.cos(a)) };
}

/** The bearing from camp to a square of the grid. */
export const cellBearing = (c: Cell): number => (Math.atan2(c.x - CENTRE, CENTRE - c.y) * 180 / Math.PI + 360) % 360;

/** Which band a square of the grid is in, by its distance from camp. */
export const cellBand = (c: Cell): number => Math.min(4, Math.max(0, Math.round(Math.hypot(c.x - CENTRE, c.y - CENTRE)) - 1));

/** The smaller angle between two bearings. */
const angleBetween = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export const isCentre = (c: Cell): boolean => c.x === CENTRE && c.y === CENTRE;
export const onGrid = (c: Cell): boolean => Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.y >= 0 && c.x < GRID && c.y < GRID;

/** How forgiving placing is: a bearing within `degrees` of the truth, a distance within `bands`; `sharp` hints say it all. */
export interface Tolerance { degrees: number; bands: number; sharp: boolean }

/** Intelligence at which the Warden remembers the land sharply, and the Fieldcraft level that does the same. */
export const SHARP_INT = 13;
export const SHARP_FIELDCRAFT = 2;

/**
 * How forgiving placing is for this Warden: a bearing within 45° (an eighth of the compass either
 * way) and a distance within one band, or, for a sharp Warden (Intelligence 13+, or Fieldcraft at
 * Apprentice or better: a camp-wise eye for the land), within 67.5°, with hints that give both the
 * direction and the distance.
 */
export function placementTolerance(s: Pick<Region1State, 'character' | 'skills'>): Tolerance {
  const sharp = s.character.stats.int >= SHARP_INT || skillLevel(s.skills, 'fieldcraft') >= SHARP_FIELDCRAFT;
  return sharp ? { degrees: 67.5, bands: 1, sharp: true } : { degrees: 45, bands: 1, sharp: false };
}

/** A gentle hint from what the Warden knows: the place's direction (as they'd say it) against the one tapped, and nearer or further. */
export interface Hint {
  id: string;
  /** The direction was wrong: `was` is the place's, `tapped` the square's, in the same words (eight points with the compass, four without). */
  dirWrong: boolean;
  was: { exact: boolean; i: number };
  tapped: { exact: boolean; i: number };
  /** The distance was wrong: the place is nearer or further than the square. */
  distance: 'nearer' | 'further' | null;
  /** The walking time the Warden knows. */
  time: TimeWord;
  /** A sharp Warden's hint says both the direction and the distance. */
  full: boolean;
}

export type Judgement = { ok: true } | { ok: false; hint: Hint };

/** Is this square near enough for this place? If not, the hint. Camp's own square never is. */
export function judgePlacement(p: MapPlace, c: Cell, tol: Tolerance): Judgement {
  const band = distanceBand(p.hours);
  const centre = isCentre(c);
  const dirOk = !centre && angleBetween(p.bearing, cellBearing(c)) <= tol.degrees;
  const off = centre ? band + 1 : cellBand(c) - band;
  const distOk = Math.abs(off) <= tol.bands && !centre;
  if (dirOk && distOk) return { ok: true };
  const tapped = { exact: p.dir.exact, i: centre ? p.dir.i : directionIndex(cellBearing(c), p.dir.exact) };
  return {
    ok: false,
    hint: {
      id: p.id,
      dirWrong: !dirOk && !centre,
      was: p.dir,
      tapped,
      distance: distOk ? null : off > 0 ? 'nearer' : 'further',
      time: p.time,
      full: tol.sharp,
    },
  };
}

/** A session in progress: where each place has been put (only the near-enough placements are kept). */
export interface MapSession { placed: Readonly<Record<string, Cell>> }

export const NEW_SESSION: MapSession = { placed: {} };

/** Put a place on a square: kept if it's near enough, else the hint. An unknown place or a square off the grid changes nothing. */
export function placeOn(s: Run, session: MapSession, id: string, c: Cell): { session: MapSession; judgement: Judgement | null } {
  const p = mapPlaces(s).find(q => q.id === id);
  if (!p || !onGrid(c)) return { session, judgement: null };
  const judgement = judgePlacement(p, c, placementTolerance(s));
  return { session: judgement.ok ? { placed: { ...session.placed, [id]: { x: c.x, y: c.y } } } : session, judgement };
}

/** The places not placed yet, in the order they're listed. */
export const unplaced = (s: Run, session: MapSession): MapPlace[] => mapPlaces(s).filter(p => !session.placed[p.id]);

/** Every place found is on the grid. */
export const sessionDone = (s: Run, session: MapSession): boolean => mapPlaces(s).length > 0 && unplaced(s, session).length === 0;

/** The keyboard's cursor on the grid: the arrow keys move it, and it stays on the grid. */
export function moveCell(c: Cell, key: string): Cell {
  const d = key === 'ArrowUp' ? [0, -1] : key === 'ArrowDown' ? [0, 1] : key === 'ArrowLeft' ? [-1, 0] : key === 'ArrowRight' ? [1, 0] : [0, 0];
  return { x: Math.min(GRID - 1, Math.max(0, c.x + d[0])), y: Math.min(GRID - 1, Math.max(0, c.y + d[1])) };
}
