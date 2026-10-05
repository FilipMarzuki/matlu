/**
 * Exploration — day-radius rings and learning the land by working it (#1217).
 *
 * Part of the artificer sim core: pure, deterministic, no Phaser. Implements
 * the concentric rings of docs/region-exploration-design.md §4 with the
 * confidence levels of §3, plus one idea from play-testing the design:
 *
 *   **You learn a place by working it.** Scouting gives the high-level picture
 *   ("there are berries out there"); surveying firms it up; but only *doing* —
 *   picking berries, cutting wood, breaking rock — teaches the detail (where
 *   the fiber grows thick, where the flint seam runs). And working a patch you
 *   haven't explored still teaches you something about the rest of it.
 *
 * Knowledge is kept per ring × domain as a continuous 0..3 progress whose
 * floor is the confidence level, so small gains from doing accumulate.
 */

export type Ring = 1 | 2 | 3;
export const RINGS: readonly Ring[] = [1, 2, 3];
export const RING_NAME: Readonly<Record<Ring, string>> = { 1: 'Near', 2: 'Far', 3: 'Distant' };

/** What there is to know about a ring. `routes` (paths, passes out) only matters beyond home. */
export type Domain = 'forage' | 'timber' | 'stone' | 'water' | 'game' | 'routes';
export const DOMAINS: readonly Domain[] = ['forage', 'timber', 'stone', 'water', 'game', 'routes'];

/** The domains that exist in a ring (nothing to find "on the routes" next to your fire). */
export const domainsOf = (ring: Ring): readonly Domain[] => (ring === 1 ? DOMAINS.filter(d => d !== 'routes') : DOMAINS);

/** Design §3: 0 unknown · 1 suspected · 2 observed · 3 detailed. */
export type Level = 0 | 1 | 2 | 3;
export const LEVEL_NAME: Readonly<Record<Level, string>> = { 0: 'unknown', 1: 'suspected', 2: 'observed', 3: 'detailed' };

type Grid = Record<Ring, Record<Domain, number>>;

export interface Exploration {
  /** Knowledge progress per ring × domain, 0..3 (floor = Level). */
  known: Grid;
  /** Trips made into each ring × domain — drives depletion. */
  worked: Grid;
  /** Find ids earned by reaching "detailed", as `${ring}:${domain}`. */
  finds: string[];
}

const zeroGrid = (): Grid => {
  const row = (): Record<Domain, number> => ({ forage: 0, timber: 0, stone: 0, water: 0, game: 0, routes: 0 });
  return { 1: row(), 2: row(), 3: row() };
};

export function createExploration(): Exploration {
  return { known: zeroGrid(), worked: zeroGrid(), finds: [] };
}

function clone(e: Exploration): Exploration {
  const g = (x: Grid): Grid => ({ 1: { ...x[1] }, 2: { ...x[2] }, 3: { ...x[3] } });
  return { known: g(e.known), worked: g(e.worked), finds: [...e.finds] };
}

export function level(e: Exploration, ring: Ring, d: Domain): Level {
  return Math.floor(Math.min(3, e.known[ring][d])) as Level;
}

/** A ring is scouted once every domain in it is at least suspected — by scouting or by working it. */
export function scouted(e: Exploration, ring: Ring): boolean {
  return domainsOf(ring).every(d => level(e, ring, d) >= 1);
}

/** You can reach a ring once you know the one inside it (design §4: "range is a capability"). */
export function reachable(e: Exploration, ring: Ring): boolean {
  return ring === 1 || scouted(e, (ring - 1) as Ring);
}

// ── Learning ────────────────────────────────────────────────────────────────

/** Raise domains in a ring to at least `to` (never lowers, never past detailed). */
function raise(e: Exploration, ring: Ring, to: number, only?: Domain): Exploration {
  const next = clone(e);
  for (const d of only ? [only] : domainsOf(ring)) next.known[ring][d] = Math.max(next.known[ring][d], Math.min(3, to));
  return next;
}

/** Scout: the high-level look — everything in the ring at least suspected. */
export const scout = (e: Exploration, ring: Ring): Exploration => raise(e, ring, 1);
/** Survey: a careful look — everything in the ring at least observed. */
export const survey = (e: Exploration, ring: Ring): Exploration => raise(e, ring, 2);
/** Track: find the game — game in the ring at least observed. */
export const track = (e: Exploration, ring: Ring): Exploration => raise(e, ring, 2, 'game');

/**
 * Climb & Look Out (design §4): from height, everything in this ring sharpens
 * one level (up to observed), and you can see out over the next ring — its
 * overview, routes included, becomes at least suspected.
 */
export function lookout(e: Exploration, ring: Ring): Exploration {
  const next = clone(e);
  for (const d of domainsOf(ring)) next.known[ring][d] = Math.max(next.known[ring][d], Math.min(2, level(e, ring, d) + 1));
  if (ring < 3) {
    const out = (ring + 1) as Ring;
    for (const d of domainsOf(out)) next.known[out][d] = Math.max(next.known[out][d], 1);
  }
  return next;
}

/** Insight a trip working a domain teaches it (three trips ≈ one level). */
export const WORK_INSIGHT = 0.35;
/** Overview a trip spills into the ring's other domains — never past "suspected". */
export const SPILL_INSIGHT = 0.25;

/** What reaching "detailed" in a worked domain turns up (routes aren't worked, so have none). */
export const FINDS: Readonly<Partial<Record<Domain, { name: string; note: string }>>> = {
  forage: { name: 'Fiber patch', note: 'gathering also brings in +2 materials' },
  timber: { name: 'Deadfall', note: 'wood trips bring +2 firewood' },
  stone: { name: 'Flint seam', note: 'quarrying brings +2 materials' },
  water: { name: 'Clear spring', note: 'water trips bring +2 water' },
  game: { name: 'Game trail', note: 'hunts bring +2 food' },
};

export const findId = (ring: Ring, d: Domain): string => `${ring}:${d}`;
export const hasFind = (e: Exploration, ring: Ring, d: Domain): boolean => e.finds.includes(findId(ring, d));

/**
 * One trip working a domain in a ring (pure): it teaches that domain, spills a
 * little overview into the rest of the ring, and depletes it. Returns the new
 * state and any find made on this trip.
 */
export function work(e: Exploration, ring: Ring, d: Domain): { exploration: Exploration; found: Domain | null } {
  const next = clone(e);
  next.worked[ring][d] += 1;
  next.known[ring][d] = Math.min(3, next.known[ring][d] + WORK_INSIGHT);
  for (const o of domainsOf(ring)) {
    if (o !== d) next.known[ring][o] = Math.max(next.known[ring][o], Math.min(1, next.known[ring][o] + SPILL_INSIGHT));
  }
  let found: Domain | null = null;
  if (FINDS[d] && level(next, ring, d) >= 3 && !hasFind(next, ring, d)) {
    next.finds.push(findId(ring, d));
    found = d;
  }
  return { exploration: next, found };
}

// ── Yields ──────────────────────────────────────────────────────────────────

/** Extra hours a trip spends getting there and back. */
export const TRAVEL_HOURS: Readonly<Record<Ring, number>> = { 1: 0, 2: 3, 3: 6 };
/** How much richer an untouched outer ring is. */
export const RICHNESS: Readonly<Record<Ring, number>> = { 1: 1, 2: 1.5, 3: 2 };
/** Each trip takes this share off future yields in that ring × domain… */
export const DEPLETION_PER_TRIP = 0.07;
/** …down to this floor (the land recovers enough to keep giving something). */
export const DEPLETION_FLOOR = 0.5;

export function depletion(e: Exploration, ring: Ring, d: Domain): number {
  return Math.max(DEPLETION_FLOOR, 1 - DEPLETION_PER_TRIP * e.worked[ring][d]);
}

/** Foraging somewhere you don't know yet — wandering, not knowing where to look. */
export const UNKNOWN_YIELD = 0.5;

/**
 * A trip's yield (rounded): `base + perLevel × (level − 1)`, halved when the
 * domain is still unknown, then scaled by the ring's richness and depletion.
 */
export function tripYield(e: Exploration, ring: Ring, d: Domain, base: number, perLevel: number): number {
  const lv = level(e, ring, d);
  const raw = lv === 0 ? base * UNKNOWN_YIELD : base + perLevel * (lv - 1);
  return Math.round(raw * RICHNESS[ring] * depletion(e, ring, d));
}
