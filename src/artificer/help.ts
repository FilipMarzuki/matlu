/**
 * What counts as helping someone (#1659), and what it does to them and to the people tied to them.
 *
 * The road keeps the Warden's dealings with people as a list of **help deeds**, in the order they
 * happened: each trade (a sale to someone, or a purchase from them) and each job finished for
 * someone. What they do is read off that list by one pure function, `helpEffects`, never folded
 * into a number as they happen: the trust they add is worked out from the list, deed by deed, so
 * a later reading of the same history (#1663: what people come to expect of the Warden from a track
 * record of fair dealing and kept word, carried along ties) reads exactly what this one does.
 *
 * What helping is:
 * - **a fair trade**: their price, paid or got. A sale already earns the trader's trust (trade.ts
 *   SALE_TRUST); with this, a purchase does too.
 * - **custom**: the first trade with someone on a road day is a visit. Come back on a later day and
 *   you're a regular: CUSTOM_TRUST more each day you come back, which reaches their ties as help
 *   does. So three days at one shop are worth more than three sales in one.
 * - **a job done for them**: the quest's own reward is unchanged (quests.ts QUEST_TRUST); with this,
 *   it reaches their ties.
 * - **through their ties** (ties.ts `helpRipples`): help someone and their kin and friends warm to
 *   you, and their rival, or whoever holds a grudge against them, sees you take their side and cools.
 *
 * The effects are what helping adds over the rules before it: with the `grudges-and-help` switch
 * off, road.ts records no deeds and nothing here is read.
 *
 * Pure and deterministic: deeds in, trust per person out.
 */

import { featureOn, type FeatureSwitches } from './features';
import { QUEST_TRUST } from './quests';
import { SALE_TRUST } from './trade';
import { helpRipples } from './ties';

/** One dealing with someone, as the road records it: a sale to them, a purchase from them, or a job done for them. */
export interface HelpDeed {
  /** The road day it happened. */
  day: number;
  /** Who it was for: the trader, or the quest's giver. */
  who: string;
  kind: 'sold' | 'bought' | 'task';
  /** The quest, for a job done. */
  quest?: string;
}

/** A regular's welcome: trust a trader gives you each later day you come back to trade with them. */
export const CUSTOM_TRUST = 3;

const isTrade = (d: HelpDeed): boolean => d.kind === 'sold' || d.kind === 'bought';

/** Whether `deed`, after `history`, is coming back to someone's shop: their first trade that day, after a trade on an earlier one. */
export function returnVisit(history: readonly HelpDeed[], deed: HelpDeed): boolean {
  if (!isTrade(deed)) return false;
  const before = history.filter(d => isTrade(d) && d.who === deed.who);
  return before.length > 0 && !before.some(d => d.day === deed.day);
}

/**
 * What one deed, after `history`, does: the trust each person gains or loses by it, by id. Who it
 * was for first, then their ties. Ripples along ties only with `ties` on too (there are none without it).
 */
export function deedEffects(history: readonly HelpDeed[], deed: HelpDeed, features: FeatureSwitches | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (pid: string, d: number) => { if (d) out[pid] = (out[pid] ?? 0) + d; };
  if (deed.kind === 'bought') add(deed.who, SALE_TRUST);
  // How much help reaches their ties: a regular's custom, or a job's worth.
  let help = 0;
  if (returnVisit(history, deed)) { add(deed.who, CUSTOM_TRUST); help = CUSTOM_TRUST; }
  if (deed.kind === 'task') help = QUEST_TRUST;
  if (help && featureOn(features, 'ties')) for (const [pid, d] of Object.entries(helpRipples(deed.who, help, features))) add(pid, d);
  return out;
}

/** What a whole history of deeds does, deed by deed in order: the trust each person gains or loses by them. */
export function helpEffects(deeds: readonly HelpDeed[], features: FeatureSwitches | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  deeds.forEach((deed, i) => {
    for (const [pid, d] of Object.entries(deedEffects(deeds.slice(0, i), deed, features))) out[pid] = (out[pid] ?? 0) + d;
  });
  return out;
}
