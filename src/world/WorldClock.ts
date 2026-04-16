// src/world/WorldClock.ts

export type DayPhase =
  | 'dawn'
  | 'morning'
  | 'midday'
  | 'afternoon'
  | 'dusk'
  | 'night';

/** RGBA overlay values for each phase — applied as a full-screen tint. */
export interface PhaseOverlay {
  r: number;
  g: number;
  b: number;
  /** 0–1 */
  alpha: number;
}

const PHASE_OVERLAYS: Record<DayPhase, PhaseOverlay> = {
  dawn:      { r: 0xff, g: 0xcc, b: 0x44, alpha: 0.08 }, // warm golden sunrise, not purple
  morning:   { r: 0x00, g: 0x00, b: 0x00, alpha: 0.00 }, // clear
  midday:    { r: 0xff, g: 0xee, b: 0x88, alpha: 0.05 }, // subtle warm
  afternoon: { r: 0xff, g: 0xaa, b: 0x44, alpha: 0.08 }, // warm orange
  dusk:      { r: 0xff, g: 0x88, b: 0x44, alpha: 0.12 }, // warm sunset (not purplish)
  night:     { r: 0x22, g: 0x44, b: 0x88, alpha: 0.35 }, // cool blue night
};

/**
 * WorldClock — tracks the in-game day/night cycle.
 *
 * A full day takes `dayDuration` real-world seconds (default 18 min).
 * The game-clock hour (0–23) drives the current phase, which influences
 * wildlife FSMs, visual overlays, and corruption behaviour.
 *
 * @example
 * ```ts
 * // In GameScene.create():
 * this.worldClock = new WorldClock({ startPhase: 'dawn' });
 *
 * // In GameScene.update(time, delta):
 * this.worldClock.update(delta);
 * ```
 */
export class WorldClock {
  /** Total elapsed real-world seconds since the clock started. */
  private totalSeconds: number;

  /** Duration of a full day in real seconds (default: 18 min). */
  readonly dayDuration: number;

  constructor(options: { dayDuration?: number; startPhase?: DayPhase } = {}) {
    this.dayDuration = options.dayDuration ?? 18 * 60;

    // Seed totalSeconds so the clock starts at the requested phase.
    const startPhase = options.startPhase ?? 'morning';
    const phaseStartHour = WorldClock.phaseStartHour(startPhase);
    const startProgress = phaseStartHour / 24;
    this.totalSeconds = startProgress * this.dayDuration;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Advance the clock by `delta` milliseconds (called each frame). */
  update(delta: number): void {
    this.totalSeconds += delta / 1000;
  }

  /** Game-clock hour in [0, 24). */
  get hour(): number {
    const dayProgress = (this.totalSeconds % this.dayDuration) / this.dayDuration;
    return dayProgress * 24;
  }

  /**
   * Integer count of full in-game days elapsed since the clock started.
   * SeasonSystem reads this to detect day rollovers and advance season
   * progress — deriving it from totalSeconds / dayDuration means it stays
   * correct even when skipToPhase() fast-forwards time.
   */
  get dayCount(): number {
    return Math.floor(this.totalSeconds / this.dayDuration);
  }

  get phase(): DayPhase {
    const h = this.hour;
    if (h >= 5  && h < 7)  return 'dawn';
    if (h >= 7  && h < 12) return 'morning';
    if (h >= 12 && h < 15) return 'midday';
    if (h >= 15 && h < 18) return 'afternoon';
    if (h >= 18 && h < 21) return 'dusk';
    return 'night';
  }

  /** Overlay config for the current phase — use to drive the visual tint. */
  get overlay(): PhaseOverlay {
    return PHASE_OVERLAYS[this.phase];
  }

  get isDawn():      boolean { return this.phase === 'dawn';      }
  get isMorning():   boolean { return this.phase === 'morning';   }
  get isMidday():    boolean { return this.phase === 'midday';    }
  get isAfternoon(): boolean { return this.phase === 'afternoon'; }
  get isDusk():      boolean { return this.phase === 'dusk';      }
  get isNight():     boolean { return this.phase === 'night';     }

  // ─── Event-driven shifts ────────────────────────────────────────────────────

  /**
   * Slow the cycle temporarily (e.g. when the player cleanses a large zone).
   * Subtracts `seconds` from the accumulated time so the current phase lingers.
   */
  slowDown(seconds: number): void {
    this.totalSeconds = Math.max(0, this.totalSeconds - seconds);
  }

  /**
   * Skip forward in time to the start of the next occurrence of `phase`.
   * Never goes backward.
   */
  skipToPhase(phase: DayPhase): void {
    const targetHour = WorldClock.phaseStartHour(phase);
    const currentDayStart = Math.floor(this.totalSeconds / this.dayDuration) * this.dayDuration;
    const targetSeconds = currentDayStart + (targetHour / 24) * this.dayDuration;

    if (targetSeconds > this.totalSeconds) {
      this.totalSeconds = targetSeconds;
    } else {
      // Target is in the next day
      this.totalSeconds = targetSeconds + this.dayDuration;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Returns the game-clock hour at which a phase begins. */
  static phaseStartHour(phase: DayPhase): number {
    const starts: Record<DayPhase, number> = {
      dawn:      5,
      morning:   7,
      midday:    12,
      afternoon: 15,
      dusk:      18,
      night:     21,
    };
    return starts[phase];
  }
}
