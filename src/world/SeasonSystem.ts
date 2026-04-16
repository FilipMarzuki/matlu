// src/world/SeasonSystem.ts
import * as Phaser from 'phaser';
import type { PhaseOverlay } from './WorldClock';
import type { WorldClock } from './WorldClock';
import type { GameSystem, WorldState } from './WorldState';

// ─── Season types ─────────────────────────────────────────────────────────────

export type Season = 'spring' | 'rainy' | 'summer' | 'autumn' | 'winter';

/** Snapshot of the current season state. */
export interface SeasonState {
  current: Season;
  /** 0.0–1.0 progress within the current season. */
  progress: number;
}

/** The ordered cycle of seasons — matches the rotation order in-game. */
const SEASONS: Season[] = ['spring', 'rainy', 'summer', 'autumn', 'winter'];

// ─── Season overlays ──────────────────────────────────────────────────────────

/**
 * RGBA overlay values for each season — blended with the WorldClock phase
 * overlay in GameScene to give each season a distinct visual feel.
 *
 * Palette intent:
 *   spring → fresh green warmth
 *   rainy  → cool slate blue
 *   summer → warm golden yellow (strongest warmth signal)
 *   autumn → deep amber-orange
 *   winter → icy cool blue (strongest cool signal)
 *
 * The summer/winter contrast is the primary visible tell that the season
 * system is working: summer shifts the overlay warm, winter shifts it cold.
 */
export const SEASON_OVERLAYS: Record<Season, PhaseOverlay> = {
  spring: { r: 0x88, g: 0xff, b: 0x88, alpha: 0.05 },
  rainy:  { r: 0x44, g: 0x66, b: 0x99, alpha: 0.10 },
  summer: { r: 0xff, g: 0xcc, b: 0x44, alpha: 0.08 },
  autumn: { r: 0xff, g: 0x77, b: 0x22, alpha: 0.10 },
  winter: { r: 0x88, g: 0xbb, b: 0xff, alpha: 0.20 },
};

// ─── biomeSeasonConfig ────────────────────────────────────────────────────────

/**
 * Per-biome season palette tint map — hex color per biome × season combination.
 *
 * Other systems (tilemap renderer, particle system) call
 * `SeasonSystem.getSeasonModifier(biome, season)` to look up the correct
 * palette tint for a given tile location. These are the full target colors,
 * not deltas — lerp from the base tile color toward this value by `progress`.
 *
 * Biome keys match the biome labels used in GameScene (`BIOME_LABELS`):
 *   forest, plains, swamp, mountain
 */
export const biomeSeasonConfig: Record<string, Record<Season, number>> = {
  forest: {
    spring: 0x88ff88, // vibrant new growth
    rainy:  0x6688aa, // cool misty greens
    summer: 0xffee66, // dappled golden canopy
    autumn: 0xff8833, // fallen leaves, warm amber
    winter: 0xaabbff, // snow-covered, cool blue
  },
  plains: {
    spring: 0xaaffaa, // lush green, overgrown
    rainy:  0x88aacc, // grey-blue overcast
    summer: 0xffdd44, // golden dry grass
    autumn: 0xddcc44, // yellowed stalks
    winter: 0xccddff, // barren, icy grey-blue
  },
  swamp: {
    spring: 0x66cc88, // algae bloom, murky green
    rainy:  0x446688, // flooded, dark grey-blue
    summer: 0x88cc44, // humid, overgrown
    autumn: 0x778855, // slight cooling, olive
    winter: 0x8899bb, // frozen surface, slate
  },
  mountain: {
    spring: 0x99ccaa, // alpine meadow melt
    rainy:  0x6677aa, // overcast rockface
    summer: 0xeecc55, // warm exposed rock
    autumn: 0xaa9966, // bare rock, unchanged mostly
    winter: 0x99bbee, // blizzard blue-white
  },
};

// ─── SeasonSystem ─────────────────────────────────────────────────────────────

/**
 * SeasonSystem — layers seasonal state on top of the WorldClock day/night cycle.
 *
 * Seasons don't change what a biome *is* — they change how it looks, sounds,
 * and behaves. Progression is driven by `WorldClock.dayCount`: every N in-game
 * days (default 3), `progress` advances and the season eventually rotates.
 *
 * Season progress is derived from `dayCount % daysPerSeason` rather than
 * accumulated real time, so it stays correct even when `skipToPhase()` or
 * fast-forward testing jumps the clock forward.
 *
 * ## Events emitted on `scene.events`
 *
 * | Event                | Payload                                   |
 * |----------------------|-------------------------------------------|
 * | `ws:season-changed`  | `{ previous: Season, current: Season }`   |
 * | `ws:season-progress` | `{ season: Season, progress: number }`    |
 *
 * ## Corruption integration
 * Zones with corruption level > 0.5 have their season locked to `'winter'`.
 * Use `getEffectiveSeason(zoneId)` to get the corruption-adjusted season.
 * Cleansed zones cycle naturally — a visual reward for the player.
 *
 * // TODO: subscribe MusicSystem to ws:season-changed once FIL-179 MusicSystem exists
 */
export class SeasonSystem implements GameSystem {
  readonly systemId = 'season';

  private readonly scene: Phaser.Scene;
  private readonly clock: WorldClock;
  private readonly worldState: WorldState;

  /** Number of in-game days before the season advances. Default: 3. */
  private readonly daysPerSeason: number;

  private _current: Season = 'spring';
  private _progress: number = 0;

  /** Last observed dayCount — used to detect day boundaries without accumulating time. */
  private _lastDayCount: number = -1;

  constructor(
    scene: Phaser.Scene,
    clock: WorldClock,
    worldState: WorldState,
    options: { daysPerSeason?: number } = {},
  ) {
    this.scene = scene;
    this.clock = clock;
    this.worldState = worldState;
    this.daysPerSeason = options.daysPerSeason ?? 3;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Current global season. */
  get currentSeason(): Season {
    return this._current;
  }

  /** Progress through the current season (0.0–1.0). */
  get seasonProgress(): number {
    return this._progress;
  }

  /**
   * RGBA overlay for the current season.
   * GameScene blends this with the WorldClock phase overlay before applying
   * to the camera's day/night graphics object.
   */
  get seasonOverlay(): PhaseOverlay {
    return SEASON_OVERLAYS[this._current];
  }

  /**
   * Returns the effective season for `zoneId`, accounting for corruption.
   * Zones with corruption level > 0.5 are locked to `'winter'` —
   * distorted or frozen seasons are a visual/mechanical tell for corrupted areas.
   * Fully cleansed zones cycle through seasons normally.
   */
  getEffectiveSeason(zoneId: string): Season {
    if ((this.worldState.getCorruption(zoneId)?.level ?? 0) > 0.5) {
      return 'winter';
    }
    return this._current;
  }

  /**
   * Returns the RGBA overlay for the effective season of `zoneId`.
   * Convenience wrapper used by GameScene to compute the blended camera tint.
   */
  getEffectiveSeasonOverlay(zoneId: string): PhaseOverlay {
    return SEASON_OVERLAYS[this.getEffectiveSeason(zoneId)];
  }

  /**
   * Returns the palette tint hex color for a biome + season combination.
   * Other systems (tilemap renderer, particle system) call this to look up
   * the correct per-tile color shift for the given season.
   *
   * Returns `0x888888` (neutral grey) for unknown biome/season combinations.
   */
  getSeasonModifier(biome: string, season: Season): number {
    return biomeSeasonConfig[biome]?.[season] ?? 0x888888;
  }

  // ─── GameSystem ──────────────────────────────────────────────────────────────

  /**
   * Called once per frame by `WorldState.update()`.
   *
   * Advances season state based on `WorldClock.dayCount`. Only recalculates
   * when the day count changes (once per in-game day), so the per-frame cost
   * is a single integer comparison.
   *
   * Season index = Math.floor(dayCount / daysPerSeason) % SEASONS.length
   * Season progress = (dayCount % daysPerSeason) / daysPerSeason
   */
  update(_delta: number): void {
    const dayCount = this.clock.dayCount;
    // Only recalculate when a new day has started.
    if (dayCount === this._lastDayCount) return;
    this._lastDayCount = dayCount;

    const totalSeasonDays = SEASONS.length * this.daysPerSeason;
    const seasonIdx = Math.floor((dayCount % totalSeasonDays) / this.daysPerSeason);
    // SEASONS array is fixed-length non-empty — seasonIdx is always a valid index.
    const newSeason = SEASONS[seasonIdx] ?? 'spring';
    const newProgress = (dayCount % this.daysPerSeason) / this.daysPerSeason;

    if (newSeason !== this._current) {
      const previous = this._current;
      this._current = newSeason;
      // Emit season change event — subscribers (future MusicSystem, particle
      // system, etc.) can react without coupling to SeasonSystem directly.
      this.scene.events.emit('ws:season-changed', { previous, current: newSeason });
    }

    this._progress = newProgress;
    this.scene.events.emit('ws:season-progress', { season: this._current, progress: newProgress });
  }
}
