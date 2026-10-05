/**
 * Winter — the season clock, the caravan window, and how each exit resolves
 * (#1206). Part of the artificer sim core: pure, deterministic, no Phaser.
 * See docs/region-1-design.md §3–§5 and §7.
 *
 * Winter is the deadline. A caravan passes just before it; then the Warden
 * chooses: ride out with it, brave the crossing alone, or winter over. None of
 * the exits is a hard fail — an unprepared choice costs Condition and capacity
 * (and, on the road, a permanent injury), never the save.
 */

import { CAP_FLOOR, type Vitals } from './vitality';

export interface Calendar {
  /** First day the caravan is camped nearby. */
  caravanOpen: number;
  /** Last day you can still board it. */
  caravanClose: number;
  /** The snow arrives. */
  winterDay: number;
  /** The thaw: winter is over (#1301). */
  thawDay: number;
}

/**
 * The 60-day year (#1301, epic #1310): autumn on days 1–30, snow on day 31,
 * the thaw on day 61. Until winter is played (#1302) the caravan still offers
 * the old exits, on the last three days of autumn.
 */
export const DEFAULT_CALENDAR: Calendar = { caravanOpen: 28, caravanClose: 30, winterDay: 31, thawDay: 61 };

// ── Seasons (#1301) ─────────────────────────────────────────────────────────

export type Season = 'autumn' | 'winter' | 'thaw';

/** Which season a day falls in. */
export function seasonOf(day: number, cal: Calendar = DEFAULT_CALENDAR): Season {
  if (day < cal.winterDay) return 'autumn';
  return day < cal.thawDay ? 'winter' : 'thaw';
}

/** Midwinter — the shortest, coldest days — comes this many days after the first snow. */
export const MIDWINTER_AFTER = 14;

/**
 * A value that follows the year: given its level on day 1, the last day of
 * autumn, midwinter and the last day of winter, it runs in straight lines
 * between them (and carries on the last slope past the thaw). Daylight and
 * temperature are both shaped this way, so they stretch with the calendar.
 */
export function seasonCurve(day: number, cal: Calendar, levels: readonly [number, number, number, number]): number {
  const days = [1, cal.winterDay - 1, cal.winterDay + MIDWINTER_AFTER, cal.thawDay - 1];
  let seg = 0;
  while (seg < days.length - 2 && day > days[seg + 1]) seg++;
  const [d0, d1] = [days[seg], days[seg + 1]];
  return levels[seg] + (levels[seg + 1] - levels[seg]) * (day - d0) / (d1 - d0);
}

export type Phase = 'prep' | 'caravan' | 'postCaravan' | 'winter';
export type Choice = 'caravan' | 'solo' | 'winter';

export function phaseOf(day: number, cal: Calendar = DEFAULT_CALENDAR): Phase {
  if (day < cal.caravanOpen) return 'prep';
  if (day <= cal.caravanClose) return 'caravan';
  if (day < cal.winterDay) return 'postCaravan';
  return 'winter';
}

/** Which exits are open on a given day (none while you're still preparing). */
export function availableChoices(day: number, cal: Calendar = DEFAULT_CALENDAR): Choice[] {
  switch (phaseOf(day, cal)) {
    case 'prep': return [];
    case 'caravan': return ['caravan', 'solo', 'winter'];
    default: return ['solo', 'winter'];
  }
}

/** What the solo crossing demands (region-1 §6, "nomad survival"). */
export interface CrossingInput {
  coldGear: boolean;
  rations: number;
  vitals: Vitals;
}

export const CROSSING_NEEDS = { rations: 6, condition: 60, vigorCap: 95 };

export function crossingPrepared(i: CrossingInput): boolean {
  return i.coldGear
    && i.rations >= CROSSING_NEEDS.rations
    && i.vitals.condition >= CROSSING_NEEDS.condition
    && i.vitals.vigor.cap >= CROSSING_NEEDS.vigorCap;
}

export type OutcomeKind = 'thrive' | 'ragged' | 'crossed' | 'turnedBack' | 'wintered' | 'grim' | 'collapsed' | 'died';
/** How a run ended: one of the exits, or a collapse when Condition gave out (#1234). */
export type EndChoice = Choice | 'collapse';
export type Injury = 'frostbite';

export interface OutcomeInput {
  /** All four readiness pillars met. */
  ready: boolean;
  /** {@link crossingPrepared} for the solo road. */
  canCross: boolean;
  vitals: Vitals;
}

export interface Outcome {
  choice: EndChoice;
  kind: OutcomeKind;
  /** The Warden as they come out the other side (persists in the save). */
  vitals: Vitals;
  /** A permanent injury picked up on the way, if any. */
  injury?: Injury;
}

/** Penalties for the unprepared exits. Capacity losses never go below the floor. */
export const PENALTY = {
  frostbite: { vigorCap: 10, clarityCap: 6 },
  grim: { condition: 25, vigorCap: 12, clarityCap: 12 },
};

const lowerCap = (v: Vitals, pool: 'vigor' | 'clarity', by: number): void => {
  const p = v[pool];
  p.cap = Math.max(CAP_FLOOR, p.cap - by);
  p.current = Math.min(p.current, p.cap);
};

/**
 * Resolve an exit (pure). Validity — is this exit open today? — is the
 * caller's job via {@link availableChoices}.
 */
export function resolveOutcome(choice: Choice, input: OutcomeInput): Outcome {
  const v: Vitals = { vigor: { ...input.vitals.vigor }, clarity: { ...input.vitals.clarity }, condition: input.vitals.condition };

  if (choice === 'caravan') {
    return { choice, kind: input.ready ? 'thrive' : 'ragged', vitals: v };
  }

  if (choice === 'solo') {
    if (input.canCross) return { choice, kind: 'crossed', vitals: v };
    // Underprepared on the winter road: you turn back, and the cold leaves a
    // mark that ordinary recovery never undoes (vitality §3).
    lowerCap(v, 'vigor', PENALTY.frostbite.vigorCap);
    lowerCap(v, 'clarity', PENALTY.frostbite.clarityCap);
    return { choice, kind: 'turnedBack', vitals: v, injury: 'frostbite' };
  }

  // Winter over.
  if (input.ready) return { choice, kind: 'wintered', vitals: v };
  v.condition = Math.max(0, v.condition - PENALTY.grim.condition);
  lowerCap(v, 'vigor', PENALTY.grim.vigorCap);
  lowerCap(v, 'clarity', PENALTY.grim.clarityCap);
  return { choice, kind: 'grim', vitals: v };
}
