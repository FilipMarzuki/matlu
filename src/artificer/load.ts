/**
 * Carrying (#1291, epic #1290): what a trip can actually bring home.
 *
 * Loads are measured in **stones** (abstract, kilogram-like). Two numbers
 * decide what's feasible:
 *  - the **theoretical max** — how much weight a body can lift at all; gear
 *    never raises it;
 *  - the **cumbersome load** — weight × awkwardness. Loose food in your arms
 *    is awkward; a waterskin makes water easier to carry. Gear lowers
 *    awkwardness, never weight.
 * A haul is feasible when its raw weight ≤ max **and** its cumbersome load ≤
 * max. Anything beyond is left behind, heaviest first.
 *
 * Overload effects (#1292), strain (#1293) and more gear (#1294) build on this.
 * Pure: Region 1 fits each trip's haul before it reaches the stores.
 */

import type { Stats } from './stats';

/** What a trip can bring home: the store items that have weight. */
export type LoadItem = 'rawFood' | 'rations' | 'water' | 'firewood' | 'materials' | 'stone' | 'hides';
export type Haul = Partial<Record<LoadItem, number>>;

/** Weight per unit, in stones. */
export const WEIGHT: Readonly<Record<LoadItem, number>> = { rawFood: 1, rations: 0.5, water: 2, firewood: 2, materials: 1, stone: 3, hides: 3 };

/** How awkward each item is to carry with no gear: loose food in your arms, long bulky wood, water with no vessel. */
export const AWKWARDNESS: Readonly<Record<LoadItem, number>> = { rawFood: 1.5, rations: 1, water: 1.5, firewood: 1.6, materials: 1.5, stone: 1.3, hides: 1.4 };

/**
 * What gear does to a load (#1294): per item, its awkwardness (`awk`) and the
 * share of its weight that counts toward the bulk (`weight` — a sled drags
 * what's on it), plus a flat `extra` for gear that is itself a burden (the
 * sled, dragged even when empty). Gear never touches the max load.
 */
export interface Gear {
  awk: Partial<Record<LoadItem, number>>;
  weight: Partial<Record<LoadItem, number>>;
  extra: number;
}
/** A tool as carrying needs it: what it is and how well it was made (missing grade counts as sound). */
export interface GearTool { item: string; grade?: string }
/** Where the haul is carried: the ring, and whether there's snow underfoot (a sled runs on it). */
export interface CarryContext { ring: number; snow: boolean }

/** The carrying gear (#1294): what each piece eases. */
export const GEAR_ITEMS = ['basket', 'backpack', 'harness', 'sled'] as const;
export type GearItem = typeof GEAR_ITEMS[number];

/** The backpack's share off everything, and the least awkwardness it can bring anything to. */
export const BACKPACK = 0.8;
/** On a sled, heavy things count this share of their weight: on snow or level ground (rings 1–2), and in the broken hills (ring 3). */
export const SLED_LEVEL = 0.5, SLED_HILLS = 0.8;
/** The sled itself, dragged along. */
export const SLED_EXTRA = 4;
const SLED_ITEMS: readonly LoadItem[] = ['stone', 'firewood', 'hides'];

/** Crude gear gives half the improvement (#1294). */
const eased = (from: number, to: number, crude: boolean): number => (crude ? from - (from - to) / 2 : to);

/**
 * The gear your tools give for a haul carried in `ctx` (#1294). The basket, harness and waterskin
 * each bring some items down to a set awkwardness; the backpack then takes a share off everything
 * (never below 0.8); the sled — when `withSled` — lightens what's dragged on it but adds itself.
 */
export function gearOf(tools: readonly GearTool[], ctx: CarryContext = { ring: 1, snow: false }, withSled = true): Gear {
  const grade = (item: string): 'crude' | 'sound' | null => {
    const t = tools.filter(x => x.item === item);
    if (!t.length) return null;
    return t.some(x => x.grade !== 'crude') ? 'sound' : 'crude';
  };
  const awk: Partial<Record<LoadItem, number>> = {};
  const ease = (item: LoadItem, to: number, g: 'crude' | 'sound'): void => {
    awk[item] = Math.min(awk[item] ?? AWKWARDNESS[item], eased(AWKWARDNESS[item], to, g === 'crude'));
  };
  const skin = grade('waterskin'), basket = grade('basket'), harness = grade('harness'), pack = grade('backpack'), sled = grade('sled');
  if (skin) ease('water', 1, skin);
  if (basket) { ease('rawFood', 1, basket); ease('materials', 1, basket); }
  if (harness) { ease('firewood', 1.1, harness); ease('stone', 1, harness); ease('hides', 1, harness); }
  if (pack) {
    const f = eased(1, BACKPACK, pack === 'crude');
    for (const k of Object.keys(WEIGHT) as LoadItem[]) awk[k] = Math.max(BACKPACK, (awk[k] ?? AWKWARDNESS[k]) * f);
  }
  const weight: Partial<Record<LoadItem, number>> = {};
  let extra = 0;
  if (sled && withSled) {
    const f = eased(1, ctx.snow || ctx.ring <= 2 ? SLED_LEVEL : SLED_HILLS, sled === 'crude');
    for (const k of SLED_ITEMS) weight[k] = f;
    extra = SLED_EXTRA;
  }
  return { awk, weight, extra };
}

const NO_GEAR: Gear = { awk: {}, weight: {}, extra: 0 };

const items = (h: Haul): LoadItem[] => (Object.keys(h) as LoadItem[]).filter(k => (h[k] ?? 0) > 0);
const awkOf = (item: LoadItem, gear: Gear): number => gear.awk[item] ?? AWKWARDNESS[item];
/** One unit's bulk: its weight (the share that counts) × its awkwardness. */
const bulkOf = (item: LoadItem, gear: Gear): number => WEIGHT[item] * (gear.weight[item] ?? 1) * awkOf(item, gear);

/** The most weight a body can lift at all: 40 stones at STR 10, 3 more per point. Gear never raises it. */
export const maxLoad = (stats: Pick<Stats, 'str'>): number => 40 + 3 * (stats.str - 10);

/** A load you can carry all day without paying for it: 40% of the max. */
export const comfortableLoad = (stats: Pick<Stats, 'str'>): number => 0.4 * maxLoad(stats);

/** Raw weight of a haul, in stones. */
export const rawWeight = (h: Haul): number => items(h).reduce((n, k) => n + (h[k] ?? 0) * WEIGHT[k], 0);

/** How cumbersome a haul is: weight × awkwardness, with what your gear does to it. */
export const cumbersome = (h: Haul, gear: Gear = NO_GEAR): number => items(h).reduce((n, k) => n + (h[k] ?? 0) * bulkOf(k, gear), gear.extra);

/** The overload ratio: cumbersome load over the comfortable load (1 is the edge of comfortable; #1292 makes more cost). */
export const overloadRatio = (h: Haul, gear: Gear = NO_GEAR, stats: Pick<Stats, 'str'>): number => cumbersome(h, gear) / comfortableLoad(stats);

/**
 * What of a haul you can carry home (pure): units are left behind, heaviest
 * first (the most cumbersome among equals), until the raw weight and the
 * cumbersome load both fit the max.
 */
export function fitHaul(haul: Haul, gear: Gear = NO_GEAR, stats: Pick<Stats, 'str'>): { carried: Haul; left: Haul } {
  const max = maxLoad(stats);
  const carried: Haul = { ...haul };
  const left: Haul = {};
  const order = items(haul).sort((a, b) => WEIGHT[b] - WEIGHT[a] || bulkOf(b, gear) - bulkOf(a, gear));
  const fits = (): boolean => rawWeight(carried) <= max + 1e-9 && cumbersome(carried, gear) <= max + 1e-9;
  for (const k of order) {
    while (!fits() && (carried[k] ?? 0) > 0) {
      carried[k] = (carried[k] ?? 0) - 1;
      left[k] = (left[k] ?? 0) + 1;
    }
  }
  return { carried, left };
}

/**
 * The gear to carry a haul home with (#1294): with the sled or without it, whichever brings more
 * home — and, carrying the same, the lighter load. (A sled is worth dragging only for a heavy haul.)
 */
export function bestGear(tools: readonly GearTool[], ctx: CarryContext, haul: Haul, stats: Pick<Stats, 'str'>): Gear {
  const options = [gearOf(tools, ctx, false), gearOf(tools, ctx, true)];
  const score = (g: Gear) => { const { carried } = fitHaul(haul, g, stats); return [rawWeight(carried), -cumbersome(carried, g)]; };
  return options.reduce((best, g) => { const [a, b] = score(g), [c, d] = score(best); return a > c || (a === c && b > d) ? g : best; });
}

const NAMES: Readonly<Record<LoadItem, [string, string]>> = {
  rawFood: ['raw food', 'raw food'], rations: ['ration', 'rations'], water: ['water', 'water'], firewood: ['firewood', 'firewood'],
  materials: ['materials', 'materials'], stone: ['stone', 'stone'], hides: ['hide', 'hides'],
};

/** The journal line for what was left behind, or null when nothing was. */
export function leftLine(left: Haul): string | null {
  const parts = items(left).map(k => `${left[k]} ${NAMES[k][(left[k] ?? 0) === 1 ? 0 : 1]}`);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `You leave ${list} behind — too much to carry.`;
}

// ── Overload (#1292) ────────────────────────────────────────────────────────────

/** How much longer the walk takes at overload ratio `r`: 30% more per unit over comfortable. */
export const overloadSlow = (r: number): number => 1 + 0.3 * Math.max(0, r - 1);
/** How much more Vigor the laden walk costs in all: 60% more per unit over comfortable. */
export const overloadDrain = (r: number): number => 1 + 0.6 * Math.max(0, r - 1);
/** How much likelier a fall or a strain is at `r` (for accidents, #1285): 150% more per unit over comfortable. */
export const overloadRisk = (r: number): number => 1 + 1.5 * Math.max(0, r - 1);

/**
 * What a laden walk adds (pure): `hours` walked unladen at `vigorRate` (a
 * negative drain per hour) become `overloadSlow(r)` times as long and cost
 * `overloadDrain(r)` times the Vigor in all. Nothing at or under comfortable.
 */
export function overloadWalk(r: number, hours: number, vigorRate: number): { extraHours: number; extraVigor: number } {
  if (r <= 1 || hours <= 0) return { extraHours: 0, extraVigor: 0 };
  return { extraHours: hours * (overloadSlow(r) - 1), extraVigor: hours * vigorRate * (overloadDrain(r) - 1) };
}

/** How the load felt, for the journal: null when it was comfortable. */
export function overloadWord(r: number): string | null {
  if (r <= 1) return null;
  return r <= 1.5 ? 'with a heavy load' : r <= 2 ? 'staggering under the load' : 'barely able to carry it';
}
