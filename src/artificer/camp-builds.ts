/**
 * Each camp site keeps what you built there (#1753, switch `camp-builds-per-site`).
 *
 * The owner: "each site keeps its own and whatever else you build." With camp as an action (#1732)
 * a camp is a real place, a spot on the Reach (`kind@x,y`). Before this switch, making camp
 * somewhere else left the shelter behind for good and forgot the cold pit. With it on, the camp you
 * leave is kept in a record by its spot id, and the camp you go to is restored from its record, if
 * it has one.
 *
 * What a camp keeps (the camp-bound builds: everything in the Build group that stays in the ground):
 *
 * - **the shelter**: its tier, the latest build's grade and its design (roof, walls, where it was sited).
 *   The patrol's tarp (#1400) isn't a build: it goes with you, so a camp whose only roof is the tarp
 *   keeps no shelter. Walls raised under the tarp stay as they were built.
 * - **the cold pit**, with the raw food in it and the rot that food carries (`pitRot`, #1757).
 *
 * The camp you're at lives in the state's own fields (`tier`, `shelter`, `coldPitAt`, `pitRot`…), as
 * it always has; `siteBuilds` holds only the camps you're away from. So a save from before the
 * switch needs nothing new: its builds are the current camp's.
 *
 * Food in a pit you've left (the rules this issue sets): what the pit holds, up to its capacity,
 * stays in it when you go; the rest of your raw food goes with you. It's out of your stores until you
 * camp there again, then it's back in them. While you're away it spoils as it would in the pit,
 * worked out on your return night by night from the run's own seeded weather schedule (no draws: the
 * same seed and moves give the same pit). Nothing raids it.
 *
 * A shelter left standing weathers: a grade worse for every `WEATHER_DAYS` days away, never below
 * crude. Pure day arithmetic, no draws.
 *
 * Pure. The save gains one optional field, `siteBuilds`, only ever written with the switch on.
 */

import { featureOn } from './features';
import { campAsActionOn, parseSpotId } from './camp-sites';
import { GRADES, type Grade } from './crafting';
import { coldPitHolds, type Region1State, type ShelterType, type WallMaterial } from './region1';

/** The rule switch (features.ts). */
export const CAMP_BUILDS_PER_SITE = 'camp-builds-per-site';

/** On only where camp is an action too: without it there are no spot ids to keep camps by. */
export const buildsPerSiteOn = (s: Pick<Region1State, 'config'>): boolean => campAsActionOn(s) && featureOn(s.config.world.features, CAMP_BUILDS_PER_SITE);

/** Days away for a standing shelter to weather a grade. */
export const WEATHER_DAYS = 10;

/** A shelter left standing at a camp. */
export interface KeptShelter { tier: 1 | 2; grade: Grade; type: ShelterType; walls: WallMaterial | null; sited?: true }
/** A cold pit left at a camp: the raw food in it, and the rot that food owed when you left (#1757). */
export interface KeptPit { food: number; rot?: number }
/** A camp you've left: the day you left it, and what's built there. */
export interface SiteBuild { left: number; shelter?: KeptShelter; pit?: KeptPit }

const SHELTER_TYPES: readonly string[] = ['leanto', 'hut'];
const WALLS: readonly string[] = ['timber', 'stone'];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;

function validShelter(x: unknown): x is KeptShelter {
  if (!isObj(x)) return false;
  return (x.tier === 1 || x.tier === 2) && GRADES.includes(x.grade as Grade) && SHELTER_TYPES.includes(x.type as string)
    && (x.walls === null || WALLS.includes(x.walls as string)) && (x.tier === 2) === (x.walls !== null) && (x.sited === undefined || x.sited === true);
}

function validPit(x: unknown): x is KeptPit {
  if (!isObj(x)) return false;
  return isCount(x.food) && (x.rot === undefined || (typeof x.rot === 'number' && Number.isFinite(x.rot) && x.rot > 0 && x.rot < 1));
}

/** A saved `siteBuilds` that reads right: each key a spot id, each camp with a day left and a shelter, a pit or both. */
export function validSiteBuilds(x: unknown): x is Record<string, SiteBuild> {
  if (!isObj(x)) return false;
  return Object.entries(x).every(([id, b]) => parseSpotId(id) !== null && isObj(b) && Number.isInteger(b.left) && (b.left as number) >= 1
    && (b.shelter !== undefined || b.pit !== undefined) && (b.shelter === undefined || validShelter(b.shelter)) && (b.pit === undefined || validPit(b.pit)));
}

/** A grade `steps` worse, never below crude. */
export const weathered = (g: Grade, steps: number): Grade => GRADES[Math.max(0, GRADES.indexOf(g) - Math.max(0, steps))];

/** Grades a shelter loses after `days` away. */
export const weatherSteps = (days: number): number => Math.floor(Math.max(0, days) / WEATHER_DAYS);

// ── What's built where, in words ────────────────────────────────────────────

/** One thing built at a camp: a roof, walls, or the cold pit (`n`: the raw food in it, when any). */
export interface BuildItem { key: 'leanto' | 'hut' | 'timber' | 'stone' | 'pit'; n?: number }

/** The builds as English, as the AI and the API read them (the page says the same keys, `campsite.build.*`). */
export const BUILD_TEXT: Readonly<Record<BuildItem['key'] | 'pitFood', string>> = {
  leanto: 'lean-to', hut: 'brush hut', timber: 'timber walls', stone: 'stone-banked walls', pit: 'cold pit', pitFood: 'cold pit ({n} raw food)',
};

const itemsOf = (shelter: Pick<KeptShelter, 'type' | 'walls'> | null, pit: KeptPit | null): BuildItem[] => [
  ...(shelter ? [{ key: shelter.type } as BuildItem] : []),
  ...(shelter?.walls ? [{ key: shelter.walls } as BuildItem] : []),
  ...(pit ? [pit.food > 0 ? { key: 'pit' as const, n: pit.food } : { key: 'pit' as const }] : []),
];

type Run = Pick<Region1State, 'config' | 'campSpot' | 'siteBuilds' | 'site' | 'tier' | 'shelterGrade' | 'shelter' | 'coldPitAt' | 'stores' | 'kit'>;

/** The tarp is the only roof here: the tarp goes up wherever you camp, and you never raise a roof under it. */
const tarpRoof = (s: Run): boolean => s.tier === 1 && (s.kit?.items.includes('tarp') ?? false);

/**
 * The camp you're at, as it would be kept if you left now: the shelter (unless the tarp is its only
 * roof) and the cold pit with the food it would keep. Null parts where there's none.
 */
export function campHere(s: Run): { shelter: KeptShelter | null; pit: KeptPit | null } {
  const shelter: KeptShelter | null = s.tier > 0 && s.shelter.type && s.shelterGrade && !tarpRoof(s)
    ? { tier: s.tier as 1 | 2, grade: s.shelterGrade, type: s.shelter.type, walls: s.tier === 2 ? s.shelter.walls ?? 'timber' : null, ...(s.shelter.sited ? { sited: true as const } : {}) }
    : null;
  const pit: KeptPit | null = s.site && s.coldPitAt === s.site ? { food: Math.min(s.stores.rawFood, coldPitHolds(s.site)) } : null;
  return { shelter, pit };
}

/**
 * What's built at a camp site, by its spot id: the camp you're at as it stands, another from its
 * record. Empty with the switch off, or where nothing's built.
 */
export function buildsAt(s: Run, id: string): BuildItem[] {
  if (!buildsPerSiteOn(s)) return [];
  if (s.campSpot?.at === id) { const h = campHere(s); return itemsOf(h.shelter, h.pit); }
  const b = s.siteBuilds?.[id];
  return b ? itemsOf(b.shelter ?? null, b.pit ?? null) : [];
}

/** The builds in English: "lean-to, timber walls, cold pit (5 raw food)"; '' when none. */
export const buildsText = (items: readonly BuildItem[]): string =>
  items.map(i => (i.n ? BUILD_TEXT.pitFood.replace('{n}', String(i.n)) : BUILD_TEXT[i.key])).join(', ');

/** What the Make camp action's note says of a site's builds, in English (`campsite.<key>` on the page). */
export const NOTE_TEXT: Readonly<Record<MoveNote['key'], string>> = {
  builtThere: 'built there: {list}', keeps: 'your camp here stays as it is', leavesFood: 'leaves {n} raw food in the cold pit',
};

/** One part of a Make camp option's note: what's built there, or (moving away) that this camp stays, and the food left in its pit. */
export interface MoveNote { key: 'builtThere' | 'keeps' | 'leavesFood'; items?: BuildItem[]; n?: number }

/**
 * What a Make camp option says of the builds (#1753): at another site, what's built there; and,
 * since going means leaving, that the camp here stays as it is, and how much raw food stays in its
 * pit. Nothing for the site you're at, or with the switch off.
 */
export function moveNotes(s: Run, p: { id: string; here: boolean }): MoveNote[] {
  if (!buildsPerSiteOn(s) || p.here) return [];
  const there = buildsAt(s, p.id);
  const here = s.campSpot ? campHere(s) : { shelter: null, pit: null };
  return [
    ...(there.length ? [{ key: 'builtThere' as const, items: there }] : []),
    ...(here.shelter || here.pit ? [{ key: 'keeps' as const }] : []),
    ...(here.pit?.food ? [{ key: 'leavesFood' as const, n: here.pit.food }] : []),
  ];
}

/** The camps you're away from that have something built, in spot-id order (plain string order): for the AI. */
export const keptCamps = (s: Run): { id: string; items: BuildItem[] }[] =>
  buildsPerSiteOn(s) ? Object.keys(s.siteBuilds ?? {}).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(id => ({ id, items: buildsAt(s, id) })).filter(c => c.items.length) : [];
