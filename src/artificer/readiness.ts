/**
 * Readiness — "am I ready for winter?" and the milestone ladder (#1205).
 *
 * Part of the artificer sim core: pure, deterministic, no Phaser imports.
 * See docs/region-1-design.md §2.
 *
 * Two independent pieces:
 *   - the four winter-readiness **pillars** (larder, shelter, fuel, body & mind),
 *     computed from a small snapshot so any region can reuse them;
 *   - a generic one-way **milestone latch** — milestones are a teaching aid, so
 *     once reached they stay reached even if the condition later lapses (eating
 *     your larder doesn't un-earn "the larder begins").
 */

import { BASELINE, type Vitals } from './vitality';

/** The bits of game state the pillars look at. */
export interface ReadinessInput {
  /** Preserved winter rations in the larder. */
  rations: number;
  /** Fuel laid in for the cold months. */
  firewood: number;
  /** 0..1 warmth of the finished shelter. */
  shelterWarmth: number;
  vitals: Vitals;
}

export interface ReadinessThresholds {
  larder: number;
  fuel: number;
  /** Shelter warmth needed to count as winterized. */
  warmth: number;
  /** Minimum Condition for a "sound" body & mind. */
  condition: number;
}

/**
 * Winter-ready for a 30-night winter (#1306): a larder of 20 rations (half
 * the winter; fishing, snares and a careful ration plan cover the rest), 40
 * firewood, a shelter warm enough that, with a fire kept in, a clear midwinter
 * night isn't a cold one, and a sound body. Advice, not a gate (#1302).
 */
export const DEFAULT_THRESHOLDS: ReadinessThresholds = { larder: 20, fuel: 40, warmth: 0.75, condition: 70 };

/** The old 13-day year's thresholds, for tests of the short game (SHORT_YEAR). */
export const SHORT_THRESHOLDS: ReadinessThresholds = { larder: 10, fuel: 12, warmth: 0.6, condition: 70 };

export type PillarKey = 'larder' | 'shelter' | 'fuel' | 'body';

export interface Pillar {
  key: PillarKey;
  done: boolean;
  /** 0..1, for progress bars. */
  progress: number;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** The four pillars, in display order. */
export function pillars(input: ReadinessInput, t: ReadinessThresholds = DEFAULT_THRESHOLDS): Pillar[] {
  const { vitals: v } = input;
  // Body & mind is a gate, not a quantity: both capacities at or above the
  // standard baseline AND a sound reserve. Progress averages the three checks
  // so a UI can still show "how close".
  const bodyChecks = [
    clamp01(v.vigor.cap / BASELINE),
    clamp01(v.clarity.cap / BASELINE),
    clamp01(v.condition / t.condition),
  ];
  const bodyDone = v.vigor.cap >= BASELINE && v.clarity.cap >= BASELINE && v.condition >= t.condition;
  return [
    { key: 'larder', done: input.rations >= t.larder, progress: clamp01(input.rations / t.larder) },
    { key: 'shelter', done: input.shelterWarmth >= t.warmth, progress: clamp01(input.shelterWarmth / t.warmth) },
    { key: 'fuel', done: input.firewood >= t.fuel, progress: clamp01(input.firewood / t.fuel) },
    { key: 'body', done: bodyDone, progress: bodyDone ? 1 : bodyChecks.reduce((a, b) => a + b, 0) / bodyChecks.length },
  ];
}

/** True only when every pillar is done. */
export function isWinterReady(input: ReadinessInput, t: ReadinessThresholds = DEFAULT_THRESHOLDS): boolean {
  return pillars(input, t).every(p => p.done);
}

// ── Milestones ──────────────────────────────────────────────────────────────

/** A milestone over some state type `S` (each region supplies its own ladder). */
export interface MilestoneDef<S> {
  id: string;
  name: string;
  done: (state: S) => boolean;
}

export interface MilestoneResult {
  /** Every milestone ever achieved, in definition order. */
  achieved: string[];
  /** Those achieved for the first time on this evaluation, in definition order. */
  newlyAchieved: string[];
}

/**
 * Evaluate a ladder against a state. One-way latch: anything in `already`
 * stays achieved regardless of its predicate now.
 */
export function evaluateMilestones<S>(defs: readonly MilestoneDef<S>[], state: S, already: readonly string[]): MilestoneResult {
  const have = new Set(already);
  const newlyAchieved: string[] = [];
  for (const d of defs) {
    if (!have.has(d.id) && d.done(state)) {
      have.add(d.id);
      newlyAchieved.push(d.id);
    }
  }
  return { achieved: defs.map(d => d.id).filter(id => have.has(id)), newlyAchieved };
}
