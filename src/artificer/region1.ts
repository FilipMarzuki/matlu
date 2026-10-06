/**
 * Region 1 — Greywind Reach: the playable opening loop, headless (#1207).
 *
 * Composes the sim-core modules into the Region 1 game: you arrive with almost
 * nothing, winter is coming, and you plan each day as a queue of actions to lay
 * in a larder, winterize a shelter, stock fuel and stay sound — then live
 * through the winter on what you built, until the thaw (#1302,
 * docs/region-1-design.md).
 *
 * Same discipline as the rest of src/artificer: pure functions that return a
 * new state, deterministic (no randomness yet), no Phaser imports. A DOM
 * frontend, a test, or Core Warden can all drive it identically.
 */

import { talentEffects, talentDrain, startingTalents, startingPractice, growTalents, TIER_UP_LINE, type GrowthEvent, type Talent, type TalentId } from './talents';
import { DEFAULT_STATS, statEffects, statDrain, type Stats } from './stats';
import { FULL_WORLD, type WorldConfig } from './world';
import { clockHour, lightOver } from './clock';
import { darkYieldMult, darkWorkDrain, darkTravelDrain, tooDarkToSee, nightWork, scaleHaul } from './darkness';
import { weatherFor, weatherName, lateFrom, isBlizzard, nextSnowDepth, snowSlow, iceThick, exposureFor, EXPOSURE_COST, BLIZZARD_HOURS, DANGER_SENSE_INT, tempAt, nightTemp, isColdNight, coldNightNeeds, fireNeed, freezeLoss, meltsSnow, MELT_FIREWOOD, iceOn, FREEZING_WORK, ICE_EXTRA_HOURS, weatherHours, blindInFog, stormBars, weatherDrain, windChill, windFire, WET_HOURS, WET_CLARITY, type Forecast, type WeatherId } from './weather';
import { seedOf, streamFor } from './rng';
import { TECHNIQUES, MANUAL_BY_RING, techniqueById, manualById, techniqueEffects, selfLearnHours, canBeTaught, guidanceRate, techniqueFactor, type Guidance, type Technique } from './techniques';
import { survivalLock, workEffects, reliability, focusLabel, FOCUS_COST, CONCEPT_PER_HOUR, type Focus } from './focus';
import { SKILLS, skillFor, skillLevel, perceivedLevel, practise, drainMult, toolMult, yieldBonus, craftBonus, type SkillId, type SkillPractice } from './skills';
import { applyActivity, driftCapacity, recoverCondition, createVitals, type Vitals } from './vitality';
import { isWinterReady, evaluateMilestones, DEFAULT_THRESHOLDS, type MilestoneDef, type ReadinessInput, type ReadinessThresholds } from './readiness';
import { gradeOf, seasonOf, MIDWINTER_AFTER, DEFAULT_CALENDAR, type Calendar, type Outcome } from './winter';
import { ACTION_DOMAIN, BAND_MULT, bandFor, bandLine, haulFortune, luckShifts, luckSteps, oddsWord, type Band, type Shift } from './luck';
import { createExploration, scout, survey, track, lookout, work, regrow, level, scouted, reachable, landYield, supplyFactor, hasFind, RICHNESS, type GrowSeason, RINGS, RING_NAME, TRAVEL_HOURS, FINDS, type Domain, type Exploration, type Ring } from './exploration';
import type { Legacy } from './legacy';
import { craft, craftBlocker, addInsight, study as studyConcept, craftWorld, createCrafter, capabilities, modifiersFor, GRADES, DEFAULT_EFFECTS, type CraftRecipe, type CrafterState, type ConceptProgress, type Grade, type Tool } from './crafting';

/** Waking hours you can queue in a day; the queue spills into the next. */
export const DAY_HOURS = 14;

// ── Sites & shelter ─────────────────────────────────────────────────────────

export type SiteId = 'cave' | 'tree' | 'river' | 'hill';

/**
 * Where you settle sets how warm a finished shelter can get — which drives
 * both winter-readiness and nightly Clarity recovery. A cold site can never
 * truly winterize, so the site choice *is* a winter choice.
 */
export const SITES: Readonly<Record<SiteId, { name: string; warmth: number }>> = {
  cave: { name: 'Cave', warmth: 0.9 },
  tree: { name: 'Treeline', warmth: 0.7 },
  river: { name: 'Riverbank', warmth: 0.4 },
  hill: { name: 'Hilltop', warmth: 0.2 },
};

/** How much of a site's warmth an unbuilt camp realises (a fire and a windbreak). */
const OPEN_CAMP_FACTOR = 0.3;
/** Materials for the default builds: a lean-to (tier 1), then timber walls (tier 2). */
export const BUILD_COST = [3, 5] as const;
export type Tier = 0 | 1 | 2;

/** The first stage of a shelter: what kind of roof you raise. */
export type ShelterType = 'leanto' | 'hut';
/** The second stage: what you winterize it with. */
export type WallMaterial = 'timber' | 'stone';
/** The design choices behind the shelter at the current site. */
export interface ShelterBuild { type: ShelterType | null; walls: WallMaterial | null }
/**
 * How well the shelter was built scales its warmth (capped at fully warm): a
 * crude lean-to leaks, a fine one holds heat. Keyed by the latest build's grade.
 */
export const GRADE_WARMTH: Readonly<Record<Grade, number>> = { crude: 0.85, sound: 1, fine: 1.1, masterwork: 1.2 };

// ── State ───────────────────────────────────────────────────────────────────

export interface Stores {
  rawFood: number;
  water: number;
  firewood: number;
  materials: number;
  /** Preserved food — the winter larder (not today's meals). */
  rations: number;
  /** Quarried stone — for stone-banked walls. */
  stone: number;
  /** Hides from deer hunts — for waterskins and hide parkas. */
  hides: number;
}

export interface LogEntry {
  day: number;
  text: string;
  kind: 'action' | 'skip' | 'milestone' | 'hardship' | 'outcome';
  /** For work: when it started (clock hour) and the average light it had, walk included (#1280). */
  at?: { hour: number; light: number };
}

export interface Region1Config {
  calendar: Calendar;
  thresholds: ReadinessThresholds;
  /** Which parts of the living world are on (#1279): the full world in play, the flat world for isolated tests. */
  world: WorldConfig;
}

export interface Region1State {
  day: number;
  hoursToday: number;
  vitals: Vitals;
  stores: Stores;
  /** Road-worthy (not crude) cold gear — derived from the cold-gear tool after each craft. */
  coldGear: boolean;
  /** What you know of the land, ring by ring (src/artificer/exploration.ts). */
  explore: Exploration;
  site: SiteId | null;
  tier: Tier;
  /** Grade of the latest shelter build (null before the first). */
  shelterGrade: Grade | null;
  /** Which roof and walls were chosen (reset when you move). */
  shelter: ShelterBuild;
  /** One-way "ever did X" flags behind the first-time milestones. */
  flags: { everWater: boolean; everFood: boolean; everWood: boolean; everHunt: boolean; everPreserve: boolean; everHide: boolean };
  /** Recipe ids you know how to make (the rest are discovered — see DISCOVERIES). */
  known: string[];
  /** Study sessions per concept today (diminishing returns; reset each night). */
  studiedToday: Record<string, number>;
  milestones: string[];
  /** Crafted items that carry effects (src/artificer/crafting.ts). */
  tools: Tool[];
  /** Concept ranks and insight, earned by crafting. */
  concepts: Record<string, ConceptProgress>;
  /** Running totals for today, fed to nightly capacity drift. */
  /** Today so far. `outside` / `absorbed` (#1305): went out on the land; did study or craft work — either keeps cabin fever off. */
  today: { loadVigor: number; loadClarity: number; pushedVigor: boolean; pushedClarity: boolean; outside?: boolean; absorbed?: boolean };
  /** Nights in a row without food / without water (#1233); each night without costs more. */
  deprivation: { hungry: number; thirsty: number };
  /** Practice hours per skill (#1236); levels come from these. */
  skills: SkillPractice;
  /** Who the Warden is (#1237, #1239, #1263): name, portrait, talents, stats, and whether Tough's last stand is spent. */
  character: Character;
  /** What the mind is working on (#1238), or null. The survival lock can override it (survivalLockOf). */
  focus: Focus | null;
  /** Techniques known (#1243) — knowledge, so it carries with the character. */
  techniques: string[];
  /** Manuals owned (#1243): they guide practice in their skill and teach their techniques when you're ready. */
  manuals: string[];
  /** Today's weather (#1282) — a fixed seeded schedule per character. */
  weatherToday: WeatherId;
  /** What the Warden knows of the coming days' weather (#1282): from a look-out or Weather sense. */
  forecast: Forecast;
  /** Hours spent outside in today's rain (#1284); reset each dawn. */
  wetHours?: number;
  /** Snow cover on the ground, 0 (bare) to 1 (deep) (#1315). Absent on saves from before it: bare. */
  snowDepth?: number;
  /** How the Warden eats (#1305): a standing choice, set like focus. Absent: full. */
  eating?: EatingPlan;
  /** Days in a row cooped up — not out on the land, no study or craft (#1305). */
  cabinDays?: number;
  log: LogEntry[];
  outcome: Outcome | null;
  config: Region1Config;
}

/** A fresh save: day 1, baseline body, a couple of meals, nothing known. */
/** Who the Warden is. `id` ties runs and carried knowledge to this one person (#1242). */
export interface Character {
  id: string;
  name: string;
  portrait: string | null;
  /** Talents (#1263): two chosen (known) and one hidden, each with a tier the player never sees. */
  talents: Talent[];
  lastStandUsed: boolean;
  /** Base stats (#1256). */
  stats: Stats;
}

/**
 * Who a new Warden is. `chosen` are the talents picked at creation (a hidden
 * one is rolled from `id`); `talents` carries a living character's talents
 * as they are (tiers and discoveries) into a new run.
 */
export interface WardenSpec extends Partial<Pick<Character, 'id' | 'name' | 'portrait' | 'stats' | 'talents'>> {
  chosen?: TalentId[];
}

export function createRegion1(config: Partial<Region1Config> = {}, legacy?: Legacy, who: WardenSpec = {}): Region1State {
  // Talents (#1263): carried as they are, or two chosen plus a hidden one rolled from the id.
  const talents = (who.talents ?? legacy?.talents)?.map(t => ({ ...t })) ?? startingTalents(who.chosen ?? [], who.id ?? '');
  // Skills a Warden starts with: what a past run taught (legacy) and what a chosen talent brings, whichever is more.
  const start: SkillPractice = { ...(legacy?.skills ?? {}) };
  for (const [k, h] of Object.entries(startingPractice(who.chosen ?? [])) as [SkillId, number][]) start[k] = Math.max(start[k] ?? 0, h);
  const s: Region1State = {
    day: 1,
    hoursToday: 0,
    vitals: createVitals(),
    stores: { rawFood: 2, water: 2, firewood: 0, materials: 1, rations: 0, stone: 0, hides: 0 },
    coldGear: false,
    explore: createExploration(),
    site: null,
    tier: 0,
    shelterGrade: null,
    shelter: { type: null, walls: null },
    flags: { everWater: false, everFood: false, everWood: false, everHunt: false, everPreserve: false, everHide: false },
    known: [...STARTING_RECIPES],
    studiedToday: {},
    milestones: [],
    tools: [],
    concepts: {},
    today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false },
    deprivation: { hungry: 0, thirsty: 0 },
    skills: start,
    // Stats (#1256): chosen at creation, or carried from this character's last run.
    character: { id: who.id ?? '', name: who.name ?? '', portrait: who.portrait ?? null, talents, lastStandUsed: false, stats: { ...(who.stats ?? legacy?.stats ?? DEFAULT_STATS) } },
    focus: null,
    techniques: [...(legacy?.techniques ?? [])],
    manuals: [],
    weatherToday: 'clear',
    forecast: {},
    log: [],
    outcome: null,
    config: { calendar: config.calendar ?? DEFAULT_CALENDAR, thresholds: config.thresholds ?? DEFAULT_THRESHOLDS, world: { ...(config.world ?? FULL_WORLD) } },
  };
  // Today's weather, and what Weather sense tells of the next two days (#1282).
  dawnWeather(s);
  // A new run that keeps what the last Warden learned: recipes and concept
  // ranks carry over (insight starts again); body, stores and land don't.
  if (legacy) {
    for (const r of legacy.known) if (!s.known.includes(r)) s.known.push(r);
    for (const [id, rank] of Object.entries(legacy.concepts)) s.concepts[id] = { rank, insight: 0 };
    const ranks = Object.entries(legacy.concepts).map(([id, r]) => `${id} ${r}`).join(', ');
    say(s, `You carry what you learned: ${s.known.length} recipes${ranks ? ` and ${ranks}` : ''}.`, 'milestone');
  }
  return s;
}

/** Deep-enough copy so every exported function can stay pure. */
function clone(s: Region1State): Region1State {
  return {
    ...s,
    vitals: { vigor: { ...s.vitals.vigor }, clarity: { ...s.vitals.clarity }, condition: s.vitals.condition },
    stores: { ...s.stores },
    shelter: { ...s.shelter },
    flags: { ...s.flags },
    known: [...s.known],
    studiedToday: { ...s.studiedToday },
    milestones: [...s.milestones],
    tools: [...s.tools],
    concepts: { ...s.concepts },
    today: { ...s.today },
    deprivation: { ...s.deprivation },
    skills: { ...s.skills },
    character: { ...s.character, talents: s.character.talents.map(t => ({ ...t })), stats: { ...s.character.stats } },
    techniques: [...s.techniques],
    manuals: [...s.manuals],
    forecast: { ...s.forecast },
    log: [...s.log],
  };
}

const say = (s: Region1State, text: string, kind: LogEntry['kind'], at?: LogEntry['at']): void => { s.log.push(at ? { day: s.day, text, kind, at } : { day: s.day, text, kind }); };

/** When a piece of work starts and the light it has, from the hours already spent and how long it takes (#1280). */
const stampFor = (s: Pick<Region1State, 'day' | 'hoursToday' | 'config'>, hours: number): { hour: number; light: number } =>
  ({ hour: clockHour(s.hoursToday), light: s.config.world.darkness ? lightOver(s.day, clockHour(s.hoursToday), hours, s.config.calendar) : 1 });

// ── Derived values ──────────────────────────────────────────────────────────

/** How much of the site's warmth the shelter as built realises. */
function shelterFactor(s: Region1State): number {
  if (s.tier === 0) return OPEN_CAMP_FACTOR;
  if (s.tier === 1) return SHELTER_TYPES[s.shelter.type ?? 'leanto'].factor;
  return WALL_TYPES[s.shelter.walls ?? 'timber'].factor;
}

/** Shelter warmth, 0..1 = site potential × the design built × how well it was built. */
export function warmth(s: Region1State): number {
  if (!s.site) return 0;
  return Math.min(1, SITES[s.site].warmth * shelterFactor(s) * GRADE_WARMTH[s.shelterGrade ?? 'sound']);
}

export function readinessInput(s: Region1State): ReadinessInput {
  return { rations: s.stores.rations, firewood: s.stores.firewood, shelterWarmth: warmth(s), vitals: s.vitals };
}

export const winterReady = (s: Region1State): boolean => isWinterReady(readinessInput(s), s.config.thresholds);

/**
 * The winter outlook (#1302): advice, not a gate. How many nights the stores
 * last at the rates the nights actually use, and how the shelter stands
 * against a midwinter night. Winter itself is the test.
 */
export interface WinterOutlook {
  /** Nights of food (raw food first, then rations — one a night). */
  foodDays: number;
  /** Nights of water. */
  waterDays: number;
  /** Nights the firewood lasts, at the burn of a typical night of each day ahead (capped at the thaw). */
  fuelDays: number;
  /** Firewood the nights from tonight to the thaw will need (#1303). */
  fuelToThaw: number;
  /** Shelter warmth less what a clear midwinter night needs not to be cold (negative: too cold). */
  warmthMargin: number;
  /** Nights left until the thaw, tonight included. */
  nightsToThaw: number;
}

/**
 * Firewood a night in camp on `day` will burn (#1303), at today's shelter
 * warmth. Tonight uses tonight's weather; later nights a typical one (no
 * weather shift). None in the flat world.
 */
export function nightFuel(s: Region1State, day = s.day): number {
  if (!feelsTemperature(s)) return 0;
  const w = Math.max(0, warmth(s) - (day === s.day ? windChill(s.weatherToday) : 0));
  return fireNeed(nightTemp(day, day === s.day ? s.weatherToday : 'wind', s.config.calendar), w);
}

export function winterOutlook(s: Region1State): WinterOutlook {
  const cal = s.config.calendar;
  const midwinter = nightTemp(cal.winterDay + MIDWINTER_AFTER, 'clear', cal);
  // Walk the nights to the thaw: how far the woodpile goes, and what the whole winter asks.
  let left = s.stores.firewood, fuelDays = 0, fuelToThaw = 0, lasting = true;
  for (let d = s.day; d < cal.thawDay; d++) {
    const need = nightFuel(s, d);
    fuelToThaw += need;
    if (lasting && left >= need) { left -= need; fuelDays++; } else lasting = false;
  }
  return {
    foodDays: s.stores.rawFood + s.stores.rations,
    waterDays: s.stores.water,
    fuelDays,
    fuelToThaw,
    warmthMargin: warmth(s) - coldNightNeeds(midwinter),
    nightsToThaw: Math.max(0, cal.thawDay - s.day),
  };
}

// ── Actions ─────────────────────────────────────────────────────────────────

export type ActionId =
  | 'scout' | 'survey' | 'track'
  | 'gather' | 'hunt' | 'water' | 'wood' | 'quarry' | 'preserve'
  | 'build' | 'coldGear'
  | 'knife' | 'snare' | 'waterskin' | 'bedroll' | 'shovel'
  | 'lookout' | 'study'
  | 'tinker' | 'rest'
  | 'fish';

/** Actions that happen out on the land, in a chosen ring. */
export type RingActionId = 'scout' | 'survey' | 'track' | 'lookout' | 'gather' | 'hunt' | 'water' | 'wood' | 'quarry' | 'fish';
/**
 * A queue entry: an action, optionally aimed at a ring (`wood@2`). A bare id
 * means the near ring, so plans written before rings existed still read right.
 */
export type QueueId = ActionId | `${RingActionId}@${Ring}`;

/** Split a queue entry into its action and ring. */
export function parseQueueId(q: QueueId): { id: ActionId; ring: Ring } {
  const [id, r] = q.split('@') as [ActionId, string | undefined];
  return { id, ring: (r ? Number(r) : 1) as Ring };
}

/** Choices made for one queued action (e.g. `{ site: 'tree', type: 'hut' }`). */
export type ActionOpts = Readonly<Record<string, string>>;
/** A queue entry with its chosen options. A plain QueueId means "defaults". */
export type QueueItem = QueueId | { q: QueueId; opts: ActionOpts };

/** Split any queue item into action, ring and options. */
export function parseItem(item: QueueItem): { id: ActionId; ring: Ring; opts: ActionOpts } {
  const q = typeof item === 'string' ? item : item.q;
  return { ...parseQueueId(q), opts: typeof item === 'string' ? {} : item.opts };
}

/** One choice inside an option group, with why it's unavailable (or null). */
export interface OptionChoice { value: string; label: string; note: string; blocked: string | null }
/** A decision an action needs: only groups with a real choice are offered. */
export interface OptionGroup { key: string; label: string; value: string | null; choices: OptionChoice[] }

/** Build a queue entry (ring 1 stays bare). */
export const queueId = (id: ActionId, ring: Ring = 1): QueueId => (ring === 1 || !ACTIONS[id].ringed ? id : (`${id}@${ring}` as QueueId));

interface ActionDef {
  name: string;
  hours: number;
  /** Per-hour pull on each pool (negative = drain). */
  vigorRate: number;
  clarityRate: number;
  /** Why the action can't be done right now (in this ring, with these choices), or null if it can. */
  gate?: (s: Region1State, ring: Ring, opts: ActionOpts) => string | null;
  /** Decisions this action offers, given the state it would run in and what's chosen so far. */
  options?: (s: Region1State, opts: ActionOpts) => OptionGroup[];
  /**
   * Apply the effect to (an already-cloned) state; return the journal line.
   * `bonus` is the extra yield your tools give this action; `light` is the
   * average light the work had (#1281, 1 by day — darkness costs haul and sight).
   */
  /** `luck`: the trip's haul multiplier from its luck band (#1314) — 1 for an ordinary trip, and for work that isn't a haul. */
  run: (s: Region1State, bonus: number, ring: Ring, opts: ActionOpts, light: number, luck: number) => string;
  /** How the chosen options change the work itself (hours and per-hour pulls). */
  variant?: (opts: ActionOpts, s?: Region1State, ring?: Ring) => { hours?: number; vigorRate?: number; clarityRate?: number };
  /** Happens out on the land: can target a ring, and pays its travel time. */
  ringed?: boolean;
  /** A craft: paid from stores and resolved by crafting.craft (its hours/rates come from there). */
  recipe?: CraftRecipe;
  /** A craft whose recipe depends on the state and choices (each shelter stage and design is its own build). */
  recipeFor?: (s: Region1State, opts: ActionOpts) => CraftRecipe | null;
}

const needsScout = (s: Region1State): string | null => (scouted(s.explore, 1) ? null : "you don't know the land yet — scout first");

/** Can you get to this ring? (The one inside it must be known first.) */
const reach = (s: Region1State, ring: Ring): string | null =>
  (reachable(s.explore, ring) ? null : `the ${RING_NAME[(ring - 1) as Ring].toLowerCase()} ring isn't known yet — scout it first`);

/** Game you've tracked (observed) in any ring. */
export const gameTracked = (s: Region1State): boolean => RINGS.some(r => level(s.explore, r, 'game') >= 2);
/** You've seen the pass out through the distant hills — the way on, come spring. */
export const routeKnown = (s: Region1State): boolean => level(s.explore, 3, 'routes') >= 1;

const where = (ring: Ring): string => (ring === 1 ? '' : ` in the ${RING_NAME[ring].toLowerCase()} ring`);
/** Looking at the land in the dark teaches nothing (#1281). */
const tooDark = (ring: Ring): string => `Too dark to make anything out${where(ring)} — the hours pass and you learn nothing.`;
/** Fog hides the land (#1284). */
const fogged = (ring: Ring): string => `Fog lies thick${where(ring)} — you can't see past your own hand, and learn nothing.`;
/** A note when poor light cost part of the haul (#1281). */
const dimNote = (light: number): string => (light < 1 ? (light < 0.5 ? ' Most of it lost to the dark.' : ' The light was failing.') : '');

/**
 * Work a domain on (an already-cloned) state: it teaches you the ground and
 * draws down its supply (#1304). Returns a journal suffix for any find.
 */
function workLand(s: Region1State, ring: Ring, d: Domain): string {
  const w = work(s.explore, ring, d);
  s.explore = w.exploration;
  const f = w.found ? FINDS[w.found] : undefined;
  return f ? ` You know this ground well now — found a ${f.name.toLowerCase()} (${f.note}).` : '';
}
/**
 * A trip's haul (#1304): what the ground and the Warden bring together, taken
 * at the land's supply, then by the trip's luck (#1314). Rounded; the land
 * alone never gives nothing — a stripped patch still gives a little — but bad
 * luck can.
 */
const haul = (s: Region1State, ring: Ring, d: Domain, raw: number, luck = 1): number =>
  (luck === 0 ? 0 : Math.max(1, Math.round(raw * supplyFactor(s.explore, ring, d) * luck)));
/** What an ordinary day of ice fishing brings in, near camp (#1315). */
export const FISH_CATCH = 3;
/** +2 from a find already made here. */
const findBonus = (s: Region1State, ring: Ring, d: Domain): number => (hasFind(s.explore, ring, d) ? 2 : 0);

// ── Crafting (src/artificer/crafting.ts) ────────────────────────────────────
//
// Region 1 has no item-level inventory yet, so its crafts are paid in its own
// store units (mostly "materials") and output real registry items. The
// crafting module does the rest: grade, failure + salvage, concept insight.

/** Region 1's craftable tools, as CraftRecipes whose inputs are Store keys. */
export const REGION1_RECIPES: Readonly<Record<'knife' | 'snare' | 'waterskin' | 'bedroll' | 'shovel', CraftRecipe>> = {
  knife: { id: 'stone-knife', name: 'Stone knife', inputs: [{ item: 'materials', qty: 2 }], output: { item: 'stone-knife', qty: 1 }, tier: 0, station: null, timeBase: 3, concepts: ['sharpening'] },
  snare: { id: 'trap-snare', name: 'Snare', inputs: [{ item: 'materials', qty: 2 }], output: { item: 'trap-snare', qty: 1 }, tier: 0, station: null, timeBase: 3, concepts: ['tension', 'leverage'] },
  waterskin: { id: 'waterskin', name: 'Waterskin', inputs: [{ item: 'materials', qty: 1 }, { item: 'hides', qty: 1 }], output: { item: 'waterskin', qty: 1 }, tier: 0, station: null, timeBase: 4, concepts: ['sealing'] },
  bedroll: { id: 'bedroll', name: 'Bedroll', inputs: [{ item: 'materials', qty: 3 }], output: { item: 'bedroll', qty: 1 }, tier: 0, station: null, timeBase: 5 },
  shovel: { id: 'crude-shovel', name: 'Crude shovel', inputs: [{ item: 'materials', qty: 2 }], output: { item: 'crude-shovel', qty: 1 }, tier: 1, station: null, timeBase: 3, concepts: ['leverage'] },
};

const shelterRecipe = (id: string, name: string, tier: number, inputs: CraftRecipe['inputs'], timeBase: number, vigorRate = -3.5): CraftRecipe =>
  ({ id, name, inputs, output: { item: id, qty: 1 }, tier, station: null, timeBase, concepts: ['joinery'], effort: { vigorRate, clarityRate: -1.5 } });

/**
 * First stage: the roof. A lean-to is quick and cheap; a brush hut costs more
 * and holds more heat. Both are tier-0 work (you can raise them in the field).
 */
export const SHELTER_TYPES: Readonly<Record<ShelterType, { name: string; factor: number; recipe: CraftRecipe }>> = {
  leanto: { name: 'Lean-to', factor: 0.65, recipe: shelterRecipe('shelter-leanto', 'Lean-to', 0, [{ item: 'materials', qty: BUILD_COST[0] }], 8) },
  hut: { name: 'Brush hut', factor: 0.75, recipe: shelterRecipe('shelter-hut', 'Brush hut', 0, [{ item: 'materials', qty: 5 }], 11) },
};

/**
 * Second stage: winterizing. Stone banked against the walls stores the fire's
 * heat; it needs quarried stone and a heavier day. Tier-1 work: needs the roof.
 */
export const WALL_TYPES: Readonly<Record<WallMaterial, { name: string; factor: number; recipe: CraftRecipe }>> = {
  timber: { name: 'Timber walls', factor: 1, recipe: shelterRecipe('shelter-timber', 'Timber walls', 1, [{ item: 'materials', qty: BUILD_COST[1] }], 8) },
  stone: { name: 'Stone-banked walls', factor: 1.1, recipe: shelterRecipe('shelter-stone', 'Stone-banked walls', 1, [{ item: 'materials', qty: 2 }, { item: 'stone', qty: 4 }], 10, -4) },
};

const isShelterType = (v: string | undefined): v is ShelterType => v === 'leanto' || v === 'hut';
const isWall = (v: string | undefined): v is WallMaterial => v === 'timber' || v === 'stone';
const isSite = (v: string | undefined): v is SiteId => v !== undefined && v in SITES;

/**
 * Where and what a build would make, given the choices: the target site
 * (defaults to camp), the tier it starts from there (0 if it means moving),
 * and the recipe for the next stage.
 */
export function planBuild(s: Region1State, opts: ActionOpts): { site: SiteId | null; moving: boolean; fromTier: Tier; recipe: CraftRecipe | null } {
  const site = isSite(opts.site) ? opts.site : s.site;
  const moving = site !== null && site !== s.site;
  const fromTier: Tier = moving ? 0 : s.tier;
  const recipe = fromTier === 0 ? SHELTER_TYPES[isShelterType(opts.type) ? opts.type : 'leanto'].recipe
    : fromTier === 1 ? WALL_TYPES[isWall(opts.walls) ? opts.walls : 'timber'].recipe : null;
  return { site, moving, fromTier, recipe };
}

const costNote = (r: CraftRecipe): string => `${r.inputs.map(i => `${i.qty} ${i.item}`).join(' + ')} · ${r.timeBase}h`;

/** Build shelter's decisions: where, and (per stage) what kind. Only real choices are returned. */
function buildOptions(s: Region1State, opts: ActionOpts): OptionGroup[] {
  const plan = planBuild(s, opts);
  const groups: OptionGroup[] = [];
  const knowsLand = scouted(s.explore, 1);
  groups.push({
    key: 'site', label: 'Location', value: plan.site,
    choices: (Object.keys(SITES) as SiteId[]).map(id => ({
      value: id, label: SITES[id].name,
      note: `up to ${Math.round(SITES[id].warmth * 100)}% warm${s.site && id !== s.site && s.tier > 0 ? ' · leaves your shelter behind' : id === s.site ? ' · your camp' : ''}`,
      blocked: knowsLand ? null : 'scout first',
    })),
  });
  if (plan.fromTier === 0) {
    groups.push({
      key: 'type', label: 'Shelter type', value: isShelterType(opts.type) ? opts.type : 'leanto',
      choices: (Object.keys(SHELTER_TYPES) as ShelterType[]).map(t => ({ value: t, label: SHELTER_TYPES[t].name, note: `${costNote(SHELTER_TYPES[t].recipe)} · holds ${Math.round(SHELTER_TYPES[t].factor * 100)}%`, blocked: knows(s, SHELTER_TYPES[t].recipe) ? null : 'not yet discovered' })),
    });
  } else if (plan.fromTier === 1) {
    groups.push({
      key: 'walls', label: 'Wall material', value: isWall(opts.walls) ? opts.walls : 'timber',
      choices: (Object.keys(WALL_TYPES) as WallMaterial[]).map(w => ({ value: w, label: WALL_TYPES[w].name, note: `${costNote(WALL_TYPES[w].recipe)} · holds ${Math.round(WALL_TYPES[w].factor * 100)}%`, blocked: knows(s, WALL_TYPES[w].recipe) ? null : 'not yet discovered' })),
    });
  }
  return groups.filter(g => g.choices.length > 1);
}

/** Leave the current shelter and settle at `site` (on an already-cloned state). */
function moveCamp(next: Region1State, site: SiteId): void {
  const moved = next.site !== null && next.tier > 0;
  next.site = site;
  next.tier = 0;
  next.shelterGrade = null;
  next.shelter = { type: null, walls: null };
  say(next, `Chose the ${SITES[site].name.toLowerCase()} as your ground${moved ? ' — the old shelter is left behind' : ''}.`, 'action');
}

/** Cold-weather gear: fine work for the mind. A graded tool that unlocks winter travel. */
export const COLD_GEAR_RECIPE: CraftRecipe = {
  id: 'cold-gear', name: 'Cold gear', inputs: [{ item: 'materials', qty: 3 }], output: { item: 'cold-gear', qty: 1 },
  tier: 0, station: null, timeBase: 6, concepts: ['weaving'], effort: { vigorRate: -1.5, clarityRate: -5 },
};

const STORE_KEYS = ['rawFood', 'water', 'firewood', 'materials', 'rations', 'stone', 'hides'] as const;
// Region 1's own item on top of the registry defaults: cold gear lets you travel in winter.
const CRAFT_WORLD = craftWorld([], [], { ...DEFAULT_EFFECTS, 'cold-gear': { unlock: ['winter-travel'] }, 'hide-parka': { unlock: ['winter-travel'] } });

/** Sound cold gear: you have some, and it isn't crude (crude gear won't hold up through a winter). */
const roadworthyGear = (tools: readonly Tool[]): boolean =>
  tools.some(t => (t.item === 'cold-gear' && t.grade !== 'crude') || t.item === 'hide-parka');

/** Cold gear from hides: heavier on materials you hunt for, but hide holds the cold even when the work is crude. */
export const HIDE_PARKA_RECIPE: CraftRecipe = {
  id: 'hide-parka', name: 'Hide parka', inputs: [{ item: 'materials', qty: 1 }, { item: 'hides', qty: 2 }], output: { item: 'hide-parka', qty: 1 },
  tier: 0, station: null, timeBase: 6, concepts: ['sealing'], effort: { vigorRate: -1.5, clarityRate: -5 },
};
const coldGearRecipe = (o: ActionOpts): CraftRecipe => (o.material === 'hide' ? HIDE_PARKA_RECIPE : COLD_GEAR_RECIPE);

/** An option group, offered only when it's a real choice. */
const choiceGroup = (key: string, label: string, value: string, choices: OptionChoice[]): OptionGroup => ({ key, label, value, choices });

/** View a Region 1 state as a crafter: stores are the inventory, the shelter is the bench. */
function crafterOf(s: Region1State): CrafterState {
  return createCrafter(s.vitals, {
    inventory: { ...s.stores },
    tools: s.tools,
    concepts: s.concepts,
    // Region 1's shelter is the first workbench (crafting design §6–7).
    bench: { tier: s.tier >= 1 ? 1 : 0, stations: [] },
  });
}

// ── Discovery (crafting design §5) ──────────────────────────────────────────
//
// Recipes aren't all known on day 1. A few are innate; the rest you work out
// from what you see and find — or by studying the concept behind them.

/** Recipe ids every Warden knows from the start. */
export const STARTING_RECIPES: readonly string[] = ['shelter-leanto', 'shelter-timber', 'cold-gear', 'stone-knife', 'bedroll'];

/** How each other recipe is discovered: an observation/find, or rank 1 in its concept. */
export const DISCOVERIES: readonly { recipe: string; name: string; concept: string; trigger: (s: Region1State) => boolean; how: string }[] = [
  { recipe: 'trap-snare', name: 'Snare', concept: 'tension', trigger: s => gameTracked(s), how: 'watching the game trails, you see how a snare would hold' },
  { recipe: 'shelter-hut', name: 'Brush hut', concept: 'joinery', trigger: s => level(s.explore, 1, 'forage') >= 2, how: 'knowing where the brush grows thick, you can see a hut in it' },
  { recipe: 'shelter-stone', name: 'Stone-banked walls', concept: 'joinery', trigger: s => RINGS.some(r => level(s.explore, r, 'stone') >= 2), how: 'the flat stone out there would bank a wall and hold the heat' },
  { recipe: 'hide-parka', name: 'Hide parka', concept: 'sealing', trigger: s => s.flags.everHide, how: 'a fresh hide in your hands — it would turn the wind' },
  { recipe: 'waterskin', name: 'Waterskin', concept: 'sealing', trigger: s => s.flags.everHide, how: 'sewn tight, a hide would carry water' },
  { recipe: 'crude-shovel', name: 'Crude shovel', concept: 'leverage', trigger: s => s.tier >= 1, how: 'digging the footings, you wanted a blade on a pole' },
];

/** The concepts you can study, and what rank 1 in each reveals. */
export const STUDY_CONCEPTS: readonly string[] = ['joinery', 'tension', 'sealing', 'leverage', 'sharpening', 'weaving'];

export const knows = (s: Region1State, r: CraftRecipe): boolean => s.known.includes(r.id);
const unknownRecipe = (s: Region1State, r: CraftRecipe): string | null => (knows(s, r) ? null : `you haven't worked out how to make a ${r.name.toLowerCase()} yet`);

/** Learn anything newly discovered (on a cloned state), journalling each once. */
function latchDiscoveries(s: Region1State): void {
  for (const d of DISCOVERIES) {
    if (s.known.includes(d.recipe)) continue;
    const studied = (s.concepts[d.concept]?.rank ?? 0) >= 1;
    if (!d.trigger(s) && !studied) continue;
    s.known.push(d.recipe);
    say(s, `Worked out: ${d.name} — ${studied && !d.trigger(s) ? `your study of ${d.concept} shows the way` : d.how}.`, 'milestone');
  }
}

/**
 * Gate for a craft action. The extra gate goes first (a hide needs a hunt),
 * then "you already have a good one", then the crafting module's own checks.
 * A crude tool can be remade; anything sound or better is kept.
 */
const craftGate = (r: CraftRecipe, extra?: (s: Region1State) => string | null) => (s: Region1State, _ring?: Ring): string | null => {
  const unknown = unknownRecipe(s, r);
  if (unknown) return unknown;
  const pre = extra?.(s) ?? null;
  if (pre) return pre;
  const owned = s.tools.find(t => t.item === r.output.item && GRADES.indexOf(t.grade) >= GRADES.indexOf('sound'));
  if (owned) return `you already have a ${owned.grade} ${r.name.toLowerCase()}`;
  return craftBlocker(crafterOf(s), r);
};

/** One craft definition for the ACTIONS table: its gate and costs come from the recipe. */
const craftAction = (r: CraftRecipe, extra?: (s: Region1State) => string | null): ActionDef => ({
  name: `Craft ${r.name.toLowerCase()}`, hours: r.timeBase, vigorRate: 0, clarityRate: 0,
  gate: craftGate(r, extra), recipe: r, run: () => '',
});

export const ACTIONS: Readonly<Record<ActionId, ActionDef>> = {
  scout: {
    name: 'Scout', hours: 4, vigorRate: -3.5, clarityRate: -1, ringed: true, gate: reach,
    run: (s, _b, r, _o, light) => {
      if (tooDarkToSee('scout', light)) return tooDark(r);
      if (blindInFog(s.weatherToday, 'scout')) return fogged(r);
      s.explore = scout(s.explore, r);
      return r === 1 ? 'Scouted the near ground — you can see where food, water, wood and stone lie.'
        : r === 2 ? 'Pushed out to the far ring — new forage and timber, and paths leading on.'
          : 'Reached the distant hills — and glimpsed the pass out of the Reach.';
    },
  },
  survey: {
    name: 'Survey', hours: 7, vigorRate: -2, clarityRate: -5, ringed: true, gate: reach,
    run: (s, _b, r, _o, light) => {
      if (tooDarkToSee('survey', light)) return tooDark(r);
      if (blindInFog(s.weatherToday, 'survey')) return fogged(r);
      s.explore = survey(s.explore, r); return `Surveyed carefully${where(r)} — every trip there yields more now.`;
    },
  },
  track: {
    name: 'Track', hours: 4, vigorRate: -3, clarityRate: -2.5, ringed: true, gate: reach,
    run: (s, _b, r) => { s.explore = track(s.explore, r); return `Tracked a deer herd${where(r)} — you can hunt there.`; },
  },
  gather: {
    name: 'Gather food', hours: 5, vigorRate: -3.5, clarityRate: -1, ringed: true, gate: reach,
    run: (s, b, r, _o, light, luck) => {
      const blind = level(s.explore, r, 'forage') === 0;
      // In poor light you miss most of what's there (#1281).
      const n = scaleHaul(haul(s, r, 'forage', landYield(s.explore, r, 'forage', 3, 2) + b, luck), darkYieldMult('gather', light));
      const note = workLand(s, r, 'forage');
      const fiber = findBonus(s, r, 'forage');
      s.stores.rawFood += n; s.stores.materials += fiber; s.flags.everFood = true;
      return `${blind ? 'Wandered, not knowing where to look — gathered' : 'Gathered'} ${n} raw food${fiber ? ` and ${fiber} fiber` : ''}${where(r)}.${note}${dimNote(light)}`;
    },
  },
  hunt: {
    name: 'Hunt', hours: 5, vigorRate: -4, clarityRate: -2, ringed: true,
    // Deer need tracking (game observed); small game only needs to be known to be about.
    gate: (s, r, o) => reach(s, r) ?? (o.target === 'small'
      ? (level(s.explore, r, 'game') >= 1 ? null : `you haven't seen any game${where(r) || ' nearby'}`)
      : (level(s.explore, r, 'game') >= 2 ? null : `no game tracked${where(r) || ' nearby'} yet`)),
    variant: o => (o.target === 'small' ? { hours: 3, vigorRate: -2.5, clarityRate: -1.5 } : {}),
    options: (_s, o) => [choiceGroup('target', 'Quarry', o.target ?? 'deer', [
      { value: 'deer', label: 'Deer', note: '5h · ~7 food + a hide · needs tracking', blocked: null },
      { value: 'small', label: 'Small game', note: '3h · ~3 food · lighter · no tracking needed', blocked: null },
    ])],
    run: (s, b, r, o, _light, luck) => {
      const small = o.target === 'small';
      const n = haul(s, r, 'game', (small ? landYield(s.explore, r, 'game', 3, 1) : landYield(s.explore, r, 'game', 7, 0)) + b + findBonus(s, r, 'game'), luck);
      const note = workLand(s, r, 'game');
      s.stores.rawFood += n; s.flags.everFood = true; s.flags.everHunt = true;
      // An empty hunt brings no deer down, so no hide either.
      if (!small && n > 0) { s.stores.hides += 1; s.flags.everHide = true; }
      if (n === 0) return `Hunted ${small ? 'small game' : 'deer'}${where(r)} and took nothing.${note}`;
      return small ? `Took small game${where(r)} — ${n} raw food.${note}` : `Brought down a deer${where(r)} — ${n} raw food and a hide.${note}`;
    },
  },
  water: {
    name: 'Fetch water', hours: 2, vigorRate: -3, clarityRate: -0.5, ringed: true,
    // Frozen hard (#1303), the only water is snow melted over a fire.
    gate: (s, r) => reach(s, r) ?? (melting(s) && s.stores.firewood < MELT_FIREWOOD ? 'the streams are frozen hard, and there is no firewood to melt snow' : null),
    // Once the streams ice over you break through to the water first (#1283); frozen hard, you melt snow instead (#1303).
    variant: (_o, s) => (s && feelsTemperature(s) && iceOn(s.day, s.config.calendar) ? { hours: 2 + ICE_EXTRA_HOURS } : {}),
    run: (s, b, r, _o, _light, luck) => {
      const n = haul(s, r, 'water', landYield(s.explore, r, 'water', 4, 1) + (s.site === 'river' && r === 1 ? 2 : 0) + b + findBonus(s, r, 'water'), luck);
      const note = workLand(s, r, 'water');
      const melt = melting(s);
      if (melt) s.stores.firewood -= MELT_FIREWOOD;
      s.stores.water += n; s.flags.everWater = true;
      return melt ? `Melted ${n} water from snow${where(r)} (${MELT_FIREWOOD} firewood).${note}` : `Fetched ${n} water${where(r)}.${note}`;
    },
  },
  wood: {
    name: 'Gather wood', hours: 4, vigorRate: -4, clarityRate: -1, ringed: true, gate: reach,
    // `b` (skill, tools, focus, techniques) adds to the firewood — it used to be ignored here (#1243).
    run: (s, b, r, _o, light, luck) => {
      const dim = darkYieldMult('wood', light);
      const f = scaleHaul(haul(s, r, 'timber', landYield(s.explore, r, 'timber', 4, 1) + (s.site === 'tree' && r === 1 ? 1 : 0) + findBonus(s, r, 'timber') + b, luck), dim);
      const m = scaleHaul(haul(s, r, 'timber', landYield(s.explore, r, 'timber', 2, 1), luck), dim);
      const note = workLand(s, r, 'timber');
      s.stores.firewood += f; s.stores.materials += m; s.flags.everWood = true;
      return `Cut ${f} firewood and ${m} materials${where(r)}.${note}${dimNote(light)}`;
    },
  },
  fish: {
    name: 'Ice fishing', hours: 5, vigorRate: -2, clarityRate: -2.5, ringed: true,
    // Once the lake ice is thick enough to stand on (#1315) — open all year in the flat world.
    gate: (s, r) => reach(s, r) ?? (feelsTemperature(s) && !iceThick(s.day, s.config.calendar) ? 'the ice is too thin' : null),
    // A slow, steady catch: modest, but the lake doesn't run out the way the land does.
    run: (s, b, r, _o, light, luck) => {
      const n = scaleHaul(haul(s, r, 'water', FISH_CATCH * RICHNESS[r] + b, luck), darkYieldMult('gather', light));
      s.stores.rawFood += n; s.flags.everFood = true;
      return n > 0 ? `Fished through the ice${where(r)} — ${n} raw food.` : `Sat over a hole in the ice${where(r)} and caught nothing.`;
    },
  },
  quarry: {
    name: 'Quarry stone', hours: 5, vigorRate: -4.5, clarityRate: -1, ringed: true, gate: reach,
    run: (s, b, r, _o, light, luck) => {
      const n = scaleHaul(haul(s, r, 'stone', landYield(s.explore, r, 'stone', 3, 1) + findBonus(s, r, 'stone') + b, luck), darkYieldMult('quarry', light));
      const note = workLand(s, r, 'stone');
      s.stores.stone += n;
      return `Broke out ${n} stone${where(r)}.${note}${dimNote(light)}`;
    },
  },
  preserve: {
    name: 'Preserve food', hours: 4, vigorRate: -1, clarityRate: -4.5,
    gate: s => needsScout(s) ?? (s.stores.rawFood >= 2 ? null : 'not enough raw food to preserve'),
    variant: o => (o.method === 'dry' ? { hours: 2, clarityRate: -2 } : {}),
    options: (_s, o) => [choiceGroup('method', 'Method', o.method ?? 'smoke', [
      { value: 'smoke', label: 'Smoke', note: '4h · up to 3 rations · careful work', blocked: null },
      { value: 'dry', label: 'Air-dry', note: '2h · up to 2 rations · easy on the mind', blocked: null },
    ])],
    run: (s, _b, _r, o) => {
      // Two raw food cure down to one ration; smoking does up to three a session, drying two.
      const dry = o.method === 'dry';
      const made = Math.min(dry ? 2 : 3, Math.floor(s.stores.rawFood / 2));
      s.stores.rawFood -= made * 2; s.stores.rations += made; s.flags.everPreserve = true;
      return `${dry ? 'Air-dried' : 'Smoked and salted'} ${made * 2} food into ${made} winter ration${made === 1 ? '' : 's'}.`;
    },
  },
  build: {
    name: 'Build shelter', hours: 8, vigorRate: -3.5, clarityRate: -1.5,
    gate: (s, _r, opts) => {
      const plan = planBuild(s, opts);
      if (!plan.site) return 'choose a location';
      if (plan.moving && !scouted(s.explore, 1)) return needsScout(s);
      if (!plan.recipe) return 'the shelter is already winterized';
      const unknown = unknownRecipe(s, plan.recipe);
      if (unknown) return unknown;
      // Judge materials against the camp as it would be (moving keeps your stores, resets the bench).
      return craftBlocker(crafterOf(plan.moving ? { ...s, tier: 0 } : s), plan.recipe);
    },
    options: buildOptions,
    recipeFor: (s, opts) => planBuild(s, opts).recipe,
    run: () => '',
  },
  coldGear: {
    ...craftAction(COLD_GEAR_RECIPE), name: 'Craft cold gear',
    gate: (s, _r, o) => (roadworthyGear(s.tools) ? 'you already have sound cold gear' : unknownRecipe(s, coldGearRecipe(o)) ?? craftBlocker(crafterOf(s), coldGearRecipe(o))),
    recipeFor: (_s, o) => coldGearRecipe(o),
    options: (s, o) => [choiceGroup('material', 'Material', o.material ?? 'fiber', [
      { value: 'fiber', label: 'Woven fiber', note: `${costNote(COLD_GEAR_RECIPE)} · crude won't hold up through a winter`, blocked: null },
      { value: 'hide', label: 'Hide parka', note: `${costNote(HIDE_PARKA_RECIPE)} · holds the cold even if crude`, blocked: knows(s, HIDE_PARKA_RECIPE) ? null : 'not yet discovered' },
    ])],
  },
  knife: craftAction(REGION1_RECIPES.knife, needsScout),
  snare: craftAction(REGION1_RECIPES.snare),
  waterskin: craftAction(REGION1_RECIPES.waterskin, s => (s.stores.hides >= 1 ? null : 'you need a hide — hunt deer first')),
  bedroll: craftAction(REGION1_RECIPES.bedroll, needsScout),
  shovel: craftAction(REGION1_RECIPES.shovel, needsScout),
  lookout: {
    // You look out over ground you've scouted; without that it would stand in for scouting two rings at once.
    name: 'Climb & look out', hours: 5, vigorRate: -4.5, clarityRate: -1, ringed: true,
    gate: (s, r) => reach(s, r) ?? (scouted(s.explore, r) ? null : `scout the ${RING_NAME[r].toLowerCase()} ring first`),
    // Camped on the hilltop, the near look-out is a short climb.
    variant: (_o, s, ring) => (s?.site === 'hill' && ring === 1 ? { hours: 2 } : {}),
    run: (s, _b, r, _o, light) => {
      if (tooDarkToSee('lookout', light)) return tooDark(r);
      s.explore = lookout(s.explore, r);
      // From up high you can read tomorrow's sky (#1282).
      const tomorrow = foresee(s, s.day + 1);
      return `Climbed high${where(r)} and looked out — the ground sharpens below${r < 3 ? `, and you can see over the ${RING_NAME[(r + 1) as Ring].toLowerCase()} ring` : ''}.${s.config.world.weather === 'seeded' ? ` Tomorrow looks like ${weatherName(tomorrow, s.day + 1, s.config.calendar).toLowerCase()}.` : ''}`;
    },
  },
  study: {
    name: 'Study', hours: 3, vigorRate: 0, clarityRate: 0,
    gate: (s, _r, o) => studyConcept(crafterOf(s), o.concept ?? 'joinery', CRAFT_WORLD).reason ?? null,
    options: (s, o) => [choiceGroup('concept', 'Concept', o.concept ?? 'joinery', STUDY_CONCEPTS.map(c => {
      const reveals = DISCOVERIES.filter(d => d.concept === c && !s.known.includes(d.recipe)).map(d => d.name.toLowerCase());
      return { value: c, label: c[0].toUpperCase() + c.slice(1), note: `rank ${s.concepts[c]?.rank ?? 0}${reveals.length ? ` · rank 1 reveals ${reveals.join(', ')}` : ''}`, blocked: null };
    }))],
    // Focus spends about a third of a fresh mind (crafting.study); insight grows the concept.
    run: (s, _b, _r, o, light) => {
      const concept = o.concept ?? 'joinery';
      const before = s.vitals.clarity.current;
      const c = { ...crafterOf(s), studiedToday: s.studiedToday };
      const r = studyConcept(c, concept, CRAFT_WORLD);
      s.vitals = r.state.vitals;
      s.concepts = r.state.concepts;
      s.studiedToday = r.state.studiedToday;
      s.today.loadClarity += Math.max(0, before - s.vitals.clarity.current);
      // Intelligence (#1256): a sharper mind takes more from the same session.
      const extra = r.gained * (statEffects(s.character.stats).insight - 1);
      if (extra !== 0) addInsight(s.concepts, concept, extra, CRAFT_WORLD.concepts);
      // At night you read and reckon by firelight — or strain in the dark (#1281).
      const night = nightWork(light, s.stores.firewood, 3, windFire(s.weatherToday));
      const strain = Math.max(0, before - s.vitals.clarity.current) * (night.clarity - 1);
      s.stores.firewood -= night.fire;
      s.vitals.clarity.current = Math.max(0, s.vitals.clarity.current - strain);
      s.today.loadClarity += strain;
      return `Studied ${concept} — ${(r.gained + extra).toFixed(1)} insight (rank ${s.concepts[concept]?.rank ?? 0}).${night.fire ? ' By firelight.' : night.clarity > 1 ? ' Straining in the dark.' : ''}`;
    },
  },
  tinker: {
    name: 'Tinker / plan', hours: 5, vigorRate: 2, clarityRate: -5.5,
    run: () => 'Worked at the bench — the body eased while the mind spent.',
  },
  rest: {
    name: 'Rest', hours: 3, vigorRate: 4, clarityRate: 1.5,
    run: () => 'Sat a while and let the ache settle.',
  },
};

// ── Milestones ──────────────────────────────────────────────────────────────

/** The Region 1 first-win ladder (region-1 §2): early rungs guide, late rungs are the readiness thresholds. */
export const REGION1_MILESTONES: readonly MilestoneDef<Region1State>[] = [
  { id: 'scout', name: 'Get your bearings', done: s => scouted(s.explore, 1) },
  { id: 'site', name: 'Stake a claim', done: s => s.site !== null },
  { id: 'water', name: 'Water secured', done: s => s.flags.everWater },
  { id: 'forage', name: 'First forage', done: s => s.flags.everFood },
  { id: 'timber', name: 'Fire & timber', done: s => s.flags.everWood },
  { id: 'roof', name: 'A roof overhead', done: s => s.tier >= 1 },
  { id: 'track', name: 'Read the tracks', done: s => gameTracked(s) },
  { id: 'catch', name: 'First catch', done: s => s.flags.everHunt },
  { id: 'pushout', name: 'Push out', done: s => scouted(s.explore, 2) },
  { id: 'larder0', name: 'The larder begins', done: s => s.flags.everPreserve },
  { id: 'winterized', name: 'Winterized', done: s => warmth(s) >= s.config.thresholds.warmth },
  { id: 'larder', name: 'Larder stocked', done: s => s.stores.rations >= s.config.thresholds.larder },
  { id: 'fuel', name: 'Fuel laid in', done: s => s.stores.firewood >= s.config.thresholds.fuel },
  { id: 'ready', name: 'Winter-ready', done: s => winterReady(s) },
];

/** Re-evaluate the ladder on a (cloned) state, journalling any new rungs. */
function latchMilestones(s: Region1State): void {
  latchDiscoveries(s);
  const r = evaluateMilestones(REGION1_MILESTONES, s, s.milestones);
  s.milestones = r.achieved;
  for (const id of r.newlyAchieved) {
    const def = REGION1_MILESTONES.find(m => m.id === id);
    say(s, `Milestone — ${def?.name ?? id}`, 'milestone');
  }
}

// ── The loop ────────────────────────────────────────────────────────────────

/** Settle on a site (needs scouting). Moving resets the shelter build. */
export function chooseSite(s: Region1State, site: SiteId): Region1State {
  const next = clone(s);
  if (next.outcome) return next;
  if (!scouted(next.explore, 1)) { say(next, `Can't stake a claim yet: ${needsScout(next)}.`, 'skip'); return next; }
  if (next.site === site) return next;
  moveCamp(next, site);
  latchMilestones(next);
  return next;
}

/** Per-hour pull of walking to and from an outer ring. */
const TRAVEL_VIGOR_RATE = -3;
const TRAVEL_CLARITY_RATE = -0.5;

/**
 * Hours a queue entry will take (its work plus any travel) — for planning
 * previews. Pass the state it would run in to account for choices whose cost
 * depends on it (a brush hut takes longer than a lean-to).
 */
export function queueHours(item: QueueItem, s?: Region1State): number {
  const { id, ring, opts } = parseItem(item);
  const def = ACTIONS[id];
  const recipe = s && def.recipeFor ? def.recipeFor(id === 'build' && planBuild(s, opts).moving ? { ...s, tier: 0 } : s, opts) : def.recipe;
  const rain = s && !recipe ? weatherHours(s.weatherToday, id) : 1;
  // Deep snow (#1315) slows the walk out and the felling.
  const snow = s ? snowSlowFor(s) : 1;
  // A blizzard slows everything out there (#1315).
  const storm = s && inBlizzard(s, id) ? BLIZZARD_HOURS : 1;
  return (recipe ? recipe.timeBase : (def.variant?.(opts, s, ring).hours ?? def.hours) * rain * (id === 'wood' ? snow : 1) * storm) + (def.ringed ? TRAVEL_HOURS[ring] * snow * storm : 0);
}

/**
 * Why an action can't be done right now, or null if it can: its own gate, or
 * the weather (a storm keeps you out of the far rings, #1284). A blizzard
 * refuses nothing; it's a danger, not a wall (#1315). Every place that
 * asks "is this allowed?" — the sim, the plan preview, the AI — uses this.
 */
export function blockedReason(s: Region1State, id: ActionId, ring: Ring, opts: ActionOpts = {}): string | null {
  const def = ACTIONS[id];
  if (def.gate) { const g = def.gate(s, ring, opts); if (g) return g; }
  if (!def.ringed) return null;
  // An autumn storm keeps you out of the far rings (#1284). A winter blizzard doesn't refuse you —
  // you can go out in it, and it may well kill you (#1315; see `dangerOf`).
  if (isBlizzard(s.weatherToday, s.day, s.config.calendar)) return null;
  return stormBars(s.weatherToday, ring) ? 'the storm makes it too dangerous to go out' : null;
}

/**
 * Do one action now. A refused action (gate not met) costs nothing — it simply
 * doesn't happen — and is journalled as a skip.
 */
export function runAction(s: Region1State, item: QueueItem): Region1State {
  const next = clone(s);
  if (next.outcome) return next;
  const { id, ring, opts } = parseItem(item);
  const def = ACTIONS[id];
  const refused = blockedReason(next, id, ring, opts);
  if (refused) { say(next, `${def.name}${where(ring)}: skipped — ${refused}.`, 'skip'); return next; }
  // Building somewhere new moves camp first; the build then starts there from scratch.
  if (id === 'build') {
    const plan = planBuild(next, opts);
    if (plan.moving && plan.site) moveCamp(next, plan.site);
  }
  const recipe = def.recipeFor?.(next, opts) ?? def.recipe;
  if (recipe) return runCraft(next, id, recipe);

  // Your tools make the work cheaper, quicker or richer (crafting design §2) —
  // and your skill in the field makes it cheaper still, richer, and gets more from the tools (#1236).
  const mod = modifiersFor(next.tools, id);
  const skill = skillFor(id);
  const lvl = skill ? skillLevel(next.skills, skill) : 0;
  const v = def.variant?.(opts, next, ring) ?? {};
  // Rain makes some work slower (#1284).
  // Deep snow slows the felling and the walk (#1315).
  const snow = snowSlowFor(next);
  // …and a blizzard slows everything out there (#1315).
  const storm = inBlizzard(next, id) ? BLIZZARD_HOURS : 1;
  const workHours = (v.hours ?? def.hours) * mod.timeMult * weatherHours(next.weatherToday, id) * (id === 'wood' ? snow : 1) * storm;
  // Outer rings cost the walk there and back: hard on the legs, easy on the mind.
  const travel = def.ringed ? TRAVEL_HOURS[ring] * snow * storm : 0;
  const td = talentDrain(next.character.talents, id);
  const tf = talentEffects(next.character.talents);
  // Stats (#1256): Strength for heavy work, Agility for nimble work and the walk, Willpower for the mind.
  const se = statEffects(next.character.stats);
  const sd = statDrain(next.character.stats, id, skill);
  // Focus (#1238): goal or survival work is lighter and richer; a focused skill practises faster.
  const fx = workEffects(next.focus, survivalLockOf(next), id, skill, next.vitals.clarity.current, se.unreliableBelow);
  // Techniques you know (#1243): richer, lighter work — and Pathfinding eases the walk out.
  const te = techniqueEffects(next.techniques, id, undefined, def.ringed);
  // The light the work has (#1280), and what the dark costs (#1281): heavier felling, a harder walk.
  const at = stampFor(next, workHours + travel);
  const wd = weatherDrain(next.weatherToday, id, !!def.ringed, ring);
  const dw = darkWorkDrain(id, at.light) * coldWork(next, at.hour) * wd, dt = darkTravelDrain(at.light);
  const r = applyActivity(next.vitals, { hours: workHours, vigorRate: (v.vigorRate ?? def.vigorRate) * mod.vigorMult * drainMult(lvl) * td.vigor * sd.vigor * fx.drain * te.drain * dw, clarityRate: (v.clarityRate ?? def.clarityRate) * mod.clarityMult * drainMult(lvl) * td.clarity * sd.clarity * fx.drain * te.drain * wd });
  const t = applyActivity(r.vitals, { hours: travel, vigorRate: TRAVEL_VIGOR_RATE * te.travelDrain * se.travel * dt, clarityRate: TRAVEL_CLARITY_RATE * te.travelDrain * se.travel * dt });
  next.vitals = t.vitals;
  next.today.loadVigor += r.loadVigor + t.loadVigor;
  next.today.loadClarity += r.loadClarity + t.loadClarity;
  next.today.pushedVigor ||= r.pushedVigor || t.pushedVigor;
  next.today.pushedClarity ||= r.pushedClarity || t.pushedClarity;
  next.hoursToday += workHours + travel;
  // Out on the land, or deep in study (#1305): either keeps cabin fever off.
  if (def.ringed) next.today.outside = true;
  if (id === 'study') next.today.absorbed = true;
  // Out in the rain, you get soaked (#1284).
  if (def.ringed && next.weatherToday === 'rain') next.wetHours = (next.wetHours ?? 0) + workHours + travel;
  // Tough (#1263): pushing past empty costs less Condition — give back the part it spares.
  refundOverexertion(next, r.conditionLost + t.conditionLost, tf.overexertCondition);

  // Talents that bring back more (Forager, Hunter's Patience, Waterfinder) — hidden ones too.
  const bonus = Math.round(mod.yieldAdd * toolMult(lvl)) + yieldBonus(lvl) + fx.yield + te.yield + (tf.yield[id] ?? 0);
  // A gathering trip rolls its luck (#1314): the fortune of its starting hour, with weather, supply, skill and light setting the odds.
  const luck = tripLuck(next, id, ring, at, lvl, te.yield > 0 || te.drain < 1);
  // Out in a blizzard (#1315): the white decides how you come back — if you do.
  const exposure = inBlizzard(next, id) ? exposureFor(streamFor(seedOf(next.character.id), next.day, `blizzard@${at.hour}`)(), (next.coldGear ? 1 : 0) - (ring - 1)) : null;
  if (exposure === 'killed') {
    next.vitals.condition = 0;
    next.outcome = { choice: 'collapse', kind: 'died', vitals: next.vitals };
    say(next, `You went out into the blizzard${where(ring)} and lost the way back. They find you at the thaw.`, 'outcome', at);
    return next;
  }
  const lost = exposure === 'lost';
  say(next, def.run(next, bonus, ring, opts, at.light, lost ? 0 : luck ? BAND_MULT[luck.band] : 1), 'action', at);
  const luckLine = !lost && luck && bandLine(luck.band, luck.shifts);
  if (luckLine) say(next, luckLine, luck!.band === 'good' ? 'action' : 'hardship', at);
  if (exposure) {
    next.vitals.condition = Math.max(0, next.vitals.condition - EXPOSURE_COST[exposure] * talentEffects(next.character.talents).coldCost);
    say(next, exposure === 'lost' ? 'Lost in the white for hours — you dropped everything you carried to find the way home.'
      : exposure === 'frostbitten' ? 'The blizzard bit deep: frostbitten fingers, a face that burns.' : 'A rough few hours in the blizzard, but you came back.', 'hardship', at);
  }
  // First into a ring, you may find a manual someone left behind (#1243).
  const manual = id === 'scout' && !tooDarkToSee('scout', at.light) && !blindInFog(next.weatherToday, 'scout') ? MANUAL_BY_RING[ring] : undefined;
  if (manual && !next.manuals.includes(manual)) findManual(next, manual);
  if (r.conditionLost + t.conditionLost > 3) say(next, 'Pushed past empty — it cost your health.', 'hardship');
  if (skill) practiceSkill(next, skill, workHours * fx.practice);
  // Talents grow quietly from the work that uses them (#1264) — hidden ones too.
  growFrom(next, { kind: 'work', action: id, hours: workHours, practised: skill !== null });
  latchMilestones(next);
  return next;
}

/** Run a craft through the crafting module and fold the result back into Region 1 (on a cloned state). */
function runCraft(next: Region1State, id: ActionId, baseRecipe: CraftRecipe): Region1State {
  const before = next.vitals;
  const tr = talentEffects(next.character.talents);
  const recipe = baseRecipe;
  const hours = recipe.timeBase * modifiersFor(next.tools, 'craft').timeMult;
  // Tools that serve this action (a shovel for building) lighten the craft's own effort.
  const mod = modifiersFor(next.tools, id);
  // Skill in the craft's field lightens the work and lifts the grade (#1236).
  const skill = skillFor(id, recipe.id);
  const lvl = skill ? skillLevel(next.skills, skill) : 0;
  const td = talentDrain(next.character.talents, id);
  const se = statEffects(next.character.stats);
  const sd = statDrain(next.character.stats, id, skill);
  const fx = workEffects(next.focus, survivalLockOf(next), id, skill, next.vitals.clarity.current, se.unreliableBelow);
  const te = techniqueEffects(next.techniques, id, recipe.id);
  const effort = recipe.effort && { vigorRate: recipe.effort.vigorRate * mod.vigorMult * drainMult(lvl) * td.vigor * sd.vigor * fx.drain * te.drain, clarityRate: recipe.effort.clarityRate * mod.clarityMult * drainMult(lvl) * td.clarity * sd.clarity * fx.drain * te.drain };
  const crafter = crafterOf(next);
  // At night, close work needs firelight — or goes worse in the dark (#1281).
  const at = stampFor(next, hours);
  const night = nightWork(at.light, next.stores.firewood, hours, windFire(next.weatherToday));
  // Intelligence (#1256) lifts — or, below average, lowers — the grade.
  const { state: c, result } = craft({ ...crafter, skillBonus: craftBonus(lvl) + tr.craftGrade + te.grade + se.craftGrade + night.grade, salvageBonus: crafter.salvageBonus + tr.salvage }, { ...recipe, effort }, CRAFT_WORLD);
  next.vitals = c.vitals;
  if (result.kind !== 'refused' && night.clarity > 1) {
    const strain = Math.max(0, before.clarity.current - c.vitals.clarity.current) * (night.clarity - 1);
    next.vitals = { ...next.vitals, clarity: { ...next.vitals.clarity, current: Math.max(0, next.vitals.clarity.current - strain) } };
  }
  refundOverexertion(next, Math.max(0, before.condition - c.vitals.condition), tr.overexertCondition);
  for (const k of STORE_KEYS) next.stores[k] = c.inventory[k] ?? 0;
  if (result.kind !== 'refused') next.stores.firewood = Math.max(0, next.stores.firewood - night.fire);
  next.tools = c.tools;
  next.concepts = c.concepts;

  // craft() doesn't report its load, so read it off the pools for nightly drift.
  next.today.loadVigor += Math.max(0, before.vigor.current - c.vitals.vigor.current);
  next.today.loadClarity += Math.max(0, before.clarity.current - next.vitals.clarity.current);
  next.hoursToday += hours;
  next.coldGear = roadworthyGear(next.tools);

  const name = recipe.name.toLowerCase();
  const roof = (Object.keys(SHELTER_TYPES) as ShelterType[]).find(t => SHELTER_TYPES[t].recipe.id === recipe.id);
  const walls = (Object.keys(WALL_TYPES) as WallMaterial[]).find(w => WALL_TYPES[w].recipe.id === recipe.id);
  if (result.kind === 'crafted' && (roof || walls)) {
    next.tier = roof ? 1 : 2;
    next.shelter = roof ? { type: roof, walls: null } : { ...next.shelter, walls: walls ?? null };
    next.shelterGrade = result.grade;
    say(next, `Raised ${article(name)}${result.grade} ${name} — tier ${next.tier}, ${Math.round(warmth(next) * 100)}% warm.`, 'action', at);
  } else if (result.kind === 'crafted') {
    say(next, `Crafted ${article(name)}${result.grade} ${name}.${id === 'coldGear' ? (next.coldGear ? ' Good gear for the winter.' : " Crude — it won't hold up through a winter.") : ''}`, 'action', at);
  } else if (result.kind === 'failed') {
    const back = result.salvaged.map(b => `${b.qty} ${b.item}`).join(', ');
    say(next, `The ${name} came apart in your hands — materials wasted${back ? ` (salvaged ${back})` : ''}. Too foggy for fine work.`, 'hardship');
  }
  // Even a failed attempt is practice (refused crafts never got this far).
  if (skill && result.kind !== 'refused') practiceSkill(next, skill, hours * fx.practice);
  if (result.kind !== 'refused') growFrom(next, { kind: 'work', action: id, hours, craft: true, practised: skill !== null });
  // Making something absorbs the mind (#1305).
  if (result.kind !== 'refused') next.today.absorbed = true;
  latchMilestones(next);
  return next;
}

/**
 * Log hours of practice in a skill (on a cloned state) (#1236, #1241). The true
 * level is never announced — you feel it ("comes easier"); and when your own
 * estimate drops, you're humbled.
 */
function practiceSkill(next: Region1State, skill: SkillId, hours: number): void {
  // Credited practice (#1243): past Adept, practising alone counts for less — a manual or a
  // teacher brings it back — and knowing the techniques typical of your level speeds the climb.
  const lvl = skillLevel(next.skills, skill);
  const credited = hours * talentEffects(next.character.talents).practice
    * guidanceRate(lvl, guidanceFor(next, skill)) * techniqueFactor(next.techniques, skill, lvl);
  const { practice, levelUp, humbled } = practise(next.skills, skill, credited);
  next.skills = practice;
  const name = SKILLS[skill].name;
  if (levelUp !== null) say(next, `${SKILLS[skill].felt} — ${name.toLowerCase()} comes easier.`, 'milestone');
  if (humbled !== null) say(next, `The more you learn of ${name.toLowerCase()}, the more you see how little you know.`, 'action');
  learnWhatYouCan(next, skill);
}

/** The guidance you have for practising a skill: a manual for it, or nothing (teachers come with Region 1.5). */
const guidanceFor = (s: Region1State, skill: SkillId): Guidance => (s.manuals.some(m => manualById(m)?.skill === skill) ? 'manual' : 'none');

/** Work out techniques your practice has earned, and take up ones a manual offers once they're within reach. */
function learnWhatYouCan(next: Region1State, skill: SkillId): void {
  const lvl = skillLevel(next.skills, skill);
  for (const t of TECHNIQUES) {
    if (t.skill !== skill || next.techniques.includes(t.id)) continue;
    if ((next.skills[skill] ?? 0) >= selfLearnHours(t)) {
      next.techniques.push(t.id);
      say(next, `You've worked out ${t.name.toLowerCase()} — ${t.how}.`, 'milestone');
      continue;
    }
    const manual = next.manuals.map(manualById).find(m => m?.teaches.includes(t.id));
    if (manual && canBeTaught(t, lvl)) {
      next.techniques.push(t.id);
      say(next, `From ${manual.name.toLowerCase()}: ${t.name.toLowerCase()} — ${t.how}.`, 'milestone');
    }
  }
}

/** Pick up a manual (on a cloned state): it guides practice from now on and teaches when you're ready. */
function findManual(next: Region1State, id: string): void {
  const m = manualById(id);
  if (!m) return;
  next.manuals.push(id);
  say(next, `${m.found}.`, 'milestone');
  const lvl = skillLevel(next.skills, m.skill);
  const beyond = m.teaches.map(techniqueById).filter((t): t is Technique => !!t && !next.techniques.includes(t.id) && !canBeTaught(t, lvl));
  if (beyond.length) say(next, `Some of it is beyond you for now — you'll come back to it as your ${SKILLS[m.skill].name.toLowerCase()} grows.`, 'action');
  learnWhatYouCan(next, m.skill);
}

/**
 * Learn a technique from a source (#1243). `self`: only once practice has earned it;
 * `teacher` / `manual`: anything up to TEACH_REACH levels above your true level —
 * which is how a Warden ends up lopsided. Region 1.5's teachers call this.
 */
export function learnTechnique(s: Region1State, id: string, source: 'self' | 'teacher' | 'manual'): { state: Region1State; learned: boolean; reason?: string } {
  const t = techniqueById(id);
  if (!t) return { state: s, learned: false, reason: 'no such technique' };
  if (s.techniques.includes(id)) return { state: s, learned: false, reason: 'already known' };
  const lvl = skillLevel(s.skills, t.skill);
  if (source === 'self' && (s.skills[t.skill] ?? 0) < selfLearnHours(t)) {
    return { state: s, learned: false, reason: t.difficulty === 'teacher' ? 'this has to be taught' : 'not enough practice yet' };
  }
  if (source !== 'self' && !canBeTaught(t, lvl)) return { state: s, learned: false, reason: `too far beyond your ${SKILLS[t.skill].name.toLowerCase()}` };
  const next = clone(s);
  next.techniques.push(id);
  say(next, `${source === 'teacher' ? 'Taught' : source === 'manual' ? 'Learned from the page' : "You've worked out"}: ${t.name.toLowerCase()} — ${t.how}.`, 'milestone');
  return { state: next, learned: true };
}

/**
 * Food & water (#1233), tuned to feel real: water is critical (four nights without
 * kills from full health), food can be skipped for a while (slow wear), and
 * both fog the mind. Per night without, Condition and Clarity drop by the value
 * × the nights in a row; sleep recovery is scaled by the factors (both missing:
 * the losses add, the factors multiply).
 */
export const NEEDS = {
  water: { condition: 10, clarity: 8, vigorRecovery: 0.3, clarityRecovery: 0.3 },
  food: { condition: 1, clarity: 3, vigorRecovery: 0.5, clarityRecovery: 0.8 },
} as const;

/** A collapse is death when this deprived: nights in a row without water / without food (#1234). */
export const DEATH_THIRST = 2;
export const DEATH_HUNGER = 5;

const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

/** "a " for a countable thing; nothing for plurals and mass nouns ("timber walls", "cold gear"). */
const article = (name: string): string => (/s$|gear$/.test(name) ? '' : 'a ');

/**
 * End the day: eat and drink (each is needed to recover; going without
 * costs Condition, more each night in a row), sleep (recovery scales with shelter warmth), a cold night bites,
 * then capacity drifts on how the day was lived and a good night heals a
 * little Condition.
 */
export function endDay(s: Region1State): Region1State {
  const next = clone(s);
  if (next.outcome) return next;
  // The day as it was lived, for focus (#1238): was the mind locked, how clear was it, how long did it work.
  const lockedToday = survivalLockOf(next);

  // A set snare line brings in a little food overnight (before supper).
  if (capabilities(next.tools).has('snare-line')) {
    next.stores.rawFood += 1;
    say(next, 'The snare line caught something — 1 raw food.', 'action');
  }

  // Wet through after hours in the rain (#1284): a miserable evening.
  if (next.weatherToday === 'rain' && (next.wetHours ?? 0) >= WET_HOURS) {
    next.vitals.clarity.current = Math.max(0, next.vitals.clarity.current - WET_CLARITY);
    say(next, 'Wet through and miserable after a day out in the rain.', 'hardship');
  }
  // Wind strips warmth from the night (#1284).
  const w = Math.max(0, warmth(next) - windChill(next.weatherToday));
  // A cold night (#1283): the frost decides how much shelter is enough — and rain with no roof is always cold (#1284).
  // (The flat world keeps the old rule.)
  const cold = feelsTemperature(next)
    ? isColdNight(w, nightTemp(next.day, next.weatherToday, next.config.calendar)) || (next.weatherToday === 'rain' && next.tier === 0)
    : w < 0.3 && next.tier < 2;
  const freeze = keepFire(next, w);
  // Cooped up (#1305): a day without going out, studying or crafting adds to the streak; any of them ends it.
  const cooped = feelsTemperature(next) && !next.today.outside && !next.today.absorbed;
  next.cabinDays = cooped ? (next.cabinDays ?? 0) + 1 : 0;
  if (next.cabinDays === CABIN_FEVER_FROM) say(next, 'Cabin fever — too many days inside these walls. Your thoughts go round in circles.', 'hardship');
  const night = sleepNight(next, { warmth: w, coldNight: cold, lockedToday: lockedToday !== null, freeze, eating: next.eating, cabinDays: next.cabinDays });
  // Condition gone: the run ends (#1234). Deprived, you die of it; otherwise you're found collapsed.
  if (night.ended) {
    next.outcome = { choice: 'collapse', kind: night.ended, vitals: next.vitals };
    say(next, night.ended === 'died'
      ? night.cause === 'cold' ? 'The fire is long dead and the cold comes in. You don\'t wake. Dead of the cold.' : deathLine(next)
      : 'Your body gives out and you collapse. Traders find you days later, barely alive — this season is over.', 'outcome');
    return next;
  }

  // Overnight the land regrows a little, by the season — hardly at all in winter (#1304).
  next.explore = regrow(next.explore, growSeason(next.day, next.config.calendar), next.weatherToday === 'wind' || next.weatherToday === 'storm');
  // The day's snow lies, settles or melts (#1315).
  if (feelsTemperature(next)) next.snowDepth = nextSnowDepth(next.snowDepth ?? 0, next.weatherToday, next.day, next.config.calendar);

  next.day += 1;
  next.hoursToday = 0;
  next.today = { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false };
  next.studiedToday = {};
  // The thaw (#1302): the Warden made it through, graded by how they came out of it.
  if (seasonOf(next.day, next.config.calendar) === 'thaw') {
    const grade = gradeOf(next.vitals.condition);
    next.outcome = { choice: 'thaw', kind: 'survived', grade, vitals: next.vitals };
    say(next, `The ice breaks on the streams. You made it through the winter — ${GRADE_LINE[grade]}`, 'outcome');
    return next;
  }
  if (next.day === next.config.calendar.winterDay) say(next, 'Snow in the night, and it stays. Winter has come — hold on until the thaw.', 'milestone');
  dawnWeather(next);
  // Tell the player when survival takes over the mind, and when it lets go.
  const lockedNow = survivalLockOf(next);
  if (lockedNow && !lockedToday) say(next, `Survival takes over your thoughts — ${lockedNow}. Your focus will have to wait.`, 'hardship');
  if (!lockedNow && lockedToday && next.focus) say(next, `The pressure eases — your focus returns to ${focusLabel(next.focus)}.`, 'milestone');
  latchMilestones(next);
  return next;
}

/**
 * The night's fire (#1303): burn what the frost asks for, as far as the
 * woodpile goes. Returns the Condition a short or missing fire will cost.
 * Above freezing, or in the flat world, no fire is needed.
 */
function keepFire(next: Region1State, w: number): number {
  if (!feelsTemperature(next)) return 0;
  const t = nightTemp(next.day, next.weatherToday, next.config.calendar);
  const need = fireNeed(t, w);
  if (need === 0) return 0;
  const burnt = Math.min(need, next.stores.firewood);
  next.stores.firewood -= burnt;
  if (burnt === need) {
    say(next, `Kept the fire in through a ${Math.round(t)} °C night — ${burnt} firewood.`, 'action');
    return 0;
  }
  say(next, burnt > 0
    ? `The firewood ran out in the night (${burnt} of the ${need} it needed). The cold crept in.`
    : `No firewood — a fireless night at ${Math.round(t)} °C.`, 'hardship');
  return freezeLoss(t, w, next.coldGear, (need - burnt) / need);
}

/** The season the land regrows by on a day (#1304): early autumn, late autumn, or winter. */
export function growSeason(day: number, cal: Calendar): GrowSeason {
  if (seasonOf(day, cal) !== 'autumn') return 'winter';
  return day < lateFrom(cal) ? 'early' : 'late';
}

/**
 * A gathering trip's luck (#1314): its band and the shifts that set the odds.
 * Null for work that isn't a haul, and when the world has luck off (the flat world: every trip ordinary).
 */
function tripLuck(s: Region1State, id: ActionId, ring: Ring, at: { hour: number; light: number }, skillLevel: number, technique: boolean): { band: Band; shifts: Shift[] } | null {
  const domain = ACTION_DOMAIN[id];
  if (!domain || s.config.world.luck === false) return null;
  const shifts = luckShifts({ domain, weather: s.weatherToday, supply: s.explore.supply[ring][domain], skillLevel, technique, light: at.light, blizzard: inBlizzard(s, id) });
  const steps = shifts.reduce((n, x) => n + x.steps, 0);
  return { band: bandFor(haulFortune(seedOf(s.character.id), s.day, at.hour), steps), shifts };
}

/** Out in a winter blizzard today, on ringed work (#1315). Never in the flat world. */
const inBlizzard = (s: Region1State, id: ActionId): boolean =>
  !!ACTIONS[id].ringed && feelsTemperature(s) && isBlizzard(s.weatherToday, s.day, s.config.calendar);

/**
 * A warning about a dangerous trip, or null (#1315). Only a Warden sharp enough
 * to read the danger (Intelligence 12+) is warned; anyone else just sees the
 * snow. The same for a person and an AI.
 */
export function dangerOf(s: Region1State, id: ActionId, ring: Ring): string | null {
  if (!inBlizzard(s, id) || s.character.stats.int < DANGER_SENSE_INT) return null;
  return ring > 1 ? 'a blizzard, and a long way out — you may not come back' : 'a blizzard — out in this you could freeze, or never come back';
}

/**
 * The odds a gathering trip would have now, in a word (#1314) — for the player
 * and the AI. Uses the skill the Warden *thinks* they have (#1241), so the
 * odds never give the true level away; null for work that isn't a haul.
 */
export function tripOdds(s: Region1State, id: ActionId, ring: Ring): 'good' | 'fair' | 'poor' | 'bad' | null {
  const domain = ACTION_DOMAIN[id];
  if (!domain || s.config.world.luck === false) return null;
  const skill = skillFor(id);
  const te = techniqueEffects(s.techniques, id, undefined, true);
  const light = s.config.world.darkness ? lightOver(s.day, clockHour(s.hoursToday), queueHours(queueId(id, ring), s), s.config.calendar) : 1;
  return oddsWord(luckSteps({
    domain, weather: s.weatherToday, supply: s.explore.supply[ring][domain],
    skillLevel: skill ? perceivedLevel(s.skills, skill) : 0, technique: te.yield > 0 || te.drain < 1, light, blizzard: inBlizzard(s, id),
  }));
}

// ── Rationing and cabin fever (#1305) ───────────────────────────────────────

/** How the Warden eats: full (a meal a night), half (every other night), or none (fasting, even with food). */
export type EatingPlan = 'full' | 'half' | 'none';
export const EATING_PLANS: readonly EatingPlan[] = ['full', 'half', 'none'];
/** A lean night on half rations costs this much Condition — far less than going hungry. */
export const LEAN_CONDITION = 1;
/** …lets Vigor recover only this much… */
export const LEAN_VIGOR_RECOVERY = 0.75;
/** …and pulls the Vigor cap down, as a body on thin rations does. */
export const LEAN_VIGOR_TARGET = -10;
/** Cabin fever sets in on this many days cooped up in a row… */
export const CABIN_FEVER_FROM = 3;
/** …pulling the Clarity cap down this much per day beyond the second, to at most 20. */
export const CABIN_FEVER_STEP = 4;
/** Cabin fever's pull on tonight's Clarity cap target. */
export const cabinFever = (days: number): number => (days >= CABIN_FEVER_FROM ? -Math.min(20, CABIN_FEVER_STEP * (days - (CABIN_FEVER_FROM - 1))) : 0);

/** Set how the Warden eats (#1305). Takes effect tonight. */
export function setEating(s: Region1State, plan: EatingPlan): Region1State {
  if ((s.eating ?? 'full') === plan) return s;
  const next = clone(s);
  next.eating = plan;
  say(next, plan === 'half' ? 'You put yourself on half rations — a meal every other night.' : plan === 'none' ? 'You stop eating. The food stays where it is.' : 'Back to full rations.', 'action');
  return next;
}

/** How the thaw finds a Warden of each grade. */
const GRADE_LINE: Readonly<Record<'hale' | 'worn' | 'broken', string>> = {
  hale: 'hale, and stronger for it.',
  worn: 'worn thin, but standing.',
  broken: 'barely. It will be a long time before you are right.',
};

/**
 * What a night needs from a Warden — shared by Region 1 and the caravan road
 * (#1244), so survival works the same wherever you sleep.
 */
export type Sleeper = Pick<Region1State, 'day' | 'hoursToday' | 'vitals' | 'stores' | 'tools' | 'concepts' | 'today' | 'deprivation' | 'character' | 'focus' | 'log'>;

export interface NightOpts {
  /** Shelter warmth for the night, 0–1. */
  warmth: number;
  /** A cold, broken night: exposure costs Condition (unless the Warden is cold-proof). */
  coldNight: boolean;
  /** The mind was locked to survival today, so a focused concept wasn't worked on. */
  lockedToday: boolean;
  /** Someone else waters you tonight (the caravan's barrels, #1244): you don't go thirsty, and your own water is kept. */
  providedWater?: boolean;
  /** Condition lost to a freezing night without enough fire (#1303). */
  freeze?: number;
  /** How the Warden eats tonight (#1305). Default full. */
  eating?: EatingPlan;
  /** Days in a row cooped up, today included (#1305): cabin fever pulls the Clarity cap down. */
  cabinDays?: number;
}

/** The night's verdict: null if the Warden lives to see morning; otherwise how it ended. */
export interface NightResult { ended: null | 'died' | 'collapsed'; cause?: 'cold' }

/**
 * Grow the Warden's talents from one event (#1264). A tier gained is felt —
 * one line, naming neither the talent nor the tier.
 */
function growFrom(next: Pick<Region1State, 'character' | 'log' | 'day'>, e: GrowthEvent): void {
  const { talents, tierUps } = growTalents(next.character.talents, e);
  next.character.talents = talents;
  if (tierUps > 0) next.log.push({ day: next.day, text: TIER_UP_LINE, kind: 'milestone' });
}

/** Give back the share of overexertion's Condition cost that a talent spares (Tough, #1263). */
function refundOverexertion(next: Pick<Region1State, 'vitals'>, lost: number, mult: number): void {
  if (lost > 0 && mult < 1) next.vitals.condition = Math.min(100, next.vitals.condition + lost * (1 - mult));
}

/** The temperature matters in the full world; the flat world (tests) has none (#1283). */
const feelsTemperature = (s: Pick<Region1State, 'config'>): boolean => s.config.world.weather === 'seeded';
/** How much the snow cover slows walking and felling today (#1315): none in the flat world. */
const snowSlowFor = (s: Pick<Region1State, 'config' | 'snowDepth'>): number => (feelsTemperature(s) ? snowSlow(s.snowDepth ?? 0) : 1);
/** The streams are frozen hard today: water means melting snow (#1303). */
const melting = (s: Pick<Region1State, 'config' | 'day'>): boolean => feelsTemperature(s) && meltsSnow(s.day, s.config.calendar);

/** Work below freezing is heavier (#1283). */
const coldWork = (s: Pick<Region1State, 'config' | 'day' | 'weatherToday'>, hour: number): number =>
  feelsTemperature(s) && tempAt(s.day, hour, s.weatherToday, s.config.calendar) < 0 ? FREEZING_WORK : 1;

/** The weather on a day for this Warden (#1282): seeded by the character id and the day. */
const weatherOn = (s: Pick<Region1State, 'character' | 'config'>, day: number): WeatherId =>
  weatherFor(seedOf(s.character.id), day, s.config.world, s.config.calendar);

/** Learn a coming day's weather (a look-out, or Weather sense). */
function foresee(s: Pick<Region1State, 'character' | 'config' | 'forecast'>, day: number): WeatherId {
  const w = weatherOn(s, day);
  s.forecast[day] = w;
  return w;
}

/**
 * A new day's weather (#1282): set today's, forget forecasts for days that have
 * come, let Weather sense read the next two days, and note the morning's sky.
 */
function dawnWeather(s: Region1State): void {
  s.weatherToday = weatherOn(s, s.day);
  s.wetHours = 0;
  for (const d of Object.keys(s.forecast)) if (Number(d) <= s.day) delete s.forecast[Number(d)];
  if (s.techniques.includes('weather')) { foresee(s, s.day + 1); foresee(s, s.day + 2); }
  if (s.config.world.weather === 'seeded') say(s, `Morning: ${weatherName(s.weatherToday, s.day, s.config.calendar).toLowerCase()}.`, 'action');
}

/** The death line for a Warden who died of deprivation in the night. */
export function deathLine(s: Pick<Region1State, 'deprivation'>): string {
  const { hungry: h, thirsty: t } = s.deprivation;
  const thirst = t >= DEATH_THIRST;
  return `You lie down in the night and don't get up. Dead of ${thirst ? 'thirst' : 'starvation'} (${thirst ? `${t} nights without water` : `${h} nights without food`}).`;
}

/**
 * One night, on a cloned state (mutated in place): eat and drink (each is needed to recover; going without
 * costs Condition, more each night in a row), sleep (recovery scales with warmth), a cold night bites,
 * then — if you wake — capacity drifts on how the day was lived and a good night heals a little Condition.
 * The day counter is the caller's to advance.
 */
export function sleepNight(next: Sleeper, o: NightOpts): NightResult {
  const clarityAtDusk = next.vitals.clarity.current;
  const hoursWorked = next.hoursToday;
  const say = (text: string, kind: LogEntry['kind']): void => { next.log.push({ day: next.day, text, kind }); };

  // Food and water are separate needs, and both are needed to recover (#1233).
  // Fresh food first; when it's gone, the winter larder (#1302).
  // Half rations (#1305) skip every other night — a lean night, not a hungry one; fasting skips them all.
  const plan = o.eating ?? 'full';
  const hasFood = next.stores.rawFood > 0 || next.stores.rations > 0;
  const lean = plan === 'half' && hasFood && next.day % 2 === 1;
  const ate = plan !== 'none' && hasFood && !lean;
  const drank = o.providedWater || next.stores.water > 0;
  if (ate && next.stores.rawFood > 0) next.stores.rawFood -= 1;
  else if (ate) next.stores.rations -= 1;
  if (drank && !o.providedWater) next.stores.water -= 1;
  next.deprivation = { hungry: ate || lean ? 0 : next.deprivation.hungry + 1, thirsty: drank ? 0 : next.deprivation.thirsty + 1 };
  const running = (n: number): string => (n > 1 ? ` (${ordinal(n)} night running)` : '');
  if (lean) say('Half rations — a lean night.', 'hardship');
  else if (!ate) say(hasFood ? `Fasting — the food stays untouched${running(next.deprivation.hungry)}.` : `Hungry — no food${running(next.deprivation.hungry)}.`, 'hardship');
  if (!drank) say(`Thirsty — no water${running(next.deprivation.thirsty)}.`, 'hardship');

  const w = o.warmth;
  // Sleep restores body and mind in full only when fed and watered; each unmet need scales it down.
  const tr = talentEffects(next.character.talents);
  const se = statEffects(next.character.stats);
  const vigorFactor = (drank ? 1 : NEEDS.water.vigorRecovery) * (ate ? 1 : lean ? LEAN_VIGOR_RECOVERY : NEEDS.food.vigorRecovery);
  const clarityFactor = (drank ? 1 : NEEDS.water.clarityRecovery) * (ate || lean ? 1 : NEEDS.food.clarityRecovery);
  // Bedding (a "sleep" yield) is a flat Clarity bonus on top of the night's recovery.
  const bedding = modifiersFor(next.tools, 'sleep').yieldAdd;
  next.vitals = applyActivity(next.vitals, { hours: 8, vigorRate: 4.25 * vigorFactor, clarityRate: 5 * clarityFactor, clarityFlat: bedding, sleep: true }, { shelterWarmth: w }).vitals;
  // Going without escalates night by night — on the body (Condition) and the mind (Clarity).
  const { hungry, thirsty } = next.deprivation;
  const hc = tr.hungerCost;
  // Constitution and Tough soften the body's losses, Willpower the mind's (#1256, #1263).
  next.vitals.condition = Math.max(0, next.vitals.condition - (NEEDS.food.condition * hungry * hc + NEEDS.water.condition * thirsty) * se.deprivationCondition * tr.deprivationCondition);
  next.vitals.clarity.current = Math.max(0, next.vitals.clarity.current - (NEEDS.food.clarity * hungry * hc + NEEDS.water.clarity * thirsty) * se.deprivationClarity);
  if (lean) next.vitals.condition = Math.max(0, next.vitals.condition - LEAN_CONDITION * se.deprivationCondition * tr.deprivationCondition);
  // Holding a focus costs a little of the mind each night; a focused concept was turned over all day.
  if (next.focus) {
    next.vitals.clarity.current = Math.max(0, next.vitals.clarity.current - FOCUS_COST);
    if (next.focus.kind === 'concept' && !o.lockedToday) {
      addInsight(next.concepts, next.focus.id, CONCEPT_PER_HOUR * hoursWorked * reliability(clarityAtDusk, se.unreliableBelow), CRAFT_WORLD.concepts);
    }
  }
  // Cold-blooded (#1263) takes the edge off — or all of it, at mastery.
  if (o.coldNight && tr.coldCost > 0) {
    next.vitals.condition = Math.max(0, next.vitals.condition - 4 * tr.coldCost);
    say('A cold, broken night — the exposure bites.', 'hardship');
  }

  // A freezing night without fire (#1303) — Cold-blooded eases it too.
  const froze = (o.freeze ?? 0) * tr.coldCost;
  if (froze > 0) next.vitals.condition = Math.max(0, next.vitals.condition - froze);

  // Tough (#1237, from tier 3 since #1263): once per run, you cling on instead of going under.
  if (next.vitals.condition <= 0 && tr.lastStand && !next.character.lastStandUsed) {
    next.vitals.condition = 1;
    next.character.lastStandUsed = true;
    say('Everything in you says stop. You refuse. You wake, somehow — Condition 1. That was your one reprieve.', 'hardship');
  }
  // Condition gone (#1234): deprived, you die of it; otherwise you collapse.
  if (next.vitals.condition <= 0) {
    if (next.deprivation.thirsty >= DEATH_THIRST || next.deprivation.hungry >= DEATH_HUNGER) return { ended: 'died' };
    // Frozen to death: there's no being found collapsed in a winter night like that.
    return froze > 0 ? { ended: 'died', cause: 'cold' } : { ended: 'collapsed' };
  }
  // A night of hardship survived grows the talents that meet it (#1264): hunger, cold, being worn down.
  growFrom(next, { kind: 'night', hungry: !ate && !lean, cold: o.coldNight || froze > 0, condition: next.vitals.condition });

  const summary = {
    loadVigor: next.today.loadVigor,
    loadClarity: next.today.loadClarity,
    ate,
    drank,
    hungryNights: next.deprivation.hungry,
    shelterWarmth: w,
    pushedVigor: next.today.pushedVigor,
    pushedClarity: next.today.pushedClarity,
    // Thin rations wear the body down; too long cooped up wears on the mind (#1305).
    vigorTarget: lean ? LEAN_VIGOR_TARGET : 0,
    clarityTarget: cabinFever(o.cabinDays ?? 0),
  };
  next.vitals = driftCapacity(next.vitals, summary);
  // Healing, scaled by Constitution (#1256).
  const preHeal = next.vitals.condition;
  next.vitals = recoverCondition(next.vitals, summary);
  next.vitals.condition = Math.min(100, preHeal + (next.vitals.condition - preHeal) * se.heal);
  return { ended: null };
}

/** Set (or clear, with null) what the mind is working on (#1238). Free: it costs no hours. */
export function setFocus(s: Region1State, focus: Focus | null): Region1State {
  const next = clone(s);
  next.focus = focus;
  return next;
}

/** Why the mind is locked to survival right now, or null (#1238). */
export function survivalLockOf(s: Region1State): string | null {
  return survivalLock({
    thirsty: s.deprivation.thirsty,
    hungry: s.deprivation.hungry,
    condition: s.vitals.condition,
    daysToWinter: s.config.calendar.winterDay - s.day,
    winterReady: winterReady(s),
  });
}

/**
 * Run a planned queue for the rest of today: actions run in order until the
 * 14 waking hours are spent (an action started before the limit finishes),
 * then the day ends. Returns the new state and the unrun remainder, which
 * carries into tomorrow.
 */
export function runDay(s: Region1State, queue: readonly QueueItem[]): { state: Region1State; remaining: QueueItem[] } {
  if (s.outcome) return { state: s, remaining: [...queue] };
  let state = s;
  const remaining = [...queue];
  while (remaining.length > 0 && state.hoursToday < DAY_HOURS) {
    state = runAction(state, remaining.shift() as QueueItem);
  }
  return { state: endDay(state), remaining };
}

