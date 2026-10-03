/**
 * Pure action resolvers shared by Core Warden and the crafting sim (#1135).
 * No Phaser imports — see actions.test.ts.
 */

export interface ResourceNodeYield {
  itemId: string;
  min: number;
  max: number;
}

export interface ActionContext {
  rng: () => number;
  season?: string;
  biome?: string;
  tool?: string;
  skill?: number;
}

export interface ActionOutcome {
  items: { itemId: string; qty: number }[];
  log: string[];
}

export function resolveHarvest(_yields: ResourceNodeYield[], _ctx: ActionContext): ActionOutcome {
  throw new Error('not implemented');
}
