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

/** What gear does to awkwardness: an item's awkwardness with the gear you carry (never its weight). */
export type Gear = Partial<Record<LoadItem, number>>;

/** The awkwardness your tools give (#1291): a waterskin makes water as easy as anything. Baskets, packs and sleds come in #1294. */
export function gearOf(tools: readonly { item: string }[]): Gear {
  return tools.some(t => t.item === 'waterskin') ? { water: 1 } : {};
}

const awk = (item: LoadItem, gear: Gear): number => gear[item] ?? AWKWARDNESS[item];
const items = (h: Haul): LoadItem[] => (Object.keys(h) as LoadItem[]).filter(k => (h[k] ?? 0) > 0);

/** The most weight a body can lift at all: 40 stones at STR 10, 3 more per point. Gear never raises it. */
export const maxLoad = (stats: Pick<Stats, 'str'>): number => 40 + 3 * (stats.str - 10);

/** A load you can carry all day without paying for it: 40% of the max. */
export const comfortableLoad = (stats: Pick<Stats, 'str'>): number => 0.4 * maxLoad(stats);

/** Raw weight of a haul, in stones. */
export const rawWeight = (h: Haul): number => items(h).reduce((n, k) => n + (h[k] ?? 0) * WEIGHT[k], 0);

/** How cumbersome a haul is: weight × awkwardness, with what your gear does to it. */
export const cumbersome = (h: Haul, gear: Gear = {}): number => items(h).reduce((n, k) => n + (h[k] ?? 0) * WEIGHT[k] * awk(k, gear), 0);

/** The overload ratio: cumbersome load over the comfortable load (1 is the edge of comfortable; #1292 makes more cost). */
export const overloadRatio = (h: Haul, gear: Gear, stats: Pick<Stats, 'str'>): number => cumbersome(h, gear) / comfortableLoad(stats);

/**
 * What of a haul you can carry home (pure): units are left behind, heaviest
 * first (the most cumbersome among equals), until the raw weight and the
 * cumbersome load both fit the max.
 */
export function fitHaul(haul: Haul, gear: Gear, stats: Pick<Stats, 'str'>): { carried: Haul; left: Haul } {
  const max = maxLoad(stats);
  const carried: Haul = { ...haul };
  const left: Haul = {};
  const order = items(haul).sort((a, b) => WEIGHT[b] - WEIGHT[a] || WEIGHT[b] * awk(b, gear) - WEIGHT[a] * awk(a, gear));
  const fits = (): boolean => rawWeight(carried) <= max + 1e-9 && cumbersome(carried, gear) <= max + 1e-9;
  for (const k of order) {
    while (!fits() && (carried[k] ?? 0) > 0) {
      carried[k] = (carried[k] ?? 0) - 1;
      left[k] = (left[k] ?? 0) + 1;
    }
  }
  return { carried, left };
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
