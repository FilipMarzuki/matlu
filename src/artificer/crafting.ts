/**
 * Crafting & tools — the artificer's core loop (#1211).
 *
 * Part of the artificer sim core: pure, deterministic, no Phaser, no
 * randomness. Implements docs/crafting-tools-design.md on top of the real
 * registries in public/macro-world/ (recipes.json, concepts.json):
 *
 *   - **Grades** (crude → masterwork) scale what a crafted item does.
 *   - **Effects** live on items: cheaper / faster actions, bigger yields,
 *     higher pool caps, or capabilities you otherwise lack.
 *   - **Crafting is an action** — it spends hours, Clarity and some Vigor,
 *     and its grade comes from your mind, your bench, your tools and your
 *     knowledge. Overreach fails and wastes inputs; salvage softens that.
 *   - **Concepts** rank up through insight — a drip from every craft (more
 *     from better work) plus focused study that spends Clarity.
 *
 * The through-line: you craft to make acting cheaper, richer or possible, and
 * better tools lower the tax of the very work that made them.
 */

import { applyActivity, type Vitals } from './vitality';

// ── Grades ──────────────────────────────────────────────────────────────────

export type Grade = 'crude' | 'sound' | 'fine' | 'masterwork';
export const GRADES: readonly Grade[] = ['crude', 'sound', 'fine', 'masterwork'];
/** How strongly an item's effects apply at each grade (sound = as written). */
export const GRADE_MULT: Readonly<Record<Grade, number>> = { crude: 0.5, sound: 1, fine: 1.5, masterwork: 2.2 };

const gradeIndex = (g: Grade): number => GRADES.indexOf(g);

// ── Registry shapes ─────────────────────────────────────────────────────────

export interface Stack { item: string; qty: number }

/** The fields of a recipes.json entry the sim reads. */
export interface CraftRecipe {
  id: string;
  name: string;
  inputs: Stack[];
  output: Stack;
  /** 0 field · 1 camp/workbench · 2 station · 3 master · 4–5 beyond. */
  tier: number;
  /** A named station the craft needs (campfire, smithy…), or null. */
  station: string | null;
  /** Base hours at the bench. */
  timeBase: number;
  /** Principles the craft uses — and teaches. */
  concepts?: string[];
  /** Explicit concept-rank gate, overriding the default tier rule. */
  conceptRequires?: Record<string, number>;
  /**
   * Per-hour pull on the pools while crafting (negative = drain). Defaults to
   * bench work — light on Vigor, heavier on Clarity; heavy builds override it.
   */
  effort?: { vigorRate: number; clarityRate: number };
}

/** The fields of a concepts.json entry the sim reads. */
export interface ConceptDef {
  id: string;
  /** Highest rank this concept has. */
  ranks: number;
  /** Prerequisites as "concept:rank" strings, e.g. "friction:1". */
  requires?: string[];
}

/**
 * Pick recipes out of recipes.json's array, skipping its `{ "_tier": "=== … ===" }`
 * section dividers (and anything else without the fields a recipe needs).
 */
export function recipesFromRegistry(raw: readonly unknown[]): CraftRecipe[] {
  const out: CraftRecipe[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.tier !== 'number' || !Array.isArray(o.inputs) || typeof o.output !== 'object') continue;
    out.push({
      id: o.id,
      name: typeof o.name === 'string' ? o.name : o.id,
      inputs: o.inputs as Stack[],
      output: o.output as Stack,
      tier: o.tier,
      station: typeof o.station === 'string' ? o.station : null,
      timeBase: typeof o.timeBase === 'number' ? o.timeBase : 1,
      concepts: Array.isArray(o.concepts) ? (o.concepts as string[]) : undefined,
      conceptRequires: typeof o.conceptRequires === 'object' && o.conceptRequires !== null ? (o.conceptRequires as Record<string, number>) : undefined,
    });
  }
  return out;
}

// ── Item effects ────────────────────────────────────────────────────────────

export type CostPool = 'vigor' | 'clarity' | 'time';

/** What owning an item does for you, written at *sound* grade. */
export interface ItemEffects {
  /** Make an action cheaper: `mult` < 1 (0.7 = 30% off that pool). */
  actionCost?: { action: string; pool: CostPool; mult: number }[];
  /** Make an action return more. */
  yield?: { action: string; add: number }[];
  /** Raise a pool's ceiling. */
  cap?: { pool: 'vigor' | 'clarity'; add: number }[];
  /** Capabilities you simply don't have without it (never scaled by grade). */
  unlock?: string[];
  /** How much this helps at the bench itself (feeds the quality model). */
  craftBonus?: number;
}

/** An owned, graded item that has effects. */
export interface Tool {
  item: string;
  grade: Grade;
  /** The grade it was made at, once wear can take it below (#1245, #1286): tending brings it back up. */
  crafted?: Grade;
  /** Left by an earlier Warden (#1455): an heirloom, not something this one made or packed. */
  heirloom?: boolean;
}

/**
 * Starter effects for Region 1's tier-0/1 craftables, keyed by registry item
 * id (a test keeps these honest against recipes.json). Action ids are Region
 * 1's; `sleep` and `craft` are the other activities effects can touch.
 */
export const DEFAULT_EFFECTS: Readonly<Record<string, ItemEffects>> = {
  'stone-knife': { actionCost: [{ action: 'hunt', pool: 'vigor', mult: 0.85 }, { action: 'preserve', pool: 'time', mult: 0.85 }], craftBonus: 1 },
  'skinning-knife': { actionCost: [{ action: 'preserve', pool: 'clarity', mult: 0.8 }], yield: [{ action: 'hunt', add: 2 }], craftBonus: 1 },
  'trap-snare': { yield: [{ action: 'gather', add: 1 }], unlock: ['snare-line'] },
  'waterskin': { yield: [{ action: 'water', add: 1 }], unlock: ['carry-water'] },
  // A bedroll is a better night's sleep: extra Clarity recovered overnight.
  'bedroll': { yield: [{ action: 'sleep', add: 6 }] },
  'crude-shovel': { actionCost: [{ action: 'build', pool: 'vigor', mult: 0.8 }] },
  'fishing-rod': { yield: [{ action: 'gather', add: 1 }], unlock: ['fish'] },
  'pouch': { actionCost: [{ action: 'gather', pool: 'time', mult: 0.9 }] },
};

/** Cost multipliers never go below this — a tool helps, it doesn't make work free. */
export const COST_FLOOR = 0.1;

/** A grade scales the *saving*: a sound 0.7 axe saves 30%, a masterwork one 66%. */
export function scaledMult(mult: number, grade: Grade): number {
  return Math.max(COST_FLOOR, Math.min(1, 1 - (1 - mult) * GRADE_MULT[grade]));
}

/** Tools as the journal and the intro name them (#1455): "a fine stone-knife, a crude bedroll". */
export const heirloomList = (tools: readonly Tool[]): string => tools.map(t => `a ${t.grade} ${t.item}`).join(', ');

/** You only swing one axe: keep the best-graded copy of each item. */
export function bestPerItem(tools: readonly Tool[]): Tool[] {
  const best = new Map<string, Tool>();
  for (const t of tools) {
    const have = best.get(t.item);
    if (!have || gradeIndex(t.grade) > gradeIndex(have.grade)) best.set(t.item, t);
  }
  return [...best.values()];
}

export interface ActionModifiers {
  vigorMult: number;
  clarityMult: number;
  timeMult: number;
  yieldAdd: number;
}

/**
 * How your tools change one action. Different items stack (multiplicatively
 * for costs, additively for yields); duplicates of one item don't.
 */
export function modifiersFor(tools: readonly Tool[], action: string, effects: Readonly<Record<string, ItemEffects>> = DEFAULT_EFFECTS): ActionModifiers {
  const m = { vigor: 1, clarity: 1, time: 1 };
  let yieldAdd = 0;
  for (const t of bestPerItem(tools)) {
    const e = effects[t.item];
    for (const c of e?.actionCost ?? []) if (c.action === action) m[c.pool] *= scaledMult(c.mult, t.grade);
    for (const y of e?.yield ?? []) if (y.action === action) yieldAdd += Math.round(y.add * GRADE_MULT[t.grade]);
  }
  return {
    vigorMult: Math.max(COST_FLOOR, m.vigor),
    clarityMult: Math.max(COST_FLOOR, m.clarity),
    timeMult: Math.max(COST_FLOOR, m.time),
    yieldAdd,
  };
}

/** Total pool-cap bonus from your tools (grade-scaled, rounded). */
export function capBonus(tools: readonly Tool[], pool: 'vigor' | 'clarity', effects: Readonly<Record<string, ItemEffects>> = DEFAULT_EFFECTS): number {
  let add = 0;
  for (const t of bestPerItem(tools)) for (const c of effects[t.item]?.cap ?? []) if (c.pool === pool) add += Math.round(c.add * GRADE_MULT[t.grade]);
  return add;
}

/** Every capability your tools grant. A crude waterskin still carries water. */
export function capabilities(tools: readonly Tool[], effects: Readonly<Record<string, ItemEffects>> = DEFAULT_EFFECTS): Set<string> {
  const out = new Set<string>();
  for (const t of tools) for (const u of effects[t.item]?.unlock ?? []) out.add(u);
  return out;
}

/** Best tool help at the bench, 0..2. */
export function toolBonus(tools: readonly Tool[], effects: Readonly<Record<string, ItemEffects>> = DEFAULT_EFFECTS): number {
  let best = 0;
  for (const t of tools) best = Math.max(best, Math.round((effects[t.item]?.craftBonus ?? 0) * GRADE_MULT[t.grade]));
  return Math.min(2, best);
}

// ── The quality model ───────────────────────────────────────────────────────

/** How clear your head is at the bench: 0 frayed · 1 tired · 2 steady · 3 sharp. */
export function clarityBand(v: Vitals): number {
  const fill = v.clarity.cap > 0 ? v.clarity.current / v.clarity.cap : 0;
  return fill >= 0.75 ? 3 : fill >= 0.5 ? 2 : fill >= 0.25 ? 1 : 0;
}

/** The best grade each bench tier can produce: the field caps at sound. */
export const BENCH_GRADE_CAP: readonly Grade[] = ['sound', 'fine', 'masterwork', 'masterwork'];

export interface QualityInput {
  /** {@link clarityBand}, 0..3. */
  band: number;
  /** Your bench tier, 0..3. */
  benchTier: number;
  /** {@link toolBonus}, 0..2. */
  tools: number;
  /** Mean rank across the recipe's concepts, 0..3 — may be fractional for multi-concept recipes. */
  conceptRank: number;
  /** The recipe's tier; anything past tier 1 is harder. */
  recipeTier: number;
}

/**
 * Resolve a craft to a grade, or `null` for a failure (the work was beyond
 * you right now). Additive and deliberately simple so it's easy to tune:
 * a sharp mind in the field makes *sound* work; the masterwork rung needs a
 * real station plus most of the other factors maxed.
 */
export function craftGrade(q: QualityInput): Grade | null {
  const score = q.band + q.benchTier + q.tools + q.conceptRank - Math.max(0, q.recipeTier - 1);
  if (score <= 0) return null;
  const raw: Grade = score >= 9 ? 'masterwork' : score >= 6 ? 'fine' : score >= 3 ? 'sound' : 'crude';
  const cap = BENCH_GRADE_CAP[Math.min(BENCH_GRADE_CAP.length - 1, Math.max(0, q.benchTier))];
  return gradeIndex(raw) > gradeIndex(cap) ? cap : raw;
}

/** Fraction of inputs recovered from a failed craft (never all of them). */
export function salvageFraction(conceptRank: number, bonus = 0): number {
  return Math.min(0.75, Math.max(0, 0.15 * conceptRank + bonus));
}

/** What you get back from a failed craft: floor(qty × fraction) of each input. */
export function salvage(inputs: readonly Stack[], fraction: number): Stack[] {
  return inputs.map(s => ({ item: s.item, qty: Math.floor(s.qty * fraction) })).filter(s => s.qty > 0);
}

// ── Concepts & insight ──────────────────────────────────────────────────────

export interface ConceptProgress { rank: number; insight: number }

/** Insight needed to go from rank r to r+1 — each rank dearer than the last. */
export const INSIGHT_TO_NEXT: readonly number[] = [6, 15, 30, 50, 80];
/** Insight a sound craft drips into each of its concepts (scaled by grade). */
export const CRAFT_DRIP = 2;
/** Even a failure teaches what doesn't work. */
export const FAIL_DRIP = 1;
/** A focused study session's insight, before the day's diminishing return. */
export const STUDY_INSIGHT = 8;
export const STUDY_HOURS = 3;

const rankOf = (concepts: Readonly<Record<string, ConceptProgress>>, id: string): number => concepts[id]?.rank ?? 0;

/** Are a concept's prerequisites met? (Unknown concepts are treated as open.) */
export function conceptOpen(concepts: Readonly<Record<string, ConceptProgress>>, def: ConceptDef | undefined): boolean {
  return (def?.requires ?? []).every(req => {
    const [id, r] = req.split(':');
    return rankOf(concepts, id) >= Number(r ?? 1);
  });
}

/**
 * Add insight to one concept (on an already-cloned map), ranking up through as
 * many thresholds as it covers. Locked or maxed concepts gain nothing.
 */
export function addInsight(concepts: Record<string, ConceptProgress>, id: string, amount: number, defs: Readonly<Record<string, ConceptDef>>): void {
  const def = defs[id];
  const maxRank = def?.ranks ?? 3;
  if (!conceptOpen(concepts, def)) return;
  const p = { ...(concepts[id] ?? { rank: 0, insight: 0 }) };
  if (p.rank >= maxRank) return;
  p.insight += amount;
  while (p.rank < maxRank && p.insight >= INSIGHT_TO_NEXT[Math.min(p.rank, INSIGHT_TO_NEXT.length - 1)]) {
    p.insight -= INSIGHT_TO_NEXT[Math.min(p.rank, INSIGHT_TO_NEXT.length - 1)];
    p.rank += 1;
  }
  if (p.rank >= maxRank) p.insight = 0;
  concepts[id] = p;
}

// ── Crafter state ───────────────────────────────────────────────────────────

export interface Bench {
  /** 0 field · 1 camp · 2 station · 3 master. */
  tier: number;
  /** Named stations you've built (campfire, kiln…). */
  stations: string[];
}

export interface CrafterState {
  vitals: Vitals;
  /** Plain materials and products by item id. */
  inventory: Record<string, number>;
  /** Owned items that carry effects. */
  tools: Tool[];
  concepts: Record<string, ConceptProgress>;
  bench: Bench;
  /** Study sessions per concept today (reset with {@link newCraftDay}). */
  studiedToday: Record<string, number>;
  /** Salvage from traits/abilities ("careful hands"), added to the concept part. */
  salvageBonus: number;
  /** The crafter's skill in this craft's field, added to the grade score (#1236). */
  skillBonus?: number;
}

/** The data the craft rules look things up in. Defaults suit Region 1. */
export interface CraftWorld {
  effects: Readonly<Record<string, ItemEffects>>;
  concepts: Readonly<Record<string, ConceptDef>>;
  /** Items that become named stations when crafted (e.g. every recipe.station value). */
  stationItems: ReadonlySet<string>;
  /** Items that raise the bench to at least this tier (a campfire or lean-to makes a camp). */
  benchItems: Readonly<Record<string, number>>;
}

export function craftWorld(recipes: readonly CraftRecipe[] = [], concepts: readonly ConceptDef[] = [], effects: Readonly<Record<string, ItemEffects>> = DEFAULT_EFFECTS): CraftWorld {
  return {
    effects,
    concepts: Object.fromEntries(concepts.map(c => [c.id, c])),
    stationItems: new Set(recipes.map(r => r.station).filter((s): s is string => s !== null)),
    benchItems: { campfire: 1, 'lean-to': 1 },
  };
}

export function createCrafter(vitals: Vitals, init: Partial<Omit<CrafterState, 'vitals'>> = {}): CrafterState {
  return {
    vitals,
    inventory: init.inventory ?? {},
    tools: init.tools ?? [],
    concepts: init.concepts ?? {},
    bench: init.bench ?? { tier: 0, stations: [] },
    studiedToday: init.studiedToday ?? {},
    salvageBonus: init.salvageBonus ?? 0,
  };
}

function clone(s: CrafterState): CrafterState {
  return {
    ...s,
    vitals: { vigor: { ...s.vitals.vigor }, clarity: { ...s.vitals.clarity }, condition: s.vitals.condition },
    inventory: { ...s.inventory },
    tools: [...s.tools],
    concepts: { ...s.concepts },
    bench: { tier: s.bench.tier, stations: [...s.bench.stations] },
    studiedToday: { ...s.studiedToday },
  };
}

/** Best rank among a recipe's concepts (0 if it has none you know). */
export function bestConceptRank(s: CrafterState, recipe: CraftRecipe): number {
  return Math.max(0, ...(recipe.concepts ?? []).map(c => rankOf(s.concepts, c)));
}

/** Mean rank across a recipe's concepts (0 if it has none): mastery means knowing all of them, not just one. */
export function meanConceptRank(s: CrafterState, recipe: CraftRecipe): number {
  const concepts = recipe.concepts ?? [];
  if (concepts.length === 0) return 0;
  return concepts.reduce((sum, c) => sum + rankOf(s.concepts, c), 0) / concepts.length;
}

/**
 * Why this recipe can't be attempted right now, or null if it can. Refusals
 * are free — nothing is spent. Concept gate: the recipe's explicit
 * `conceptRequires` if it has one, else (from tier 2 up) a rank of tier−1 in
 * at least one of its concepts.
 */
export function craftBlocker(s: CrafterState, recipe: CraftRecipe): string | null {
  if (recipe.tier > s.bench.tier) return `needs a tier-${recipe.tier} bench (yours is tier ${s.bench.tier})`;
  if (recipe.station && !s.bench.stations.includes(recipe.station)) return `needs a ${recipe.station}`;
  if (recipe.conceptRequires) {
    for (const [c, r] of Object.entries(recipe.conceptRequires)) if (rankOf(s.concepts, c) < r) return `needs ${c} rank ${r}`;
  } else if (recipe.tier >= 2 && recipe.concepts?.length && bestConceptRank(s, recipe) < recipe.tier - 1) {
    return `needs rank ${recipe.tier - 1} in ${recipe.concepts.join(' or ')}`;
  }
  for (const i of recipe.inputs) {
    const have = s.inventory[i.item] ?? 0;
    if (have < i.qty) return `needs ${i.qty} ${i.item} (have ${have})`;
  }
  return null;
}

export type CraftResult =
  | { kind: 'crafted'; grade: Grade; output: Stack }
  | { kind: 'failed'; salvaged: Stack[] }
  | { kind: 'refused'; reason: string };

/** Per-hour Clarity drain at the bench: fine work is mental work. */
const craftClarityRate = (tier: number): number => -(3 + tier);
const CRAFT_VIGOR_RATE = -1.5;

/**
 * Attempt a craft (pure). The grade is judged on how you *arrive* at the
 * bench; then the session's hours drain you. Success consumes inputs and
 * yields the output — as a graded tool if it has effects, a station or a bench
 * upgrade if it is one, or plain inventory. Failure consumes inputs and gives
 * back only the salvage. Either way the recipe's concepts gain insight.
 */
export function craft(s: CrafterState, recipe: CraftRecipe, world: CraftWorld = craftWorld()): { state: CrafterState; result: CraftResult } {
  const reason = craftBlocker(s, recipe);
  if (reason) return { state: s, result: { kind: 'refused', reason } };

  const next = clone(s);
  const rank = meanConceptRank(s, recipe);
  const grade = craftGrade({ band: clarityBand(s.vitals), benchTier: s.bench.tier, tools: toolBonus(s.tools, world.effects) + (s.skillBonus ?? 0), conceptRank: rank, recipeTier: recipe.tier });

  // The session's cost — your tools can make bench work itself cheaper.
  const mod = modifiersFor(s.tools, 'craft', world.effects);
  next.vitals = applyActivity(next.vitals, {
    hours: recipe.timeBase * mod.timeMult,
    vigorRate: (recipe.effort?.vigorRate ?? CRAFT_VIGOR_RATE) * mod.vigorMult,
    clarityRate: (recipe.effort?.clarityRate ?? craftClarityRate(recipe.tier)) * mod.clarityMult,
  }).vitals;

  for (const i of recipe.inputs) next.inventory[i.item] = (next.inventory[i.item] ?? 0) - i.qty;

  let result: CraftResult;
  if (grade === null) {
    const salvaged = salvage(recipe.inputs, salvageFraction(rank, s.salvageBonus));
    for (const b of salvaged) next.inventory[b.item] = (next.inventory[b.item] ?? 0) + b.qty;
    result = { kind: 'failed', salvaged };
  } else {
    const out = recipe.output;
    if (world.effects[out.item]) {
      for (let n = 0; n < out.qty; n++) next.tools.push({ item: out.item, grade });
    } else {
      next.inventory[out.item] = (next.inventory[out.item] ?? 0) + out.qty;
    }
    if (world.stationItems.has(out.item) && !next.bench.stations.includes(out.item)) next.bench.stations.push(out.item);
    const benchTo = world.benchItems[out.item];
    if (benchTo !== undefined) next.bench.tier = Math.max(next.bench.tier, benchTo);
    result = { kind: 'crafted', grade, output: { ...out } };
  }

  // Learning by doing: better work teaches more.
  const drip = grade === null ? FAIL_DRIP : CRAFT_DRIP * GRADE_MULT[grade];
  for (const c of recipe.concepts ?? []) addInsight(next.concepts, c, drip, world.concepts);

  // Drop emptied stacks so the inventory stays tidy.
  for (const k of Object.keys(next.inventory)) if (next.inventory[k] <= 0) delete next.inventory[k];
  return { state: next, result };
}

/** Clarity a study session costs: about a third of a full pool. */
export const studyCost = (v: Vitals): number => v.clarity.cap / 3;

/**
 * Focus on a concept: spend ~⅓ of your Clarity pool for a big insight gain.
 * Each extra session on the same concept today teaches less (a saturated
 * mind). Refused — at no cost — if you lack the Clarity, or the concept is
 * locked or already mastered.
 */
export function study(s: CrafterState, conceptId: string, world: CraftWorld = craftWorld()): { state: CrafterState; gained: number; reason?: string } {
  const def = world.concepts[conceptId];
  if (!conceptOpen(s.concepts, def)) return { state: s, gained: 0, reason: `${conceptId} needs ${def?.requires?.join(', ')}` };
  if (rankOf(s.concepts, conceptId) >= (def?.ranks ?? 3)) return { state: s, gained: 0, reason: `${conceptId} is mastered` };
  const cost = studyCost(s.vitals);
  if (s.vitals.clarity.current < cost) return { state: s, gained: 0, reason: 'too foggy to study' };

  const next = clone(s);
  next.vitals = applyActivity(next.vitals, { hours: STUDY_HOURS, clarityFlat: -cost }).vitals;
  const sessions = next.studiedToday[conceptId] ?? 0;
  const gained = STUDY_INSIGHT / (1 + sessions);
  next.studiedToday[conceptId] = sessions + 1;
  addInsight(next.concepts, conceptId, gained, world.concepts);
  return { state: next, gained };
}

/** A new day: the mind is fresh for study again. */
export function newCraftDay(s: CrafterState): CrafterState {
  return { ...clone(s), studiedToday: {} };
}

// ── Accidents (#1286) ───────────────────────────────────────────────────────

/**
 * The tool a piece of work leans on: the best-graded item whose effects serve the action (for
 * `craft`, one that helps at the bench). Null when the work uses none.
 */
export function toolInUse(tools: readonly Tool[], action: string, effects: Readonly<Record<string, ItemEffects>> = DEFAULT_EFFECTS): Tool | null {
  const used = bestPerItem(tools).filter(t => {
    const e = effects[t.item];
    if (!e) return false;
    if (action === 'craft') return (e.craftBonus ?? 0) > 0;
    return (e.actionCost ?? []).some(c => c.action === action) || (e.yield ?? []).some(y => y.action === action);
  });
  return used.sort((a, b) => gradeIndex(b.grade) - gradeIndex(a.grade))[0] ?? null;
}

/** A tool knocked about in an accident: the best copy of `item` drops one grade, and a crude one breaks. */
export function damageTool(tools: readonly Tool[], item: string): { tools: Tool[]; broke: boolean; grade: Grade | null } {
  const best = bestPerItem(tools).find(t => t.item === item);
  if (!best) return { tools: [...tools], broke: false, grade: null };
  const i = tools.indexOf(best);
  if (best.grade === 'crude') return { tools: tools.filter((_, j) => j !== i), broke: true, grade: null };
  const grade = GRADES[gradeIndex(best.grade) - 1];
  return { tools: tools.map((t, j) => (j === i ? { ...t, grade } : t)), broke: false, grade };
}
