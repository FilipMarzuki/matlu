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
   * skipped (#1160). The sim passes its settlement biome; Core Warden passes
   * nothing, so every yield is available there.
   */
  biome?: string;
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

/** Can this yield drop in `biome`? Unlisted yields and 'any' drop everywhere. */
function occursIn(y: ResourceNodeYield, biome: string | undefined): boolean {
  if (biome === undefined || !y.biomes) return true;
  return y.biomes.includes(biome) || y.biomes.includes('any');
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
  const multiplier = ctx.yieldMultiplier ?? 1;
  const seasonal = (ctx.season !== undefined && SEASON_YIELD[ctx.season]) || 1;
  for (const y of yields) {
    // Skip before rolling so a gated yield doesn't consume an rng value —
    // keeps seeded runs identical whether or not a biome is set.
    if (!occursIn(y, ctx.biome)) continue;
    const scale = multiplier * (y.seasonal ? seasonal : 1);
    const qty = Math.max(0, Math.round(rollInclusive(y.min, y.max, ctx.rng) * scale));
    if (qty <= 0) continue;
    outcome.items.push({ itemId: y.itemId, qty });
    outcome.log.push(`+${qty} ${y.itemId}`);
  }
  return outcome;
}
