/**
 * Region 1 — Greywind Reach: the playable opening loop, headless (#1207).
 *
 * Composes the sim-core modules into the Region 1 game: you arrive with almost
 * nothing, winter is coming, and you plan each day as a queue of actions to lay
 * in a larder, winterize a shelter, stock fuel and stay sound — then take an
 * exit when the caravan comes (docs/region-1-design.md).
 *
 * Same discipline as the rest of src/artificer: pure functions that return a
 * new state, deterministic (no randomness yet), no Phaser imports. A DOM
 * frontend, a test, or Core Warden can all drive it identically.
 */

import { traitEffects, traitDrain, type TraitId } from './traits';
import { SKILLS, LEVELS, skillFor, skillLevel, practise, drainMult, toolMult, SKILL_YIELD, SKILL_CRAFT, type SkillId, type SkillPractice } from './skills';
import { applyActivity, driftCapacity, recoverCondition, createVitals, type Vitals } from './vitality';
import { isWinterReady, evaluateMilestones, DEFAULT_THRESHOLDS, type MilestoneDef, type ReadinessInput, type ReadinessThresholds } from './readiness';
import { availableChoices, crossingPrepared, resolveOutcome, DEFAULT_CALENDAR, type Calendar, type Choice, type Outcome } from './winter';
import { createExploration, scout, survey, track, lookout, work, level, scouted, reachable, tripYield, hasFind, RINGS, RING_NAME, TRAVEL_HOURS, FINDS, type Domain, type Exploration, type Ring } from './exploration';
import type { Legacy } from './legacy';
import { craft, craftBlocker, study as studyConcept, craftWorld, createCrafter, capabilities, modifiersFor, GRADES, DEFAULT_EFFECTS, type CraftRecipe, type CrafterState, type ConceptProgress, type Grade, type Tool } from './crafting';

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
}

export interface Region1Config {
  calendar: Calendar;
  thresholds: ReadinessThresholds;
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
  today: { loadVigor: number; loadClarity: number; pushedVigor: boolean; pushedClarity: boolean };
  /** Nights in a row without food / without water (#1233); each night without costs more. */
  deprivation: { hungry: number; thirsty: number };
  /** Practice hours per skill (#1236); levels come from these. */
  skills: SkillPractice;
  /** Who the Warden is (#1237, #1239): name, portrait, two traits, and whether Tough's last stand is spent. */
  character: Character;
  log: LogEntry[];
  outcome: Outcome | null;
  config: Region1Config;
}

/** A fresh save: day 1, baseline body, a couple of meals, nothing known. */
export interface Character { name: string; portrait: string | null; traits: TraitId[]; lastStandUsed: boolean }

export function createRegion1(config: Partial<Region1Config> = {}, legacy?: Legacy, who: Partial<Omit<Character, 'lastStandUsed'>> = {}): Region1State {
  const traits = who.traits ?? [];
  // Skills a Warden starts with: what a past run taught (legacy) and what a trait brings, whichever is more.
  const start: SkillPractice = { ...(legacy?.skills ?? {}) };
  for (const [k, h] of Object.entries(traitEffects(traits).startSkills ?? {}) as [SkillId, number][]) start[k] = Math.max(start[k] ?? 0, h);
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
    character: { name: who.name ?? '', portrait: who.portrait ?? null, traits: [...traits], lastStandUsed: false },
    log: [],
    outcome: null,
    config: { calendar: config.calendar ?? DEFAULT_CALENDAR, thresholds: config.thresholds ?? DEFAULT_THRESHOLDS },
  };
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
    character: { ...s.character, traits: [...s.character.traits] },
    log: [...s.log],
  };
}

const say = (s: Region1State, text: string, kind: LogEntry['kind']): void => { s.log.push({ day: s.day, text, kind }); };

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

// ── Actions ─────────────────────────────────────────────────────────────────

export type ActionId =
  | 'scout' | 'survey' | 'track'
  | 'gather' | 'hunt' | 'water' | 'wood' | 'quarry' | 'preserve'
  | 'build' | 'coldGear'
  | 'knife' | 'snare' | 'waterskin' | 'bedroll' | 'shovel'
  | 'lookout' | 'study'
  | 'tinker' | 'rest';

/** Actions that happen out on the land, in a chosen ring. */
export type RingActionId = 'scout' | 'survey' | 'track' | 'lookout' | 'gather' | 'hunt' | 'water' | 'wood' | 'quarry';
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
   * `bonus` is the extra yield your tools give this action.
   */
  run: (s: Region1State, bonus: number, ring: Ring, opts: ActionOpts) => string;
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
/** You've seen the pass out through the distant hills — the solo crossing needs it. */
export const routeKnown = (s: Region1State): boolean => level(s.explore, 3, 'routes') >= 1;

const where = (ring: Ring): string => (ring === 1 ? '' : ` in the ${RING_NAME[ring].toLowerCase()} ring`);

/**
 * Work a domain on (an already-cloned) state: it teaches you the ground and
 * depletes it. Returns a journal suffix for any find.
 */
function workLand(s: Region1State, ring: Ring, d: Domain): string {
  const w = work(s.explore, ring, d);
  s.explore = w.exploration;
  const f = w.found ? FINDS[w.found] : undefined;
  return f ? ` You know this ground well now — found a ${f.name.toLowerCase()} (${f.note}).` : '';
}
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

/** Road-worthy cold gear: you have some, and it isn't crude (crude gear won't hold up on the crossing). */
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
    run: (s, _b, r) => {
      s.explore = scout(s.explore, r);
      return r === 1 ? 'Scouted the near ground — you can see where food, water, wood and stone lie.'
        : r === 2 ? 'Pushed out to the far ring — new forage and timber, and paths leading on.'
          : 'Reached the distant hills — and glimpsed the pass out of the Reach.';
    },
  },
  survey: {
    name: 'Survey', hours: 7, vigorRate: -2, clarityRate: -5, ringed: true, gate: reach,
    run: (s, _b, r) => { s.explore = survey(s.explore, r); return `Surveyed carefully${where(r)} — every trip there yields more now.`; },
  },
  track: {
    name: 'Track', hours: 4, vigorRate: -3, clarityRate: -2.5, ringed: true, gate: reach,
    run: (s, _b, r) => { s.explore = track(s.explore, r); return `Tracked a deer herd${where(r)} — you can hunt there.`; },
  },
  gather: {
    name: 'Gather food', hours: 5, vigorRate: -3.5, clarityRate: -1, ringed: true, gate: reach,
    run: (s, b, r) => {
      const blind = level(s.explore, r, 'forage') === 0;
      const n = tripYield(s.explore, r, 'forage', 3, 2) + b;
      const note = workLand(s, r, 'forage');
      const fiber = findBonus(s, r, 'forage');
      s.stores.rawFood += n; s.stores.materials += fiber; s.flags.everFood = true;
      return `${blind ? 'Wandered, not knowing where to look — gathered' : 'Gathered'} ${n} raw food${fiber ? ` and ${fiber} fiber` : ''}${where(r)}.${note}`;
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
    run: (s, b, r, o) => {
      const small = o.target === 'small';
      const n = (small ? tripYield(s.explore, r, 'game', 3, 1) : tripYield(s.explore, r, 'game', 7, 0)) + b + findBonus(s, r, 'game');
      const note = workLand(s, r, 'game');
      s.stores.rawFood += n; s.flags.everFood = true; s.flags.everHunt = true;
      if (!small) { s.stores.hides += 1; s.flags.everHide = true; }
      return small ? `Took small game${where(r)} — ${n} raw food.${note}` : `A good hunt${where(r)} — ${n} raw food and a hide.${note}`;
    },
  },
  water: {
    name: 'Fetch water', hours: 2, vigorRate: -3, clarityRate: -0.5, ringed: true, gate: reach,
    run: (s, b, r) => {
      const n = tripYield(s.explore, r, 'water', 4, 1) + (s.site === 'river' && r === 1 ? 2 : 0) + b + findBonus(s, r, 'water');
      const note = workLand(s, r, 'water');
      s.stores.water += n; s.flags.everWater = true;
      return `Fetched ${n} water${where(r)}.${note}`;
    },
  },
  wood: {
    name: 'Gather wood', hours: 4, vigorRate: -4, clarityRate: -1, ringed: true, gate: reach,
    run: (s, _b, r) => {
      const f = tripYield(s.explore, r, 'timber', 4, 1) + (s.site === 'tree' && r === 1 ? 1 : 0) + findBonus(s, r, 'timber');
      const m = tripYield(s.explore, r, 'timber', 2, 1);
      const note = workLand(s, r, 'timber');
      s.stores.firewood += f; s.stores.materials += m; s.flags.everWood = true;
      return `Cut ${f} firewood and ${m} materials${where(r)}.${note}`;
    },
  },
  quarry: {
    name: 'Quarry stone', hours: 5, vigorRate: -4.5, clarityRate: -1, ringed: true, gate: reach,
    run: (s, _b, r) => {
      const n = tripYield(s.explore, r, 'stone', 3, 1) + findBonus(s, r, 'stone');
      const note = workLand(s, r, 'stone');
      s.stores.stone += n;
      return `Broke out ${n} stone${where(r)}.${note}`;
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
    gate: (s, _r, o) => (roadworthyGear(s.tools) ? 'you already have road-worthy cold gear' : unknownRecipe(s, coldGearRecipe(o)) ?? craftBlocker(crafterOf(s), coldGearRecipe(o))),
    recipeFor: (_s, o) => coldGearRecipe(o),
    options: (s, o) => [choiceGroup('material', 'Material', o.material ?? 'fiber', [
      { value: 'fiber', label: 'Woven fiber', note: `${costNote(COLD_GEAR_RECIPE)} · crude won't hold up on the road`, blocked: null },
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
    run: (s, _b, r) => {
      s.explore = lookout(s.explore, r);
      return `Climbed high${where(r)} and looked out — the ground sharpens below${r < 3 ? `, and you can see over the ${RING_NAME[(r + 1) as Ring].toLowerCase()} ring` : ''}.`;
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
    run: (s, _b, _r, o) => {
      const concept = o.concept ?? 'joinery';
      const before = s.vitals.clarity.current;
      const c = { ...crafterOf(s), studiedToday: s.studiedToday };
      const r = studyConcept(c, concept, CRAFT_WORLD);
      s.vitals = r.state.vitals;
      s.concepts = r.state.concepts;
      s.studiedToday = r.state.studiedToday;
      s.today.loadClarity += Math.max(0, before - s.vitals.clarity.current);
      return `Studied ${concept} — ${r.gained.toFixed(1)} insight (rank ${s.concepts[concept]?.rank ?? 0}).`;
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
  return (recipe ? recipe.timeBase : def.variant?.(opts, s, ring).hours ?? def.hours) + (def.ringed ? TRAVEL_HOURS[ring] : 0);
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
  const refused = def.gate?.(next, ring, opts) ?? null;
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
  const workHours = (v.hours ?? def.hours) * mod.timeMult;
  // Outer rings cost the walk there and back: hard on the legs, easy on the mind.
  const travel = def.ringed ? TRAVEL_HOURS[ring] : 0;
  const td = traitDrain(next.character.traits, skill);
  const r = applyActivity(next.vitals, { hours: workHours, vigorRate: (v.vigorRate ?? def.vigorRate) * mod.vigorMult * drainMult(lvl) * td.vigor, clarityRate: (v.clarityRate ?? def.clarityRate) * mod.clarityMult * drainMult(lvl) * td.clarity });
  const t = applyActivity(r.vitals, { hours: travel, vigorRate: TRAVEL_VIGOR_RATE, clarityRate: TRAVEL_CLARITY_RATE });
  next.vitals = t.vitals;
  next.today.loadVigor += r.loadVigor + t.loadVigor;
  next.today.loadClarity += r.loadClarity + t.loadClarity;
  next.today.pushedVigor ||= r.pushedVigor || t.pushedVigor;
  next.today.pushedClarity ||= r.pushedClarity || t.pushedClarity;
  next.hoursToday += workHours + travel;

  const bonus = Math.round(mod.yieldAdd * toolMult(lvl)) + SKILL_YIELD[lvl];
  say(next, def.run(next, bonus, ring, opts), 'action');
  if (r.conditionLost + t.conditionLost > 3) say(next, 'Pushed past empty — it cost your health.', 'hardship');
  if (skill) practiceSkill(next, skill, workHours);
  latchMilestones(next);
  return next;
}

/** Run a craft through the crafting module and fold the result back into Region 1 (on a cloned state). */
function runCraft(next: Region1State, id: ActionId, baseRecipe: CraftRecipe): Region1State {
  const before = next.vitals;
  const tr = traitEffects(next.character.traits);
  // Careful Hands takes longer over the work (#1237).
  const recipe = tr.craftTime === 1 ? baseRecipe : { ...baseRecipe, timeBase: baseRecipe.timeBase * tr.craftTime };
  const hours = recipe.timeBase * modifiersFor(next.tools, 'craft').timeMult;
  // Tools that serve this action (a shovel for building) lighten the craft's own effort.
  const mod = modifiersFor(next.tools, id);
  // Skill in the craft's field lightens the work and lifts the grade (#1236).
  const skill = skillFor(id, recipe.id);
  const lvl = skill ? skillLevel(next.skills, skill) : 0;
  const td = traitDrain(next.character.traits, skill);
  const effort = recipe.effort && { vigorRate: recipe.effort.vigorRate * mod.vigorMult * drainMult(lvl) * td.vigor, clarityRate: recipe.effort.clarityRate * mod.clarityMult * drainMult(lvl) * td.clarity };
  const crafter = crafterOf(next);
  const { state: c, result } = craft({ ...crafter, skillBonus: SKILL_CRAFT[lvl] + tr.craftGrade, salvageBonus: crafter.salvageBonus + tr.salvage }, { ...recipe, effort }, CRAFT_WORLD);
  next.vitals = c.vitals;
  for (const k of STORE_KEYS) next.stores[k] = c.inventory[k] ?? 0;
  next.tools = c.tools;
  next.concepts = c.concepts;

  // craft() doesn't report its load, so read it off the pools for nightly drift.
  next.today.loadVigor += Math.max(0, before.vigor.current - c.vitals.vigor.current);
  next.today.loadClarity += Math.max(0, before.clarity.current - c.vitals.clarity.current);
  next.hoursToday += hours;
  next.coldGear = roadworthyGear(next.tools);

  const name = recipe.name.toLowerCase();
  const roof = (Object.keys(SHELTER_TYPES) as ShelterType[]).find(t => SHELTER_TYPES[t].recipe.id === recipe.id);
  const walls = (Object.keys(WALL_TYPES) as WallMaterial[]).find(w => WALL_TYPES[w].recipe.id === recipe.id);
  if (result.kind === 'crafted' && (roof || walls)) {
    next.tier = roof ? 1 : 2;
    next.shelter = roof ? { type: roof, walls: null } : { ...next.shelter, walls: walls ?? null };
    next.shelterGrade = result.grade;
    say(next, `Raised ${article(name)}${result.grade} ${name} — tier ${next.tier}, ${Math.round(warmth(next) * 100)}% warm.`, 'action');
  } else if (result.kind === 'crafted') {
    say(next, `Crafted ${article(name)}${result.grade} ${name}.${id === 'coldGear' ? (next.coldGear ? ' You could brave the road now.' : " Crude — it won't hold up on the crossing.") : ''}`, 'action');
  } else if (result.kind === 'failed') {
    const back = result.salvaged.map(b => `${b.qty} ${b.item}`).join(', ');
    say(next, `The ${name} came apart in your hands — materials wasted${back ? ` (salvaged ${back})` : ''}. Too foggy for fine work.`, 'hardship');
  }
  // Even a failed attempt is practice (refused crafts never got this far).
  if (skill && result.kind !== 'refused') practiceSkill(next, skill, hours);
  latchMilestones(next);
  return next;
}

/** Log hours of practice in a skill (on a cloned state), announcing a level-up (#1236). */
function practiceSkill(next: Region1State, skill: SkillId, hours: number): void {
  const { practice, levelUp } = practise(next.skills, skill, hours * traitEffects(next.character.traits).practice);
  next.skills = practice;
  if (levelUp === null) return;
  const title = LEVELS[levelUp];
  say(next, `${SKILLS[skill].name} improved — you're now ${/^[AEIOU]/.test(title) ? 'an' : 'a'} ${title}.`, 'milestone');
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

  // A set snare line brings in a little food overnight (before supper).
  if (capabilities(next.tools).has('snare-line')) {
    next.stores.rawFood += 1;
    say(next, 'The snare line caught something — 1 raw food.', 'action');
  }

  // Food and water are separate needs, and both are needed to recover (#1233).
  const ate = next.stores.rawFood > 0;
  const drank = next.stores.water > 0;
  if (ate) next.stores.rawFood -= 1;
  if (drank) next.stores.water -= 1;
  next.deprivation = { hungry: ate ? 0 : next.deprivation.hungry + 1, thirsty: drank ? 0 : next.deprivation.thirsty + 1 };
  const running = (n: number): string => (n > 1 ? ` (${ordinal(n)} night running)` : '');
  if (!ate) say(next, `Hungry — no food${running(next.deprivation.hungry)}.`, 'hardship');
  if (!drank) say(next, `Thirsty — no water${running(next.deprivation.thirsty)}.`, 'hardship');

  const w = warmth(next);
  // Sleep restores body and mind in full only when fed and watered; each unmet need scales it down.
  const tr = traitEffects(next.character.traits);
  const vigorFactor = (drank ? 1 : NEEDS.water.vigorRecovery) * (ate ? 1 : NEEDS.food.vigorRecovery) * tr.vigorRecovery;
  const clarityFactor = (drank ? 1 : NEEDS.water.clarityRecovery) * (ate ? 1 : NEEDS.food.clarityRecovery) * tr.clarityRecovery;
  // Bedding (a "sleep" yield) is a flat Clarity bonus on top of the night's recovery.
  const bedding = modifiersFor(next.tools, 'sleep').yieldAdd;
  next.vitals = applyActivity(next.vitals, { hours: 8, vigorRate: 4.25 * vigorFactor, clarityRate: 5 * clarityFactor, clarityFlat: bedding, sleep: true }, { shelterWarmth: w }).vitals;
  // Going without escalates night by night — on the body (Condition) and the mind (Clarity).
  const { hungry, thirsty } = next.deprivation;
  const hc = tr.hungerCost, wc = tr.thirstCost;
  next.vitals.condition = Math.max(0, next.vitals.condition - (NEEDS.food.condition * hungry * hc + NEEDS.water.condition * thirsty * wc));
  next.vitals.clarity.current = Math.max(0, next.vitals.clarity.current - (NEEDS.food.clarity * hungry * hc + NEEDS.water.clarity * thirsty * wc));
  if (w < 0.3 && next.tier < 2 && !tr.coldProof) {
    next.vitals.condition = Math.max(0, next.vitals.condition - 4);
    say(next, 'A cold, broken night — the exposure bites.', 'hardship');
  }

  // Tough (#1237): once per run, you cling on instead of going under.
  if (next.vitals.condition <= 0 && tr.lastStand && !next.character.lastStandUsed) {
    next.vitals.condition = 1;
    next.character.lastStandUsed = true;
    say(next, 'Everything in you says stop. You refuse. You wake, somehow — Condition 1. That was your one reprieve.', 'hardship');
  }
  // Condition gone: the run ends (#1234). Deprived, you die of it; otherwise you're found collapsed.
  if (next.vitals.condition <= 0) {
    const { hungry: h, thirsty: t } = next.deprivation;
    const cause = t >= DEATH_THIRST ? 'thirst' : h >= DEATH_HUNGER ? 'starvation' : null;
    next.outcome = { choice: 'collapse', kind: cause ? 'died' : 'collapsed', vitals: next.vitals };
    say(next, cause
      ? `You lie down in the night and don't get up. Dead of ${cause} (${cause === 'thirst' ? `${t} nights without water` : `${h} nights without food`}).`
      : 'Your body gives out and you collapse. Traders find you days later, barely alive — this season is over.', 'outcome');
    return next;
  }

  const summary = {
    loadVigor: next.today.loadVigor,
    loadClarity: next.today.loadClarity,
    ate,
    drank,
    hungryNights: next.deprivation.hungry,
    shelterWarmth: w,
    pushedVigor: next.today.pushedVigor,
    pushedClarity: next.today.pushedClarity,
  };
  next.vitals = driftCapacity(next.vitals, summary);
  // Healing, scaled by traits (Quick Learner and Tough heal slower).
  const preHeal = next.vitals.condition;
  next.vitals = recoverCondition(next.vitals, summary);
  next.vitals.condition = preHeal + (next.vitals.condition - preHeal) * tr.healRate;

  next.day += 1;
  next.hoursToday = 0;
  next.today = { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false };
  next.studiedToday = {};
  latchMilestones(next);
  return next;
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

/**
 * Take an exit. Throws if that exit isn't open today (no exits while
 * preparing; the caravan only during its window) or the region is resolved.
 */
export function choose(s: Region1State, choice: Choice): Region1State {
  if (s.outcome) throw new Error('Region 1 is already resolved');
  const open = availableChoices(s.day, s.config.calendar);
  if (!open.includes(choice)) throw new Error(`exit "${choice}" is not available on day ${s.day}`);
  const next = clone(s);
  const outcome = resolveOutcome(choice, {
    ready: winterReady(next),
    // The road out also needs a route: you must have seen the pass in the distant hills.
    canCross: routeKnown(next) && crossingPrepared({ coldGear: next.coldGear, rations: next.stores.rations, vitals: next.vitals }),
    vitals: next.vitals,
  });
  next.outcome = outcome;
  next.vitals = outcome.vitals;
  say(next, `Region 1 resolved: ${choice} → ${outcome.kind}${outcome.injury ? ` (${outcome.injury})` : ''}.`, 'outcome');
  return next;
}
