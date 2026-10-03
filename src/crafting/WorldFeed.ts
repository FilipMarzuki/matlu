import type { World } from '../../storytelling/world.js';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export interface WorldFeedDeps { world: World; ticksPerYear?: number }

export class WorldFeed {
  constructor(_deps: WorldFeedDeps) {}
  advance(_ticks: number): void { throw new Error('not implemented'); }
  get season(): Season { throw new Error('not implemented'); }
  get yieldMultiplier(): number { throw new Error('not implemented'); }
  get year(): number { throw new Error('not implemented'); }
  drainEvents(): string[] { throw new Error('not implemented'); }
}
