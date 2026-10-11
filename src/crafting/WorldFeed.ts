/**
 * WorldFeed — the bridge between the crafting sim's ticks and the storytelling
 * engine's years (#1153).
 *
 * The engine (`storytelling/`) simulates a whole year per `tick(world)` call
 * and records what happened in `world.events`. The sim ticks in days. This
 * adapter counts sim ticks, calls the engine once per `ticksPerYear`, and
 * exposes three things the sim cares about:
 *
 *  - `season`          — which quarter of the year we're in
 *  - `yieldMultiplier` — the climate's effect on harvests this year
 *  - `drainEvents()`   — new engine events as prose, for the log feed
 *
 * Pure TypeScript: no Phaser, no browser, no clock. Only the engine modules
 * with no Node dependencies are imported (never `main.ts` or `persist.ts`).
 */

import { tick } from '../../storytelling/tick.js';
import { climateHarvestMultiplier } from '../../storytelling/climate.js';
import { renderEvent } from '../../storytelling/render.js';
import type { World } from '../../storytelling/world.js';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];

/** Default: one sim tick is a day. */
export const DEFAULT_TICKS_PER_YEAR = 365;
/** Most engine events surfaced per drain, so a busy year can't flood the feed. */
export const MAX_EVENTS_PER_DRAIN = 5;

export interface WorldFeedDeps {
  world: World;
  ticksPerYear?: number;
}

export class WorldFeed {
  private readonly world: World;
  private readonly ticksPerYear: number;
  /** Ticks elapsed in the current engine year (0 ≤ tickInYear < ticksPerYear). */
  private tickInYear = 0;
  /** Index into world.events up to which events have already been drained. */
  private drained: number;

  constructor(deps: WorldFeedDeps) {
    this.world = deps.world;
    this.ticksPerYear = Math.max(4, Math.floor(deps.ticksPerYear ?? DEFAULT_TICKS_PER_YEAR));
    // Anything already in the log (e.g. prehistory) is backstory, not news.
    this.drained = this.world.events.length;
  }

  /** Current engine year. */
  get year(): number {
    return this.world.year;
  }

  /** Quarter of the year: tick 0 is the first day of spring. */
  get season(): Season {
    const quarter = Math.floor(this.ticksPerYear / 4);
    return SEASONS[Math.min(3, Math.floor(this.tickInYear / quarter))];
  }

  /** Climate effect on harvests this year (1 = normal). */
  get yieldMultiplier(): number {
    return climateHarvestMultiplier(this.world);
  }

  /**
   * Advance the sim by `ticks`. Each time a year's worth of ticks has
   * accumulated the engine ticks once, so a big jump can tick several years.
   */
  advance(ticks: number): void {
    if (ticks <= 0) return;
    this.tickInYear += ticks;
    while (this.tickInYear >= this.ticksPerYear) {
      this.tickInYear -= this.ticksPerYear;
      tick(this.world);
    }
  }

  /**
   * Engine events since the last drain, rendered as chronicle prose.
   * Returns at most MAX_EVENTS_PER_DRAIN lines; the rest of that batch is
   * dropped (a feed, not an archive) — the full log stays in `world.events`.
   */
  drainEvents(): string[] {
    const fresh = this.world.events.slice(this.drained, this.drained + MAX_EVENTS_PER_DRAIN);
    this.drained = this.world.events.length;
    return fresh
      .map(ev => renderEvent(this.world, ev))
      // Events without a prose template render as "[EVENT_TYPE]" — not news.
      .filter(line => line.trim().length > 0 && !/^\[[A-Z0-9_]+\]$/.test(line.trim()));
  }
}
