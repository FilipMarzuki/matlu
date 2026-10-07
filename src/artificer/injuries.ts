/**
 * Injuries (#1392, epic #1391): an accident can leave you hurt for a while — and how badly decides
 * how it heals. A minor injury mends in a few nights and leaves no trace; a serious one heals
 * slowly, and only if you look after yourself; a grave one heals, but leaves a lasting harm that
 * stays with the character into every later run.
 *
 * Healing is counted in points, not days: each good night (fed, watered, warm) mends one, a light
 * restful day before it one more, Constitution scales it, and a hungry or cold night mends none.
 * Working hard through a serious injury can make it grave.
 *
 * Pure: region1.ts rolls the severity when an accident injures you, ticks healing in the shared
 * night, and applies what an injury and a lasting harm cost.
 */

import { streamFor } from './rng';

/** What an injury is: a sprain (legwork costs more), a hurt hand (crafting is slower), a deep cut (it bleeds you). */
export type InjuryKind = 'sprain' | 'hand' | 'cut';
export type Severity = 'minor' | 'serious' | 'grave';
export const SEVERITIES: readonly Severity[] = ['minor', 'serious', 'grave'];

/** An open injury: its kind and severity, and the healing it still needs, in points. */
export interface Injury { kind: InjuryKind; severity: Severity; heal: number }

/** Healing a fresh injury needs, by severity. */
export const HEAL_POINTS: Readonly<Record<Severity, number>> = { minor: 2, serious: 6, grave: 10 };

/** How often each severity comes, rolled when the accident happens: minor 60%, serious 30%, grave 10%. */
export const SEVERITY_ODDS: Readonly<Record<Severity, number>> = { minor: 0.6, serious: 0.3, grave: 0.1 };

/**
 * How bad an injury is (#1392): a seeded roll for the hour it happened — minor, serious or grave —
 * one step worse if you set out exhausted, never past grave.
 */
export function severityOf(seed: number, day: number, hour: number, tired: boolean): Severity {
  const u = streamFor(seed, day, `injury@${Math.floor(hour)}`)();
  const i = u < SEVERITY_ODDS.minor ? 0 : u < SEVERITY_ODDS.minor + SEVERITY_ODDS.serious ? 1 : 2;
  return SEVERITIES[Math.min(2, i + (tired ? 1 : 0))];
}

/** A fresh injury. */
export const injure = (kind: InjuryKind, severity: Severity): Injury => ({ kind, severity, heal: HEAL_POINTS[severity] });

/** What an open injury costs while it lasts: legwork for a sprain, craft time for a hand, both × this. */
export const INJURY_COST: Readonly<Record<Severity, number>> = { minor: 1.3, serious: 1.3, grave: 1.5 };
/** The worst cost among your injuries of a kind (1 when you have none). */
export const injuryCost = (injuries: readonly Injury[] | undefined, kind: InjuryKind): number =>
  Math.max(1, ...(injuries ?? []).filter(i => i.kind === kind).map(i => INJURY_COST[i.severity]));
/** A deep cut bleeds you a little each night it's open. */
export const CUT_BLEED = 1;

/** A night's healing, in points: 1 for a good night (fed, watered, not cold), +1 after a light day, × Constitution. None after a bad night. */
export function nightHealing(o: { ate: boolean; drank: boolean; cold: boolean; restful: boolean; healFactor: number }): number {
  if (!o.ate || !o.drank || o.cold) return 0;
  return (1 + (o.restful ? 1 : 0)) * o.healFactor;
}

/** Working through a serious injury (#1392): each heavy job (or craft, for a hand) has this chance to make it grave. */
export const AGGRAVATE_CHANCE = 0.15;
/** The work heavy enough to worsen a serious sprain. */
export const HEAVY_WORK: readonly string[] = ['wood', 'quarry', 'hunt', 'build'];
/** Does this work strain an injury of this kind? (Ring 3 is a long walk: heavy for a sprain.) */
export const strains = (kind: InjuryKind, action: string, ring: number, craft: boolean): boolean =>
  kind === 'sprain' ? !craft && (HEAVY_WORK.includes(action) || ring === 3) : kind === 'hand' ? craft : false;

/** A grave injury, once healed, leaves its mark (#1392) — and it goes with the character into every later run. */
export type Harm = 'stiff-knee' | 'weak-grip' | 'scar';
export const HARM_OF: Readonly<Record<InjuryKind, Harm>> = { sprain: 'stiff-knee', hand: 'weak-grip', cut: 'scar' };
/** A stiff knee: the walk out to the far rings costs this much more Vigor. */
export const STIFF_KNEE_COST = 1.1;
/** A weak grip: crafts come out a step worse (on the grade score). */
export const WEAK_GRIP_GRADE = -1;
/** A scar: the old wound aches on cold nights, costing Clarity. */
export const SCAR_ACHE = 2;

/** What the journal says. */
export const INJURY_NAME: Readonly<Record<InjuryKind, string>> = { sprain: 'sprained ankle', hand: 'hurt hand', cut: 'deep cut' };
export const HARM_NAME: Readonly<Record<Harm, string>> = { 'stiff-knee': 'a stiff knee', 'weak-grip': 'a weak grip', scar: 'a scar' };
export const HARM_WORDS: Readonly<Record<Harm, string>> = {
  'stiff-knee': 'the walk out to the far rings costs more',
  'weak-grip': 'your crafts come out a little worse',
  scar: 'it aches on cold nights',
};
export const healingLine = (i: Injury): string =>
  `Your ${INJURY_NAME[i.kind]} (${i.severity}) is mending — ${Math.ceil(i.heal)} more to heal.`;
export const healedLine = (i: Injury, harm: Harm | null): string =>
  harm ? `Your ${INJURY_NAME[i.kind]} has healed, but it has left you with ${HARM_NAME[harm]}: ${HARM_WORDS[harm]}.` : `Your ${INJURY_NAME[i.kind]} has healed clean.`;
export const notHealingLine = (i: Injury): string => `Your ${INJURY_NAME[i.kind]} didn't mend tonight — it needs food, water and warmth.`;

/** An injury from an older save (#1286): `daysLeft`, no severity. Read as a minor one with that much healing left. */
export function readInjury(x: unknown): Injury | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  if (o.kind !== 'sprain' && o.kind !== 'hand' && o.kind !== 'cut') return null;
  const severity = SEVERITIES.includes(o.severity as Severity) ? o.severity as Severity : 'minor';
  const heal = typeof o.heal === 'number' ? o.heal : typeof o.daysLeft === 'number' ? o.daysLeft : HEAL_POINTS[severity];
  return { kind: o.kind, severity, heal };
}
