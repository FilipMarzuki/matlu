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
}

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
  // Hooks for later balancing (season/biome/tool/skill modifiers). Accepted
  // now so callers can start passing them; not used by any resolver yet.
  season?: string;
  biome?: string;
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
 * Roll every yield once, scale by the context's yield multiplier, and drop
 * anything that rounds to zero (a bad year can leave a node with nothing).
 */
export function resolveHarvest(yields: ResourceNodeYield[], ctx: ActionContext): ActionOutcome {
  const outcome: ActionOutcome = { items: [], log: [] };
  const multiplier = ctx.yieldMultiplier ?? 1;
  for (const y of yields) {
    const qty = Math.max(0, Math.round(rollInclusive(y.min, y.max, ctx.rng) * multiplier));
    if (qty <= 0) continue;
    outcome.items.push({ itemId: y.itemId, qty });
    outcome.log.push(`+${qty} ${y.itemId}`);
  }
  return outcome;
}
