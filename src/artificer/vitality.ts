/**
 * Vitality — the body/mind economy of the artificer game (#1203).
 *
 * This is the first module of the *artificer sim core*: pure, deterministic,
 * renderer-agnostic TypeScript with **no Phaser imports**, so it runs in unit
 * tests, in a headless sim, in a future DOM frontend, and (later) inside Core
 * Warden as its non-combat layer — the same rules everywhere.
 *
 * Model (see docs/vitality-system-design.md):
 *   - Two spendable pools, Vigor (body) and Clarity (mind), each a
 *     { current, cap } — the bar you spend, under a capacity that drifts.
 *   - A slow Condition reserve (0..100) that you never spend directly; it
 *     erodes when you push a pool past empty (the soft-fail) and heals slowly
 *     on good nights (see {@link recoverCondition}).
 *   - A hidden morale (0..1), derived from Condition and how full the pools are,
 *     that quietly makes drains cost more or less.
 *
 * Nothing here knows about days, actions, winter or recipes — it is the raw
 * mechanics those systems compose on top of.
 */

/** The "standard" starting capacity a fresh character has in both pools. */
export const BASELINE = 100;
/** Capacity can never drift below this (deep deterioration) … */
export const CAP_FLOOR = 50;
/** … nor above this (peak conditioning); traits/age can narrow this range. */
export const CAP_CEIL = 150;

/** A spendable pool: `current` is the bar, `cap` is the ceiling it refills to. */
export interface Pool {
  current: number;
  cap: number;
}

/** The whole vitality state of one character. */
export interface Vitals {
  vigor: Pool;
  clarity: Pool;
  /** The slow reserve, 0..100. Overexertion and hardship wear it; good nights heal it slowly. */
  condition: number;
}

/**
 * One thing the character does. Rates are *per hour* (negative = drain); a
 * `flat` bump is a one-shot (a meal). `sleep` marks a restorative rest whose
 * positive rates are scaled by shelter warmth (a poor camp sleeps thin).
 *
 * Deliberately generic: Region 1 / the queue decide what the activities *are*
 * and feed them in.
 */
export interface Activity {
  hours: number;
  vigorRate?: number;
  clarityRate?: number;
  vigorFlat?: number;
  clarityFlat?: number;
  sleep?: boolean;
}

export interface ApplyOpts {
  /** 0..1 shelter warmth; scales a sleep activity's recovery. Default 0.45. */
  shelterWarmth?: number;
}

/** Telemetry a caller needs to summarise a day for capacity drift. */
export interface ActivityResult {
  vitals: Vitals;
  /** Total drain magnitude applied to each pool (≥ 0). */
  loadVigor: number;
  loadClarity: number;
  /** True if a pool was driven past empty this activity. */
  pushedVigor: boolean;
  pushedClarity: boolean;
  /** How much Condition the overage cost. */
  conditionLost: number;
}

/** A day's rolled-up summary, fed to {@link driftCapacity} at night. */
export interface DaySummary {
  loadVigor: number;
  loadClarity: number;
  /** Did the character eat today? */
  ate: boolean;
  /** Did the character drink today? Water is needed to recover at all (#1233). Default true. */
  drank?: boolean;
  /** Nights in a row without food, including this one. One missed meal still lets a body train; two don't.
   *  Unknown (undefined) with `ate: false` counts as not recovered, the conservative reading. */
  hungryNights?: number;
  /** 0..1 warmth of where they slept (drives Clarity recovery/conditioning). */
  shelterWarmth: number;
  pushedVigor?: boolean;
  pushedClarity?: boolean;
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Enough stimulus in a day to count as "trained" rather than idle. */
const STIMULUS = 16;
/** How fast capacity approaches its target each night (0..1); slow on purpose. */
const CAP_LERP = 0.35;
/** Fraction of an over-empty overage that is bitten off Condition. */
const OVEREXERT = 0.6;

/** A fresh character: both pools full at baseline, reserve sound. */
export function createVitals(init: Partial<{ vigor: number; clarity: number; condition: number; vigorCap: number; clarityCap: number }> = {}): Vitals {
  const vCap = init.vigorCap ?? BASELINE;
  const cCap = init.clarityCap ?? BASELINE;
  return {
    vigor: { current: init.vigor ?? vCap, cap: vCap },
    clarity: { current: init.clarity ?? cCap, cap: cCap },
    condition: init.condition ?? 100,
  };
}

const clone = (v: Vitals): Vitals => ({
  vigor: { ...v.vigor },
  clarity: { ...v.clarity },
  condition: v.condition,
});

/**
 * Hidden morale, 0.05..1 — mostly Condition, nudged by how full the pools sit
 * relative to their caps. Never shown to the player; only felt.
 */
export function morale(v: Vitals): number {
  const fill = (v.vigor.current / v.vigor.cap + v.clarity.current / v.clarity.cap) / 2;
  return clamp(0.35 + 0.4 * (v.condition / 100) + 0.12 * fill, 0.05, 1);
}

/**
 * Apply one activity, returning a *new* Vitals (pure — never mutates input).
 *
 * Drains are multiplied by a morale factor (a low mood makes a hard day harder);
 * refills are not — a meal is a meal. A sleep activity's positive rates scale
 * with shelter warmth. Any amount that would drive a pool below zero is clamped
 * to zero and its overage bites Condition.
 */
export function applyActivity(v: Vitals, a: Activity, opts: ApplyOpts = {}): ActivityResult {
  const next = clone(v);
  const m = morale(v);
  // ~1.42 at m=0 · 1.0 at m=0.6 · 0.86 at m=1 — low morale taxes effort.
  const drainMul = 1 + (0.6 - m) * 0.7;
  const warmth = opts.shelterWarmth ?? 0.45;

  const pools = [
    { pool: next.vigor, rate: a.vigorRate ?? 0, flat: a.vigorFlat ?? 0, key: 'vigor' as const },
    { pool: next.clarity, rate: a.clarityRate ?? 0, flat: a.clarityFlat ?? 0, key: 'clarity' as const },
  ];

  let loadVigor = 0, loadClarity = 0, conditionLost = 0;
  let pushedVigor = false, pushedClarity = false;

  for (const { pool, rate, flat, key } of pools) {
    let d = rate * a.hours;
    if (d < 0) {
      d *= drainMul;
      if (key === 'vigor') loadVigor = -d; else loadClarity = -d;
    } else if (d > 0 && a.sleep) {
      d *= 0.45 + 0.55 * warmth; // a cold camp gives thin sleep
    }
    d += flat; // one-shot bumps (a meal) are unscaled
    const nextVal = pool.current + d;
    if (nextVal < 0) {
      conditionLost += -nextVal * OVEREXERT;
      pool.current = 0;
      if (key === 'vigor') pushedVigor = true; else pushedClarity = true;
    } else {
      pool.current = clamp(nextVal, 0, pool.cap);
    }
  }

  next.condition = clamp(next.condition - conditionLost, 0, 100);
  return { vitals: next, loadVigor, loadClarity, pushedVigor, pushedClarity, conditionLost };
}

/**
 * Nightly long-run capacity drift (pure). Each pool's capacity eases toward a
 * target set by how the day was lived:
 *   - demanding **and** recovered (fed / warm) and not pushed past empty →
 *     *supercompensation*, target above baseline;
 *   - demanding but not recovered, or pushed past empty → *overreach*, below;
 *   - barely used → *atrophy*, drifts back toward and below baseline;
 *   - a worn-down Condition drags both targets down.
 * Capacity moves only a fraction of the way each night, and `current` is
 * re-clamped so it can never exceed a shrunken cap.
 */
export function driftCapacity(v: Vitals, day: DaySummary): Vitals {
  const next = clone(v);
  const drift = (pool: Pool, load: number, recovered: boolean, pushed: boolean) => {
    const trained = load >= STIMULUS && recovered && !pushed;
    let target = BASELINE
      + (trained ? 14 : 0)
      - (load >= STIMULUS && !recovered ? 10 : 0)
      - (load < 6 ? 6 : 0)
      - (v.condition < 40 ? 10 : 0);
    target = clamp(target, CAP_FLOOR, CAP_CEIL);
    pool.cap = clamp(pool.cap + (target - pool.cap) * CAP_LERP, CAP_FLOOR, CAP_CEIL);
    pool.current = Math.min(pool.current, pool.cap);
  };
  // Hard work only builds a body or mind that has water and isn't starving (#1233): a
  // single missed meal is fine, a second night hungry isn't. The mind also needs a warm sleep.
  const fuelled = (day.drank ?? true) && (day.ate || (day.hungryNights ?? 2) <= 1);
  drift(next.vigor, day.loadVigor, fuelled, day.pushedVigor ?? false);
  drift(next.clarity, day.loadClarity, fuelled && day.shelterWarmth >= 0.5, day.pushedClarity ?? false);
  return next;
}

/** Fed and watered: both needs met tonight (#1233) — what healing Condition takes. */
export const isNourished = (day: Pick<DaySummary, 'ate' | 'drank'>): boolean => day.ate && (day.drank ?? true);

/** Shelter warmth needed for a night to count as "real rest" for Condition. */
export const HEAL_WARMTH = 0.5;

/**
 * Nightly Condition healing (pure). Per the design (docs/vitality-system-design.md §3)
 * Condition "recovers slowly, only through real rest: deep sleep in shelter, good food,
 * over days". So a night heals only if the character ate and drank, slept somewhere at
 * least {@link HEAL_WARMTH} warm, and didn't push past empty that day. Warmer shelter
 * heals more, and a light day (little load — e.g. a rest day) doubles it, so taking it
 * easy is a real lever. A few points a night: you can't grind it back in an afternoon.
 */
export function recoverCondition(v: Vitals, day: DaySummary): Vitals {
  const pushed = (day.pushedVigor ?? false) || (day.pushedClarity ?? false);
  if (!isNourished(day) || pushed || day.shelterWarmth < HEAL_WARMTH) return v;
  const light = day.loadVigor + day.loadClarity < STIMULUS;
  const gain = (2 + 4 * day.shelterWarmth) * (light ? 2 : 1);
  return { ...clone(v), condition: clamp(v.condition + gain, 0, 100) };
}
