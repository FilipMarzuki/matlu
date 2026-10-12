/**
 * How long an action takes (#1668): open-ended gathering gets a chosen length, played as trips.
 *
 * Part of the artificer sim core: pure, deterministic, no Phaser, no randomness. Behind the
 * `action-length` rules switch (features.ts); region1.ts reads the switch and wires this in.
 *
 * The owner's model (issue #1668, comment of 2026-10-12):
 *
 *   **A long session is a series of trips.** Walk out, harvest until you can carry no more or the
 *   patch is thin, walk back, unload, repeat. Carrying and distance decide how many trips fit in
 *   the chosen time, and the walk is paid per trip.
 *
 *   **Each resource has its own abundance at a site.** Standing timber and stone barely notice a
 *   day's work; deadfall sticks, berries and a fishing spot thin within a session and come back
 *   over the following days.
 *
 * This is a second, short-term layer on top of the land's seasonal supply (exploration.ts
 * `supply`, #1304): supply is the whole ring's stock over a season, a patch is the spot you work
 * today. A trip's yield still comes from the action's own rules; this module only says how many
 * "usual trips' worth" of harvesting a session adds up to, patch by patch.
 */

import type { Ring } from './exploration';

/** The actions that get a length: those whose yield is per hour. Building, crafting, scouting and the hunt stay fixed. */
export const LENGTH_ACTIONS = ['gather', 'wood', 'quarry', 'fish', 'water'] as const;
export type LengthAction = typeof LENGTH_ACTIONS[number];
export const hasLength = (id: string): id is LengthAction => (LENGTH_ACTIONS as readonly string[]).includes(id);

/** A resource at a site, with its own abundance. */
export type PatchId = 'berries' | 'deadfall' | 'timber' | 'stone' | 'fishing' | 'spring';
export const PATCH_IDS: readonly PatchId[] = ['berries', 'deadfall', 'timber', 'stone', 'fishing', 'spring'];

export interface PatchDef {
  /** As the journal and the preview name it ("the deadfall is getting thin"). */
  name: string;
  /** Abundance lost per hour worked (abundance runs 1 = untouched … 0 = stripped). */
  perHour: number;
  /** Abundance regained each night. */
  recover: number;
}

/**
 * Per-resource depletion and recovery (owner, #1668): plentiful standing timber and stone keep
 * yielding steadily; deadfall, berries and a fishing spot thin within hours and come back over days.
 * A spring doesn't thin at all — the land's water supply already barely notices you (#1304).
 */
export const PATCHES: Readonly<Record<PatchId, PatchDef>> = {
  berries: { name: 'berry patch', perHour: 0.1, recover: 0.15 },
  deadfall: { name: 'deadfall', perHour: 0.12, recover: 0.12 },
  timber: { name: 'standing timber', perHour: 0.01, recover: 0.01 },
  stone: { name: 'stone', perHour: 0.005, recover: 0.005 },
  fishing: { name: 'fishing spot', perHour: 0.1, recover: 0.25 },
  spring: { name: 'spring', perHour: 0, recover: 1 },
};

/** What each action draws from, by store: wood's firewood is the deadfall, its materials the standing timber. */
export const ACTION_PATCHES: Readonly<Record<LengthAction, Readonly<Record<string, PatchId>>>> = {
  gather: { rawFood: 'berries', materials: 'berries' },
  wood: { firewood: 'deadfall', materials: 'timber' },
  quarry: { stone: 'stone' },
  fish: { rawFood: 'fishing' },
  water: { water: 'spring' },
};

/** The patch a session is about (what "until N" counts and what thinning stops): the action's main store. */
export const MAIN: Readonly<Record<LengthAction, { store: 'rawFood' | 'firewood' | 'stone' | 'water'; patch: PatchId }>> = {
  gather: { store: 'rawFood', patch: 'berries' },
  wood: { store: 'firewood', patch: 'deadfall' },
  quarry: { store: 'stone', patch: 'stone' },
  fish: { store: 'rawFood', patch: 'fishing' },
  water: { store: 'water', patch: 'spring' },
};

/** The patches an action works, main first. */
export const patchesOf = (id: LengthAction): PatchId[] => [...new Set([MAIN[id].patch, ...Object.values(ACTION_PATCHES[id])])];

/** Saved abundance, by `${ring}:${patch}`. A patch not listed is untouched (1). */
export type Patches = Readonly<Record<string, number>>;
export const patchKey = (ring: Ring, p: PatchId): string => `${ring}:${p}`;
export const abundance = (patches: Patches | undefined, ring: Ring, p: PatchId): number => patches?.[patchKey(ring, p)] ?? 1;

/** However stripped a patch, an hour there still turns up this share. */
export const PATCH_FLOOR = 0.25;
/** Below this the patch is thin: the trip ends and the session with it — no point walking back. */
export const THIN = 0.3;
/** The preview and the journal say a patch is "getting thin" below this. */
export const THINNING = 0.6;
/** Planning step, in hours: work is planned in quarter hours. */
export const STEP = 0.25;
/** The first trip always gets at least this much work, however far the walk. */
export const MIN_WORK = 1;
/** A later trip is only worth the walk with at least this much work left in it. */
export const MIN_LATER_WORK = 0.5;

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

export interface Trip {
  /** Hours harvesting at the site. */
  work: number;
  /** Hours walking there and back. */
  travel: number;
  /** "Hours at a fresh patch" harvested, per patch: what the trip yields, before the action's own rules. */
  harvest: Partial<Record<PatchId, number>>;
  /** Why it ended: full load, thin patch, out of time, or the target reached. */
  ended: 'full' | 'thin' | 'time' | 'target';
}

export interface TripPlanInput {
  /** The session's length in hours, walks included. */
  budget: number;
  /** A trip's walk there and back, in hours. */
  travel: number;
  /** Abundance of each patch the action works, at the start. */
  start: Partial<Record<PatchId, number>>;
  /** The patch that matters: thinning it ends the session. */
  main: PatchId;
  /** Bulk carried per hour at a fresh patch, per patch. */
  bulkPerHour: Partial<Record<PatchId, number>>;
  /** What one trip can comfortably carry (bulk); Infinity when nothing is heavy. */
  capacity: number;
  /** "Until N": stop once the main patch's harvest reaches this many fresh-patch hours. */
  targetHarvest?: number;
}

export interface TripPlan {
  trips: Trip[];
  /** Total hours harvesting and walking. */
  work: number;
  travel: number;
  /** Fresh-patch hours harvested, per patch, over the session. */
  harvest: Partial<Record<PatchId, number>>;
  /** Abundance of each patch at the end. */
  end: Partial<Record<PatchId, number>>;
}

/**
 * Plan a session's trips (pure): out, harvest a quarter hour at a time until the load is full,
 * the main patch is thin, the time is up or the target is met, then home. Each quarter hour
 * harvests at the patch's abundance (never under the floor) and thins it by its rate.
 */
export function planTrips(p: TripPlanInput): TripPlan {
  const patches = Object.keys(p.start) as PatchId[];
  const a: Partial<Record<PatchId, number>> = { ...p.start };
  const total: Partial<Record<PatchId, number>> = {};
  const trips: Trip[] = [];
  // Work in whole steps so the sums stay exact.
  const steps = (h: number): number => Math.floor(h / STEP + 1e-9);
  let left = steps(p.budget);
  const travelSteps = Math.ceil(p.travel / STEP - 1e-9);
  for (let guard = 0; guard < 200; guard++) {
    const first = trips.length === 0;
    const workable = left - travelSteps;
    if (!first && workable < steps(MIN_LATER_WORK)) break;
    const maxSteps = first ? Math.max(steps(MIN_WORK), workable) : workable;
    const trip: Trip = { work: 0, travel: p.travel, harvest: {}, ended: 'time' };
    let load = 0, n = 0;
    while (n < maxSteps) {
      const w = patches.reduce((sum, k) => sum + (p.bulkPerHour[k] ?? 0) * Math.max(PATCH_FLOOR, a[k]!) * STEP, 0);
      if (n > 0 && load + w > p.capacity + 1e-9) { trip.ended = 'full'; break; }
      for (const k of patches) {
        const got = Math.max(PATCH_FLOOR, a[k]!) * STEP;
        trip.harvest[k] = (trip.harvest[k] ?? 0) + got;
        total[k] = (total[k] ?? 0) + got;
        a[k] = Math.max(0, a[k]! - PATCHES[k].perHour * STEP);
      }
      load += w; n += 1;
      if (p.targetHarvest !== undefined && (total[p.main] ?? 0) >= p.targetHarvest - 1e-9) { trip.ended = 'target'; break; }
      if (a[p.main]! < THIN) { trip.ended = 'thin'; break; }
    }
    trip.work = n * STEP;
    left -= travelSteps + n;
    trips.push(trip);
    if (trip.ended === 'thin' || trip.ended === 'target' || trip.ended === 'time') break;
  }
  const end = Object.fromEntries(patches.map(k => [k, round3(a[k]!)])) as Partial<Record<PatchId, number>>;
  return {
    trips,
    work: trips.reduce((h, t) => h + t.work, 0),
    travel: trips.reduce((h, t) => h + t.travel, 0),
    harvest: total,
    end,
  };
}

/** One night's recovery (pure): each patch regains its rate; a patch back to full is forgotten. Undefined when none are left. */
export function recoverPatches(patches: Patches): Patches | undefined {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(patches)) {
    const p = k.split(':')[1] as PatchId;
    const next = round3(Math.min(1, v + (PATCHES[p]?.recover ?? 1)));
    if (next < 1) out[k] = next;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A saved set of patches, checked: keys are `ring:patch`, values abundances 0..1. Anything else isn't one. */
export function validPatches(x: unknown): x is Record<string, number> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  return Object.entries(x).every(([k, v]) => {
    const [r, p] = k.split(':');
    return ['1', '2', '3'].includes(r) && (PATCH_IDS as readonly string[]).includes(p) && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
  });
}

// ── The length a player chose ───────────────────────────────────────────────

/** The lengths offered, in hours ("day": the rest of the day). */
export const HOUR_CHOICES = ['1', '2', '3', '4', 'day'] as const;
/** The targets offered for "until I have N". */
export const UNTIL_CHOICES = ['5', '10', '20'] as const;

/**
 * A chosen length, read from a queue item's options: `hours` ("1"–"4", any number of hours up to
 * a day, or "day") and `until` (a whole number: keep at it until the stores hold this many).
 * Null when neither is set (or "usual"/"none"): the action's usual length, exactly as before.
 * Malformed values read as unset; the API refuses them before they get here.
 */
export function chosenLength(opts: Readonly<Record<string, string>>): { hours: number | 'day' | null; until: number | null } | null {
  const h = opts.hours, u = opts.until;
  const hours = h === 'day' ? 'day' : h !== undefined && /^\d+(\.\d+)?$/.test(h) && Number(h) > 0 ? Math.min(24, Number(h)) : null;
  const until = u !== undefined && /^\d+$/.test(u) && Number(u) > 0 ? Number(u) : null;
  return hours === null && until === null ? null : { hours, until };
}

/** Why a length can't be set as given, or null: for the API, which refuses rather than guessing. */
export function lengthRefusal(id: string, opts: Readonly<Record<string, string>>): string | null {
  const set = (k: string): boolean => opts[k] !== undefined && opts[k] !== (k === 'hours' ? 'usual' : 'none');
  if (!set('hours') && !set('until')) return null;
  if (!hasLength(id)) return `${id} has a fixed length; only ${LENGTH_ACTIONS.join(', ')} take hours or until`;
  if (set('hours') && opts.hours !== 'day' && !(/^\d+(\.\d+)?$/.test(opts.hours) && Number(opts.hours) >= 1 && Number(opts.hours) <= 14)) return 'hours must be a number from 1 to 14, or "day"';
  if (set('until') && !(/^\d+$/.test(opts.until) && Number(opts.until) >= 1 && Number(opts.until) <= 999)) return 'until must be a whole number from 1 to 999';
  return null;
}

/** A patch's state in words, for the preview and the journal; null while it's fresh enough not to mention. */
export function patchWord(p: PatchId, a: number): string | null {
  if (PATCHES[p].perHour === 0) return null;
  return a < THIN ? `the ${PATCHES[p].name} is stripped` : a < THINNING ? `the ${PATCHES[p].name} is getting thin` : null;
}
