/**
 * Pure action resolvers — the rules for what an action produces, separate from
 * how the player triggers it.
 *
 * Core Warden triggers a harvest by walking to a ResourceNode and pressing E;
 * the crafting sim (#1137) will trigger the same harvest from a queued menu
 * action. Both call `resolveHarvest`, so the yields balanced in one game carry
 * straight over to the other.
 *
 * Deliberately has NO Phaser imports: it runs in unit tests and in a game
 * with no world at all. Randomness comes in through `ctx.rng` — Core Warden
 * passes `Math.random`, tests and the sim pass a seeded generator so results
 * are reproducible.
 */

/** One item a resource node can drop, rolled uniformly in [min, max]. */
export interface ResourceNodeYield {
  itemId: string;
  min: number;
  max: number;
  /**
   * True for things that grow (berries, herbs, fibre): the season scales the
   * roll (#1159). Stone and ore leave this unset and ignore the season.
   */
  seasonal?: boolean;
  /**
   * Biomes this drop occurs in, from item-registry.json (#1160). Absent, or
   * containing 'any', means everywhere. Only checked when the context names
   * a biome — Core Warden doesn't yet, the sim does.
   */
  biomes?: string[];
}

/**
 * How much a seasonal yield gives per season (1 = normal). Only four keys
 * on purpose — an unknown season (or none, as Core Warden passes today)
 * counts as 1, so seasons are opt-in for whoever builds the context.
 */
export const SEASON_YIELD: Readonly<Record<string, number>> = {
  spring: 1,
  summer: 1.25,
  autumn: 1,
  winter: 0.25,
};

/** Everything an action may depend on besides its own definition. */
export interface ActionContext {
  /** Returns a float in [0, 1), like Math.random. */
  rng: () => number;
  /**
   * Scales every rolled quantity (1 = normal). The crafting sim feeds the
   * climate's harvest multiplier through here (#1153); Core Warden leaves it
   * at the default.
   */
  yieldMultiplier?: number;
  /**
   * Current season; scales yields marked `seasonal` via SEASON_YIELD (#1159).
   * The crafting sim passes WorldFeed's season; Core Warden passes nothing.
   */
  season?: string;
  /**
   * Where the harvest happens; yields whose `biomes` don't include it are
   * skipped (#1160). A settlement sits at a biome edge, so this may be a set
   * (#1164): a yield drops if it occurs in *any* of them. An empty set, like
   * no biome at all, means no filtering. The sim passes its settlement
   * biomes; Core Warden passes nothing, so every yield is available there.
   */
  biome?: string | string[];
  // Hooks for later balancing (tool/skill modifiers). Accepted now so
  // callers can start passing them; not used by any resolver yet.
  tool?: string;
  skill?: number;
}

/** What an action produced: items to add, plus human-readable log lines. */
export interface ActionOutcome {
  items: { itemId: string; qty: number }[];
  /** e.g. "+3 lumber" — the sim shows these in its text feed. */
  log: string[];
}

/**
 * Integer in [min, max], inclusive at both ends — same distribution as
 * Phaser.Math.Between, which ResourceNode used before this was extracted.
 */
function rollInclusive(min: number, max: number, rng: () => number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/**
 * Can this yield drop in any of `biome`? Unlisted yields and 'any' drop
 * everywhere; no biome (or an empty set) means the caller isn't filtering.
 */
function occursIn(y: ResourceNodeYield, biome: string | string[] | undefined): boolean {
  if (biome === undefined || !y.biomes) return true;
  // Normalise the single-string form (#1160) to a set so there's one rule.
  const here = typeof biome === 'string' ? [biome] : biome;
  if (here.length === 0) return true;
  return y.biomes.includes('any') || here.some(b => y.biomes!.includes(b));
}

/** The context's yield multiplier, times the season's scale for a seasonal yield. */
function scaleOf(y: ResourceNodeYield, ctx: Omit<Partial<ActionContext>, 'rng'>): number {
  const seasonal = (ctx.season !== undefined && SEASON_YIELD[ctx.season]) || 1;
  return (ctx.yieldMultiplier ?? 1) * (y.seasonal ? seasonal : 1);
}

/**
 * What one harvest of this yield gives on average under these conditions (#1192): the same biome
 * gate, scaling and rounding as {@link resolveHarvest}, averaged over every roll from min to max.
 * 0 when it can't drop here, or rounds to nothing — oak's 1 fibre × winter's 0.25.
 */
export function expectedHarvest(y: ResourceNodeYield, ctx: Omit<Partial<ActionContext>, 'rng'> = {}): number {
  if (!occursIn(y, ctx.biome)) return 0;
  const scale = scaleOf(y, ctx);
  let sum = 0;
  for (let roll = y.min; roll <= y.max; roll++) sum += Math.max(0, Math.round(roll * scale));
  return sum / (y.max - y.min + 1);
}

/**
 * Roll every yield once, scale by the context's yield multiplier (and, for
 * seasonal yields, by the season), and drop anything that rounds to zero —
 * a bad year or a hard winter can leave a node with nothing.
 *
 * The two multipliers stack multiplicatively and the result is rounded once
 * at the end, so 4 berries × summer 1.25 × a 0.5 climate year is
 * round(2.5) = 3, not round(round(5) × 0.5) = 3 by luck of order.
 */
export function resolveHarvest(yields: ResourceNodeYield[], ctx: ActionContext): ActionOutcome {
  const outcome: ActionOutcome = { items: [], log: [] };
  for (const y of yields) {
    // Skip before rolling so a gated yield doesn't consume an rng value —
    // keeps seeded runs identical whether or not a biome is set.
    if (!occursIn(y, ctx.biome)) continue;
    const qty = Math.max(0, Math.round(rollInclusive(y.min, y.max, ctx.rng) * scaleOf(y, ctx)));
    if (qty <= 0) continue;
    outcome.items.push({ itemId: y.itemId, qty });
    outcome.log.push(`+${qty} ${y.itemId}`);
  }
  return outcome;
}
