/**
 * Camp sites are real places you've explored, and making camp is an action (#1732, switch
 * `camp-as-action`).
 *
 * The owner's idea: "make camp should work like any other action. Only sites you've explored are
 * available, and every possible camp site should correspond to a real place on the map." And then:
 * "your Intelligence score, your talents and your skills decide what you know about the possible
 * camp sites."
 *
 * So a camp site is a square of the run's Reach (world/reach.ts, the same land the LAND tab and
 * #1686's descriptions come from), of one of today's four kinds, and keeps that kind's rules
 * (region1.ts `SITES`: how warm a shelter there can get, the river's water, the treeline's wood,
 * the hilltop's look-out):
 *
 * - a **cave** in the high ground (a scree or fell square);
 * - a **treeline**: the edge of a birch or pine wood (a wood square with open ground beside it);
 * - a **riverbank**: a square of the stream;
 * - a **hilltop**: open heath, or a meadow that stands higher than the ground around it.
 *
 * The start of the run is a site too (the first night's camp is where you start). Every other kind
 * is offered at its nearest square once the land it's about is known well enough there: the ring
 * it lies in observed (level 2) for that kind's domain (water for the stream, stone for a cave…).
 * Exploring finds new camp spots.
 *
 * What you can tell about a site (its wind, how far the water and the wood are, the ground, a
 * hidden risk) is read by `siteKnowledge`: a score from Intelligence, Scouting and Fieldcraft (a
 * scout's eye and camp skill), Keen Eye, and how well the area is known, in three bands — vague,
 * fair and sharp — and the truth once you've camped there. A vague reading can misjudge one trait,
 * seeded by a string key (run seed, site, band), never a draw on the sim's streams: the same
 * Warden and site always read the same.
 *
 * Pure and deterministic. The save gains one optional field (`campSpot`: where camp is and where
 * you've camped), only ever written with the switch on.
 */

import { featureOn } from './features';
import { hasKit } from './kit';
import { generator, seedOf } from './rng';
import { level, type Domain, type Ring } from './exploration';
import { skillLevel } from './skills';
import { reachOfRun, directionWords, directionIndex, timeWord, timeWords, type TimeWord } from './descriptive-map';
import { walkingHours, ringOfHours, type Biome, type Reach } from './world/reach';
import type { Region1State, SiteId } from './region1';

/** The rule switch (features.ts). */
export const CAMP_AS_ACTION = 'camp-as-action';

export const campAsActionOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, CAMP_AS_ACTION);

/** Hours to set up camp once you're there: clear the ground, lay the fire, rig a windbreak. The walk comes on top. */
export const CAMP_SETUP_HOURS = 2;

/** What a run needs for this: its switches, who it is, what it knows, what it packed, its skills and its camp. */
type Run = Pick<Region1State, 'config' | 'character' | 'explore' | 'kit' | 'skills' | 'campSpot'>;

/** Where camp is, as saved: the spot's id, and every spot camped at (whose truth you know). */
export interface CampSpotState { at: string; camped: string[] }

/** The squares each kind of site can be: the Reach's own ground. */
export const SPOT_BIOMES: Readonly<Record<SiteId, readonly Biome[]>> = {
  cave: ['scree', 'fell'], tree: ['birch', 'pine'], river: ['river'], hill: ['heath', 'meadow'],
};
/** The kinds in the order they're offered after the start, when two are as far away. */
const KINDS: readonly SiteId[] = ['cave', 'tree', 'river', 'hill'];
/** What knowing a site's area means: the ring's domain that kind of place is about. */
const SPOT_DOMAIN: Readonly<Record<SiteId, Domain>> = { cave: 'stone', tree: 'timber', river: 'water', hill: 'forage' };

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const WOOD: readonly Biome[] = ['birch', 'pine'];
const WET: readonly Biome[] = ['marsh', 'river', 'lake'];

const neighbours = (r: Reach, x: number, y: number): number[] =>
  NEIGHBOURS.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < r.w && ny < r.h).map(([nx, ny]) => ny * r.w + nx);

/** Is this square a site of this kind? A wood's edge, a stream, high ground, or open heath (a meadow only on a rise). */
function isSpot(r: Reach, kind: SiteId, i: number): boolean {
  const c = r.cells[i];
  if (!SPOT_BIOMES[kind].includes(c.biome)) return false;
  const x = i % r.w, y = Math.floor(i / r.w);
  if (kind === 'tree') return neighbours(r, x, y).some(j => !WOOD.includes(r.cells[j].biome));
  if (kind === 'hill' && c.biome === 'meadow') return neighbours(r, x, y).every(j => r.cells[j].height <= c.height);
  return true;
}

/** The kind of site the run starts on: the Reach's camp square is always meadow, heath, birch or pine. */
const startKind = (r: Reach): SiteId => (WOOD.includes(r.cells[r.camp.y * r.w + r.camp.x].biome) ? 'tree' : 'hill');

export const spotId = (kind: SiteId, x: number, y: number): string => `${kind}@${x},${y}`;

/** A spot id read back: its kind and square, or null when it isn't one. */
export function parseSpotId(id: string): { kind: SiteId; x: number; y: number } | null {
  const m = /^(cave|tree|river|hill)@(\d+),(\d+)$/.exec(id);
  return m ? { kind: m[1] as SiteId, x: Number(m[2]), y: Number(m[3]) } : null;
}

/** A saved `campSpot` that reads right: a real spot id where camp is, and a list of spot ids. */
export function validCampSpot(x: unknown): x is CampSpotState {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return typeof o.at === 'string' && parseSpotId(o.at) !== null && Array.isArray(o.camped) && o.camped.every(c => typeof c === 'string' && parseSpotId(c) !== null);
}

/** Where camp is now, with the switch on and camp made; null otherwise. */
export const campSpotOf = (s: Pick<Region1State, 'campSpot'>): CampSpotState | null => s.campSpot ?? null;

// ── Walking on the Reach ────────────────────────────────────────────────────
// A walk from any square to every other (Dijkstra, world/reach.ts). A few milliseconds each, and the
// app and the AI ask often, so the last few are kept.
const walks = new Map<string, number[]>();
function walkFrom(r: Reach, x: number, y: number): number[] {
  if (x === r.camp.x && y === r.camp.y) return r.hours;
  const key = `${r.seed}|${x},${y}`;
  let w = walks.get(key);
  if (!w) {
    w = walkingHours(r.cells, r.w, r.h, { x, y });
    if (walks.size >= 16) walks.delete(walks.keys().next().value as string);
    walks.set(key, w);
  }
  return w;
}

/** Where the Warden is: the camp's square, or the Reach's camp (where the run starts) before one is made this way. */
function whereYouAre(s: Run, r: Reach): { x: number; y: number } {
  const at = s.campSpot ? parseSpotId(s.campSpot.at) : null;
  return at ? { x: at.x, y: at.y } : r.camp;
}

// ── The sites you know ──────────────────────────────────────────────────────

export interface CampSpot {
  /** `kind@x,y`: what the action's `spot` option takes. */
  id: string;
  kind: SiteId;
  x: number;
  y: number;
  /** Where the run started. */
  start: boolean;
  /** Where camp is now (never, before camp is made). */
  here: boolean;
  /** Where you are: camp, or (before camp is made) where the run starts. */
  atYou: boolean;
  /** Hours on foot from where you are. */
  hours: number;
  /** Compass bearing from where you are, degrees clockwise from north. */
  bearing: number;
  /** Its direction and walking time as parts (#1707), for the page to say in the viewer's language. */
  dir: { exact: boolean; i: number };
  time: TimeWord;
  /** "due west, about 45 minutes" (or "where you are"): the English the AI and the API read. */
  text: string;
}

/** Degrees clockwise from north, from (fx, fy) to (x, y). Screen y grows southwards. */
const bearingFrom = (fx: number, fy: number, x: number, y: number): number => (Math.atan2(x - fx, fy - y) * 180 / Math.PI + 360) % 360;

/**
 * The camp sites you know, the one you're at first, then where the run started, then the nearest
 * of each kind you've explored enough to know of (observed or better), nearest first. Empty with
 * the switch off.
 */
export function knownSpots(s: Run): CampSpot[] {
  if (!campAsActionOn(s)) return [];
  const r = reachOfRun(s);
  const found: { kind: SiteId; i: number; start: boolean }[] = [{ kind: startKind(r), i: r.camp.y * r.w + r.camp.x, start: true }];
  // The Reach's own walking times (from the start) decide which square of each kind is "the nearest":
  // the same squares whichever site you're camped at, so moving doesn't shuffle what you know.
  const near = new Set([r.camp.y * r.w + r.camp.x, ...neighbours(r, r.camp.x, r.camp.y)]);
  for (const kind of KINDS) {
    let best = -1;
    for (let i = 0; i < r.cells.length; i++) {
      if (near.has(i) || !isSpot(r, kind, i)) continue;
      const hrs = r.hours[i];
      const ring = ringOfHours(hrs);
      if (!ring || level(s.explore, ring, SPOT_DOMAIN[kind]) < 2) continue;
      if (best === -1 || hrs < r.hours[best]) best = i;
    }
    if (best !== -1) found.push({ kind, i: best, start: false });
  }
  // The site you're camped at stays known, even if it isn't the nearest of its kind.
  const at = s.campSpot ? parseSpotId(s.campSpot.at) : null;
  if (at && !found.some(f => f.i === at.y * r.w + at.x)) found.push({ kind: at.kind, i: at.y * r.w + at.x, start: false });

  const from = whereYouAre(s, r);
  const walk = walkFrom(r, from.x, from.y);
  const compass = hasKit(s, 'map-compass');
  const spots = found.map(f => {
    const x = f.i % r.w, y = Math.floor(f.i / r.w);
    const atYou = x === from.x && y === from.y;
    const here = atYou && !!s.campSpot;
    const hours = atYou ? 0 : walk[f.i];
    const bearing = bearingFrom(from.x, from.y, x, y);
    // Surveyed ground gives a sure walking time, as #1686's descriptions do; the start you walked yourself.
    const ring: Ring = ringOfHours(r.hours[f.i]) ?? 3;
    const exactTime = compass || f.start || level(s.explore, ring, SPOT_DOMAIN[f.kind]) >= 2;
    const text = atYou ? 'where you are' : `${directionWords(bearing, compass)}, ${timeWords(hours, exactTime)}`;
    return {
      id: spotId(f.kind, x, y), kind: f.kind, x, y, start: f.start, here, atYou, hours, bearing,
      dir: { exact: compass, i: directionIndex(bearing, compass) }, time: timeWord(hours, exactTime), text,
    };
  });
  return spots.sort((a, b) => Number(b.atYou) - Number(a.atYou) || Number(b.start) - Number(a.start) || a.hours - b.hours);
}

/** A known site by its id, or undefined. */
export const knownSpot = (s: Run, id: string | undefined): CampSpot | undefined => (id ? knownSpots(s).find(p => p.id === id) : undefined);

/** The site the action offers first: where the run starts, before any camp; then the nearest other one. */
export function defaultSpot(s: Run): CampSpot | undefined {
  const spots = knownSpots(s);
  return s.campSpot ? spots.find(p => !p.here) : spots[0];
}

// ── What a site is really like ──────────────────────────────────────────────

export type Wind = 'still' | 'some' | 'open';
export type Ground = 'dry' | 'damp';
export type RiskId = 'floods' | 'rockfall' | 'deadfall' | 'lightning';

export interface SpotTraits {
  wind: Wind;
  /** Hours on foot to water (0: it's at hand) and to wood. */
  waterHours: number;
  fuelHours: number;
  ground: Ground;
  /** A danger you can't see at a glance, or null. */
  risk: RiskId | null;
}

/** Each kind's danger, and how often a site of that kind has it. */
const RISK: Readonly<Record<SiteId, { id: RiskId; chance: number }>> = {
  river: { id: 'floods', chance: 0.6 }, cave: { id: 'rockfall', chance: 0.45 }, tree: { id: 'deadfall', chance: 0.4 }, hill: { id: 'lightning', chance: 0.4 },
};
/** How the wind finds each kind of site: a cave is out of it, a hilltop open to it. */
const KIND_WIND: Readonly<Record<SiteId, Wind>> = { cave: 'still', tree: 'some', river: 'some', hill: 'open' };

/** Nearest walk from a square to any square that matches. */
function nearestWalk(r: Reach, walk: readonly number[], match: (i: number) => boolean): number {
  let best = Infinity;
  for (let i = 0; i < r.cells.length; i++) if (match(i) && walk[i] < best) best = walk[i];
  return best;
}

/** What a site is really like, from its square and the squares around it, and (its hidden risk) a string-keyed seed. */
export function spotTraits(s: Pick<Region1State, 'character'>, spot: Pick<CampSpot, 'kind' | 'x' | 'y'>): SpotTraits {
  const r = reachOfRun(s);
  const i = spot.y * r.w + spot.x;
  const around = neighbours(r, spot.x, spot.y);
  // A pine wood's edge, or a stream in a hollow, is out of the wind; standing above everything around you isn't.
  const base = KIND_WIND[spot.kind];
  const exposed = around.every(j => r.cells[j].height < r.cells[i].height);
  const wind: Wind = spot.kind === 'cave' ? 'still' : spot.kind === 'hill' ? 'open'
    : r.cells[i].biome === 'pine' && !exposed ? 'still' : exposed ? 'open' : base;
  const walk = walkFrom(r, spot.x, spot.y);
  // Water: the stream, or a lake's shore (open water is reached from the square beside it).
  const waterHours = spot.kind === 'river' ? 0 : nearestWalk(r, walk, j => r.cells[j].biome === 'river' || neighbours(r, j % r.w, Math.floor(j / r.w)).some(k => r.cells[k].biome === 'lake') && r.cells[j].biome !== 'lake');
  const fuelHours = WOOD.includes(r.cells[i].biome) ? 0 : nearestWalk(r, walk, j => WOOD.includes(r.cells[j].biome));
  const ground: Ground = spot.kind === 'river' || around.some(j => WET.includes(r.cells[j].biome)) ? 'damp' : 'dry';
  const risky = generator(seedOf(`${r.seed}|camp-risk|${spot.x},${spot.y}`))() < RISK[spot.kind].chance;
  return { wind, waterHours, fuelHours, ground, risk: risky ? RISK[spot.kind].id : null };
}

// ── What you can tell about it ──────────────────────────────────────────────

export type ReadingBand = 'vague' | 'fair' | 'sharp' | 'known';

/** Score at which a reading is fair, and sharp. */
export const FAIR_FROM = 1.5, SHARP_FROM = 3.5;

/**
 * How well you can read a site, as a score: Intelligence (how well you reason about what you see,
 * ±0.5 a point from 10), half a point a level of Scouting and of Fieldcraft (a scout's eye, camp
 * craft: the true level does the work, as with every skill), Keen Eye a point a tier, and a point
 * for knowing the area in detail.
 */
export function readingScore(s: Run, spot: Pick<CampSpot, 'kind' | 'x' | 'y'>): number {
  const r = reachOfRun(s);
  const intMod = (s.character.stats.int - 10) / 2;
  const skill = 0.5 * skillLevel(s.skills, 'scouting') + 0.5 * skillLevel(s.skills, 'fieldcraft');
  const keen = s.character.talents.find(t => t.id === 'keenEye')?.tier ?? 0;
  const ring: Ring = ringOfHours(r.hours[spot.y * r.w + spot.x]) ?? 3;
  const area = level(s.explore, ring, SPOT_DOMAIN[spot.kind]) >= 3 ? 1 : 0;
  return intMod + skill + keen + area;
}

/** The reading's band: the truth once you've camped there, else by the score. */
export function readingBand(s: Run, spot: Pick<CampSpot, 'kind' | 'x' | 'y'>): ReadingBand {
  if (s.campSpot?.camped.includes(spotId(spot.kind, spot.x, spot.y))) return 'known';
  const score = readingScore(s, spot);
  return score >= SHARP_FROM ? 'sharp' : score >= FAIR_FROM ? 'fair' : 'vague';
}

/** One thing you can tell about a site: its trait, the words (an i18n key under `campsite.fact.`), minutes where they say a number. */
export interface SiteFact { trait: 'wind' | 'water' | 'fuel' | 'ground' | 'risk'; key: string; n?: number; misjudged?: boolean }

/** The facts' English, as the AI and the API read them (the app says the same keys in the viewer's language). */
export const FACT_TEXT: Readonly<Record<string, string>> = {
  looksSheltered: 'Looks sheltered.', looksOpen: 'Looks open to the wind.', seemsDry: 'Seems dry.', seemsDamp: 'Seems damp.',
  waterNear: 'Near water.', waterOff: 'Water somewhere off.',
  outOfWind: 'Out of the wind.', someWind: 'Some shelter from the wind.', openWind: 'Open to the wind.',
  waterShort: 'Water a short walk away.', waterWalk: 'Water within the hour.', waterFar: 'Water a long walk off.',
  woodClose: 'Wood close by.', woodWalk: 'Wood within the hour.', woodFar: 'Wood a long walk off.',
  groundDry: 'The ground is dry.', groundDamp: 'The ground is damp.',
  waterHere: 'Water right here.', waterAt: 'Water about {n} minutes away.', woodHere: 'Wood all around.', woodAt: 'Wood about {n} minutes away.',
  floods: 'The bank floods after heavy rain.', rockfall: 'Loose rock above.', deadfall: 'A dead tree leans over the spot.', lightning: 'Lightning finds the high ground here.',
  noRisk: 'No hidden danger that you can see.',
};
/** How sure the reading is, in English. */
export const BAND_TEXT: Readonly<Record<ReadingBand, string>> = { vague: 'at a glance', fair: 'a fair read', sharp: 'a sharp read', known: 'you camped here' };

export const factText = (f: SiteFact): string => FACT_TEXT[f.key].replace('{n}', String(f.n ?? 0));

const SHORT = 0.25, HOUR = 1;
const minutes = (h: number): number => Math.max(5, Math.round(h * 12) * 5);
const fairDistance = (h: number, short: string, walk: string, far: string): string => (h <= SHORT ? short : h <= HOUR ? walk : far);

/** What a site reads as, in this band, before any misjudgement. */
function factsFor(t: SpotTraits, band: ReadingBand): SiteFact[] {
  if (band === 'vague') {
    return [
      { trait: 'wind', key: t.wind === 'open' ? 'looksOpen' : 'looksSheltered' },
      { trait: 'water', key: t.waterHours <= SHORT ? 'waterNear' : 'waterOff' },
      { trait: 'ground', key: t.ground === 'dry' ? 'seemsDry' : 'seemsDamp' },
    ];
  }
  const wind: SiteFact = { trait: 'wind', key: t.wind === 'still' ? 'outOfWind' : t.wind === 'some' ? 'someWind' : 'openWind' };
  const ground: SiteFact = { trait: 'ground', key: t.ground === 'dry' ? 'groundDry' : 'groundDamp' };
  if (band === 'fair') {
    return [wind,
      { trait: 'water', key: t.waterHours === 0 ? 'waterHere' : fairDistance(t.waterHours, 'waterShort', 'waterWalk', 'waterFar') },
      { trait: 'fuel', key: t.fuelHours === 0 ? 'woodHere' : fairDistance(t.fuelHours, 'woodClose', 'woodWalk', 'woodFar') }, ground];
  }
  const exact = (h: number, here: string, at: string, trait: 'water' | 'fuel'): SiteFact => (h === 0 ? { trait, key: here } : { trait, key: at, n: minutes(h) });
  return [wind, exact(t.waterHours, 'waterHere', 'waterAt', 'water'), exact(t.fuelHours, 'woodHere', 'woodAt', 'fuel'), ground, { trait: 'risk', key: t.risk ?? 'noRisk' }];
}

/** A vague reading's opposite words, for the trait it gets wrong. */
const FLIP: Readonly<Record<string, string>> = { looksOpen: 'looksSheltered', looksSheltered: 'looksOpen', waterNear: 'waterOff', waterOff: 'waterNear', seemsDry: 'seemsDamp', seemsDamp: 'seemsDry' };

export interface SiteKnowledge { band: ReadingBand; facts: SiteFact[]; text: string }

/**
 * What you can tell about a site, from your reading of it (`readingBand`). Vague: three things at a
 * glance, and half the time one of them wrong (which one, seeded by the run, the site and the band,
 * so it always reads the same). Fair: the wind, the water, the wood and the ground, in rough
 * distances. Sharp, or camped there: exact walking times, and any hidden risk.
 */
export function siteKnowledge(s: Run, spot: Pick<CampSpot, 'kind' | 'x' | 'y'>): SiteKnowledge {
  const band = readingBand(s, spot);
  let facts = factsFor(spotTraits(s, spot), band);
  if (band === 'vague') {
    const r = reachOfRun(s);
    const draw = generator(seedOf(`${r.seed}|camp-read|${spot.x},${spot.y}|${band}`));
    if (draw() < 0.5) {
      const wrong = Math.floor(draw() * facts.length);
      facts = facts.map((f, i) => (i === wrong ? { ...f, key: FLIP[f.key], misjudged: true } : f));
    }
  }
  return { band, facts, text: `${BAND_TEXT[band]}: ${facts.map(factText).join(' ')}` };
}
