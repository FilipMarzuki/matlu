/**
 * Region 1.5 trade (#1247, epic #1235): sell what you made, and restock for
 * the road.
 *
 * One currency, **marks** — caravan scrip honoured from Hollowford to the
 * Gate. Simpler for players and the AI than barter: every item has one base
 * value, and the price is that value times a few plain multipliers:
 *
 *   selling  = base × grade × (wanted ? 1.5 : 1) × (trust ≥ 50 ? 1.1 : 1) ÷ CHA factor
 *   buying   = base × 1.25 × (trust ≥ 50 ? 0.9 : 1) × CHA factor
 *
 * The total for a lot is rounded once (not per unit), so ten cheap things
 * aren't rounded away to nothing.
 *
 * Pure data plus pure helpers; road.ts holds the marks and runs the actions.
 */

import type { Grade } from './crafting';
import type { Stores } from './region1';

/** A store good: what you carry by the heap rather than as a tool. */
export type Good = keyof Stores;

const GOODS: readonly Good[] = ['rawFood', 'water', 'firewood', 'materials', 'rations', 'stone', 'hides'];
export const isGood = (item: string): item is Good => (GOODS as readonly string[]).includes(item);

/**
 * What one of each thing is worth at sound grade. Store goods are fixed;
 * a crafted item is worth twice its inputs (the inputs plus your work), so
 * cold gear — three materials — is 6.
 */
export const BASE_VALUE: Readonly<Record<string, number>> = {
  rawFood: 1, water: 1, firewood: 1, materials: 1, stone: 1, rations: 2, hides: 3,
  'cold-gear': 6, bedroll: 6, basket: 4,
  'hide-parka': 14, waterskin: 8, backpack: 10, harness: 8,
  'stone-knife': 4, 'trap-snare': 4, 'crude-shovel': 4, sled: 10,
};

/** Grade sets the price — steeper than it sets the effect, because buyers pay for the look of quality too. */
export const PRICE_GRADE: Readonly<Record<Grade, number>> = { crude: 0.5, sound: 1, fine: 1.6, masterwork: 2.5 };

/** Kinds of goods a trader can want. */
export type Kind = 'food' | 'water' | 'fuel' | 'raw' | 'leather' | 'cloth' | 'tools';

/** What kind each thing is. */
export const KIND_OF: Readonly<Record<string, Kind>> = {
  rawFood: 'food', rations: 'food', water: 'water', firewood: 'fuel', materials: 'raw', stone: 'raw', hides: 'leather',
  'cold-gear': 'cloth', bedroll: 'cloth', basket: 'cloth',
  'hide-parka': 'leather', waterskin: 'leather', backpack: 'leather', harness: 'leather',
  'stone-knife': 'tools', 'trap-snare': 'tools', 'crude-shovel': 'tools', sled: 'tools',
};

/** What a trader wants (paying ×WANTED for it) and what they sell (any amount — the caravan restocks them). */
export interface TraderStock { wants: readonly [Kind, Kind]; sells: readonly Good[] }

/** Per trader, by person id (villages.ts). Each village has one. */
export const TRADER_STOCK: Readonly<Record<string, TraderStock>> = {
  // "Hides, salt, a good knife — I buy what travels well."
  'hf-tobin': { wants: ['leather', 'tools'], sells: ['rawFood', 'water', 'materials', 'hides'] },
  // Salt fish and the mere's weavers: she wants food to salt and cloth to sell on.
  'sm-hedda': { wants: ['food', 'cloth'], sells: ['rations', 'rawFood', 'water', 'firewood'] },
  // "Mistheim buys Reach-made tools for silly money." And the Gate burns a lot of wood.
  'kg-arvid': { wants: ['tools', 'fuel'], sells: ['rawFood', 'water', 'firewood', 'materials', 'stone'] },
};

/** A wanted kind pays this much more. */
export const WANTED = 1.5;
/** Traders sell at this markup over base. */
export const MARKUP = 1.25;
/** Trust at or above this earns the friend's rate: 10% off buying, 10% on selling. */
export const FRIEND_TRUST = 50, FRIEND_RATE = 0.1;
/** A trade (a sale or a purchase) takes this long. */
export const TRADE_HOURS = 1;
/** A completed sale earns the trader's trust this much. */
export const SALE_TRUST = 1;

/** The base value of `qty` of `item` at `grade` (store goods have no grade: sound). */
export const valueOf = (item: string, grade: Grade = 'sound', qty = 1): number => (BASE_VALUE[item] ?? 0) * PRICE_GRADE[grade] * qty;

/** What the deal looks like from this trader: their wants, your trust with them, and your Charisma's price factor. */
export interface Terms { wants: readonly Kind[]; trust: number; priceFactor: number }

/** Marks you're paid for `qty` of `item` at `grade`. */
export function sellPrice(item: string, grade: Grade, qty: number, t: Terms): number {
  const wanted = t.wants.includes(KIND_OF[item]) ? WANTED : 1;
  const friend = t.trust >= FRIEND_TRUST ? 1 + FRIEND_RATE : 1;
  return Math.round((valueOf(item, grade, qty) * wanted * friend) / t.priceFactor);
}

/** Marks you pay for `qty` of a good. */
export function buyPrice(item: Good, qty: number, t: Terms): number {
  const friend = t.trust >= FRIEND_TRUST ? 1 - FRIEND_RATE : 1;
  return Math.round(valueOf(item, 'sound', qty) * MARKUP * friend * t.priceFactor);
}

/** The trader among these people, or null — "No one here is trading". */
export const traderAmong = <P extends { id: string; role: string }>(people: readonly P[]): P | null =>
  people.find(p => p.role === 'trader' && TRADER_STOCK[p.id]) ?? null;

/**
 * Parse a trade action's target: `item`, `item:qty` or `item:grade`. One unit
 * by default; a grade picks which copy of a tool to sell.
 */
export function parseLot(spec: string): { item: string; qty: number; grade: Grade | null } {
  const [item, arg] = spec.split(':');
  if (arg === undefined) return { item, qty: 1, grade: null };
  if (/^\d+$/.test(arg)) return { item, qty: Math.max(1, Number(arg)), grade: null };
  return { item, qty: 1, grade: (['crude', 'sound', 'fine', 'masterwork'] as const).find(g => g === arg) ?? null };
}
