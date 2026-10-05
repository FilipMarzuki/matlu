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

import { applyActivity, driftCapacity, createVitals, type Vitals } from './vitality';
import { isWinterReady, evaluateMilestones, DEFAULT_THRESHOLDS, type MilestoneDef, type ReadinessInput, type ReadinessThresholds } from './readiness';
import { availableChoices, crossingPrepared, resolveOutcome, DEFAULT_CALENDAR, type Calendar, type Choice, type Outcome } from './winter';

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

/** How much of a site's warmth each build tier realises (none / lean-to / winterized). */
const TIER_FACTOR = [0.3, 0.65, 1] as const;
/** Materials to raise the shelter to tier 1, then tier 2. */
export const BUILD_COST = [3, 5] as const;
export type Tier = 0 | 1 | 2;

// ── State ───────────────────────────────────────────────────────────────────

export interface Stores {
  rawFood: number;
  water: number;
  firewood: number;
  materials: number;
  /** Preserved food — the winter larder (not today's meals). */
  rations: number;
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
  coldGear: boolean;
  knowledge: { scouted: boolean; surveyed: boolean; tracked: boolean };
  site: SiteId | null;
  tier: Tier;
  /** One-way "ever did X" flags behind the first-time milestones. */
  flags: { everWater: boolean; everFood: boolean; everWood: boolean; everHunt: boolean; everPreserve: boolean };
  milestones: string[];
  /** Running totals for today, fed to nightly capacity drift. */
  today: { loadVigor: number; loadClarity: number; pushedVigor: boolean; pushedClarity: boolean };
  log: LogEntry[];
  outcome: Outcome | null;
  config: Region1Config;
}

/** A fresh save: day 1, baseline body, a couple of meals, nothing known. */
export function createRegion1(config: Partial<Region1Config> = {}): Region1State {
  const s: Region1State = {
    day: 1,
    hoursToday: 0,
    vitals: createVitals(),
    stores: { rawFood: 2, water: 2, firewood: 0, materials: 1, rations: 0 },
    coldGear: false,
    knowledge: { scouted: false, surveyed: false, tracked: false },
    site: null,
    tier: 0,
    flags: { everWater: false, everFood: false, everWood: false, everHunt: false, everPreserve: false },
    milestones: [],
    today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false },
    log: [],
    outcome: null,
    config: { calendar: config.calendar ?? DEFAULT_CALENDAR, thresholds: config.thresholds ?? DEFAULT_THRESHOLDS },
  };
  return s;
}

/** Deep-enough copy so every exported function can stay pure. */
function clone(s: Region1State): Region1State {
  return {
    ...s,
    vitals: { vigor: { ...s.vitals.vigor }, clarity: { ...s.vitals.clarity }, condition: s.vitals.condition },
    stores: { ...s.stores },
    knowledge: { ...s.knowledge },
    flags: { ...s.flags },
    milestones: [...s.milestones],
    today: { ...s.today },
    log: [...s.log],
  };
}

const say = (s: Region1State, text: string, kind: LogEntry['kind']): void => { s.log.push({ day: s.day, text, kind }); };

// ── Derived values ──────────────────────────────────────────────────────────

/** Shelter warmth, 0..1 = site potential × how far the build has come. */
export function warmth(s: Region1State): number {
  return s.site ? SITES[s.site].warmth * TIER_FACTOR[s.tier] : 0;
}

export function readinessInput(s: Region1State): ReadinessInput {
  return { rations: s.stores.rations, firewood: s.stores.firewood, shelterWarmth: warmth(s), vitals: s.vitals };
}

export const winterReady = (s: Region1State): boolean => isWinterReady(readinessInput(s), s.config.thresholds);

// ── Actions ─────────────────────────────────────────────────────────────────

export type ActionId =
  | 'scout' | 'survey' | 'track'
  | 'gather' | 'hunt' | 'water' | 'wood' | 'preserve'
  | 'build' | 'coldGear'
  | 'tinker' | 'rest';

interface ActionDef {
  name: string;
  hours: number;
  /** Per-hour pull on each pool (negative = drain). */
  vigorRate: number;
  clarityRate: number;
  /** Why the action can't be done right now, or null if it can. */
  gate?: (s: Region1State) => string | null;
  /** Apply the effect to (an already-cloned) state; return the journal line. */
  run: (s: Region1State) => string;
}

const needsScout = (s: Region1State): string | null => (s.knowledge.scouted ? null : "you don't know where to look yet — scout first");
/** Surveyed land gives richer returns. */
const y = (s: Region1State, surveyed: number, base: number): number => (s.knowledge.surveyed ? surveyed : base);

export const ACTIONS: Readonly<Record<ActionId, ActionDef>> = {
  scout: {
    name: 'Scout', hours: 4, vigorRate: -3.5, clarityRate: -1,
    run: s => { s.knowledge.scouted = true; return 'Scouted the Reach — you can see where food, water and wood lie.'; },
  },
  survey: {
    name: 'Survey', hours: 7, vigorRate: -2, clarityRate: -4, gate: needsScout,
    run: s => { s.knowledge.surveyed = true; return 'Surveyed carefully — every trip yields more now.'; },
  },
  track: {
    name: 'Track', hours: 4, vigorRate: -3, clarityRate: -2.5, gate: needsScout,
    run: s => { s.knowledge.tracked = true; return 'Tracked a deer herd on the plain — you can hunt.'; },
  },
  gather: {
    name: 'Gather food', hours: 5, vigorRate: -3.5, clarityRate: -1, gate: needsScout,
    run: s => { const n = y(s, 5, 3); s.stores.rawFood += n; s.flags.everFood = true; return `Gathered ${n} raw food.`; },
  },
  hunt: {
    name: 'Hunt', hours: 5, vigorRate: -4, clarityRate: -2,
    gate: s => (s.knowledge.tracked ? null : 'no game tracked yet'),
    run: s => { s.stores.rawFood += 7; s.flags.everFood = true; s.flags.everHunt = true; return 'A good hunt — 7 raw food.'; },
  },
  water: {
    name: 'Fetch water', hours: 2, vigorRate: -3, clarityRate: -0.5, gate: needsScout,
    run: s => { const n = y(s, 5, 4) + (s.site === 'river' ? 2 : 0); s.stores.water += n; s.flags.everWater = true; return `Fetched ${n} water.`; },
  },
  wood: {
    name: 'Gather wood', hours: 4, vigorRate: -4, clarityRate: -1, gate: needsScout,
    run: s => {
      const f = y(s, 5, 4) + (s.site === 'tree' ? 1 : 0), m = y(s, 3, 2);
      s.stores.firewood += f; s.stores.materials += m; s.flags.everWood = true;
      return `Cut ${f} firewood and ${m} materials.`;
    },
  },
  preserve: {
    name: 'Preserve food', hours: 4, vigorRate: -1, clarityRate: -3.5,
    gate: s => needsScout(s) ?? (s.stores.rawFood >= 2 ? null : 'not enough raw food to preserve'),
    run: s => {
      // Two raw food smoke down to one ration; up to three rations a session.
      const made = Math.min(3, Math.floor(s.stores.rawFood / 2));
      s.stores.rawFood -= made * 2; s.stores.rations += made; s.flags.everPreserve = true;
      return `Smoked and salted ${made * 2} food into ${made} winter rations.`;
    },
  },
  build: {
    name: 'Build shelter', hours: 8, vigorRate: -3.5, clarityRate: -1.5,
    gate: s => {
      if (!s.site) return 'choose a site first';
      if (s.tier >= 2) return 'the shelter is already winterized';
      // The guard above rules out tier 2, but TS can't narrow a tuple index from it.
      const need = BUILD_COST[s.tier as 0 | 1];
      return s.stores.materials >= need ? null : `need ${need} materials (have ${s.stores.materials})`;
    },
    run: s => {
      s.stores.materials -= BUILD_COST[s.tier as 0 | 1];
      s.tier = (s.tier + 1) as Tier;
      return `Raised the shelter to tier ${s.tier} — ${Math.round(warmth(s) * 100)}% warm.`;
    },
  },
  coldGear: {
    name: 'Craft cold gear', hours: 6, vigorRate: -1.5, clarityRate: -4,
    gate: s => (s.coldGear ? 'you already have cold gear' : s.stores.materials >= 3 ? null : 'need 3 materials'),
    run: s => { s.stores.materials -= 3; s.coldGear = true; return 'Stitched cold-weather gear — you could brave the road now.'; },
  },
  tinker: {
    name: 'Tinker / plan', hours: 5, vigorRate: 2, clarityRate: -4.5,
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
  { id: 'scout', name: 'Get your bearings', done: s => s.knowledge.scouted },
  { id: 'site', name: 'Stake a claim', done: s => s.site !== null },
  { id: 'water', name: 'Water secured', done: s => s.flags.everWater },
  { id: 'forage', name: 'First forage', done: s => s.flags.everFood },
  { id: 'timber', name: 'Fire & timber', done: s => s.flags.everWood },
  { id: 'roof', name: 'A roof overhead', done: s => s.tier >= 1 },
  { id: 'track', name: 'Read the tracks', done: s => s.knowledge.tracked },
  { id: 'catch', name: 'First catch', done: s => s.flags.everHunt },
  { id: 'larder0', name: 'The larder begins', done: s => s.flags.everPreserve },
  { id: 'winterized', name: 'Winterized', done: s => warmth(s) >= s.config.thresholds.warmth },
  { id: 'larder', name: 'Larder stocked', done: s => s.stores.rations >= s.config.thresholds.larder },
  { id: 'fuel', name: 'Fuel laid in', done: s => s.stores.firewood >= s.config.thresholds.fuel },
  { id: 'ready', name: 'Winter-ready', done: s => winterReady(s) },
];

/** Re-evaluate the ladder on a (cloned) state, journalling any new rungs. */
function latchMilestones(s: Region1State): void {
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
  if (!next.knowledge.scouted) { say(next, `Can't stake a claim yet: ${needsScout(next)}.`, 'skip'); return next; }
  if (next.site === site) return next;
  const moved = next.site !== null && next.tier > 0;
  next.site = site;
  next.tier = 0;
  say(next, `Chose the ${SITES[site].name.toLowerCase()} as your ground${moved ? ' — the old shelter is left behind' : ''}.`, 'action');
  latchMilestones(next);
  return next;
}

/**
 * Do one action now. A refused action (gate not met) costs nothing — it simply
 * doesn't happen — and is journalled as a skip.
 */
export function runAction(s: Region1State, id: ActionId): Region1State {
  const next = clone(s);
  if (next.outcome) return next;
  const def = ACTIONS[id];
  const refused = def.gate?.(next) ?? null;
  if (refused) { say(next, `${def.name}: skipped — ${refused}.`, 'skip'); return next; }

  const r = applyActivity(next.vitals, { hours: def.hours, vigorRate: def.vigorRate, clarityRate: def.clarityRate });
  next.vitals = r.vitals;
  next.today.loadVigor += r.loadVigor;
  next.today.loadClarity += r.loadClarity;
  next.today.pushedVigor ||= r.pushedVigor;
  next.today.pushedClarity ||= r.pushedClarity;
  next.hoursToday += def.hours;

  say(next, def.run(next), 'action');
  if (r.conditionLost > 3) say(next, 'Pushed past empty — it cost your health.', 'hardship');
  latchMilestones(next);
  return next;
}

/**
 * End the day: eat and drink (going without costs Condition and weakens
 * recovery), sleep (recovery scales with shelter warmth), a cold night bites,
 * then capacity drifts on how the day was lived.
 */
export function endDay(s: Region1State): Region1State {
  const next = clone(s);
  if (next.outcome) return next;

  let ate = true;
  if (next.stores.rawFood > 0) next.stores.rawFood -= 1; else { ate = false; say(next, 'Hungry — no food today.', 'hardship'); }
  if (next.stores.water > 0) next.stores.water -= 1; else { ate = false; say(next, 'Thirsty — no water today.', 'hardship'); }

  const w = warmth(next);
  const fed = ate ? 1 : 0.4;
  next.vitals = applyActivity(next.vitals, { hours: 8, vigorRate: 4.25 * fed, clarityRate: 5 * fed, sleep: true }, { shelterWarmth: w }).vitals;
  if (!ate) next.vitals.condition = Math.max(0, next.vitals.condition - 6);
  if (w < 0.3 && next.tier < 2) {
    next.vitals.condition = Math.max(0, next.vitals.condition - 4);
    say(next, 'A cold, broken night — the exposure bites.', 'hardship');
  }

  next.vitals = driftCapacity(next.vitals, {
    loadVigor: next.today.loadVigor,
    loadClarity: next.today.loadClarity,
    ate,
    shelterWarmth: w,
    pushedVigor: next.today.pushedVigor,
    pushedClarity: next.today.pushedClarity,
  });

  next.day += 1;
  next.hoursToday = 0;
  next.today = { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false };
  latchMilestones(next);
  return next;
}

/**
 * Run a planned queue for the rest of today: actions run in order until the
 * 14 waking hours are spent (an action started before the limit finishes),
 * then the day ends. Returns the new state and the unrun remainder, which
 * carries into tomorrow.
 */
export function runDay(s: Region1State, queue: readonly ActionId[]): { state: Region1State; remaining: ActionId[] } {
  if (s.outcome) return { state: s, remaining: [...queue] };
  let state = s;
  const remaining = [...queue];
  while (remaining.length > 0 && state.hoursToday < DAY_HOURS) {
    state = runAction(state, remaining.shift() as ActionId);
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
    canCross: crossingPrepared({ coldGear: next.coldGear, rations: next.stores.rations, vitals: next.vitals }),
    vitals: next.vitals,
  });
  next.outcome = outcome;
  next.vitals = outcome.vitals;
  say(next, `Region 1 resolved: ${choice} → ${outcome.kind}${outcome.injury ? ` (${outcome.injury})` : ''}.`, 'outcome');
  return next;
}
