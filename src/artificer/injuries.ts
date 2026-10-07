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

/** How well an injury was tended (#1393): a fair treatment heals +1 a night, a good one +2. */
export type Treatment = 'fair' | 'good';

/**
 * An open injury: its kind and severity, the healing it still needs (in points), and how it was tended,
 * if it was. `mended`: a healer set it properly (#1394) — a grave one then heals without a lasting harm.
 */
export interface Injury { kind: InjuryKind; severity: Severity; heal: number; treated?: Treatment; mended?: true }

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
/** The night's mending, in what you understand of it (#1410): the severity from Apprentice First aid, the nights left from Adept. */
export const healingLine = (i: Injury, firstAid: number = KNOWS.everything): string => {
  const v = injuryView(i, firstAid);
  return `Your ${v.name}${v.severity ? ` (${v.severity})` : ''} is mending${v.nights !== undefined ? ` — about ${v.nights} more good night${v.nights === 1 ? '' : 's'}` : ''}.`;
};
export const healedLine = (i: Injury, harm: Harm | null): string =>
  harm ? `Your ${INJURY_NAME[i.kind]} has healed, but it has left you with ${HARM_NAME[harm]}: ${HARM_WORDS[harm]}.` : `Your ${INJURY_NAME[i.kind]} has healed clean.`;
export const notHealingLine = (i: Injury, firstAid: number = KNOWS.everything): string => `Your ${injuryView(i, firstAid).name} didn't mend tonight — it needs food, water and warmth.`;

// ── Treatment (#1393) ───────────────────────────────────────────────────────

/** A treated injury heals this much more on every night that heals at all. */
export const TREAT_BONUS: Readonly<Record<Treatment, number>> = { fair: 1, good: 2 };
/** An untreated serious deep cut can go bad overnight: this chance a night, and it costs this much Condition. */
export const FESTER_CHANCE = 0.1, FESTER_CONDITION = 5;

/** The injury `treat` tends: the worst untreated one (most severe, then most healing to go). */
export function worstUntreated(injuries: readonly Injury[] | undefined): Injury | null {
  const open = (injuries ?? []).filter(i => !i.treated);
  if (!open.length) return null;
  return open.reduce((a, b) => (HEAL_POINTS[b.severity] > HEAL_POINTS[a.severity] || (b.severity === a.severity && b.heal > a.heal) ? b : a));
}

/** What a treatment is made with, and what it costs from the stores. */
export type TreatVia = 'dressing' | 'cloth' | 'hide' | 'splint' | 'herbs';
export interface TreatPlan { via: TreatVia; cost: Partial<Record<'materials' | 'hides' | 'firewood' | 'rawFood', number>>; dressing: boolean; better: boolean }

/**
 * How you'd tend an injury with what you have: a first-aid kit dressing for anything (and one step
 * better); otherwise improvised — a cut bound with materials (or a hide, a better dressing, when
 * there are no materials), a sprain splinted with a stick and lashing (1 firewood, 1 materials),
 * a hurt hand eased with herbs (1 food, foraged greens). Null when you have nothing that will do.
 */
export function treatmentFor(kind: InjuryKind, stores: { materials: number; hides: number; firewood: number; rawFood: number }, dressings: number): TreatPlan | null {
  if (dressings > 0) return { via: 'dressing', cost: {}, dressing: true, better: true };
  if (kind === 'cut') return stores.materials >= 1 ? { via: 'cloth', cost: { materials: 1 }, dressing: false, better: false }
    : stores.hides >= 1 ? { via: 'hide', cost: { hides: 1 }, dressing: false, better: true } : null;
  if (kind === 'sprain') return stores.firewood >= 1 && stores.materials >= 1 ? { via: 'splint', cost: { firewood: 1, materials: 1 }, dressing: false, better: false } : null;
  return stores.rawFood >= 1 ? { via: 'herbs', cost: { rawFood: 1 }, dressing: false, better: false } : null;
}

/** Why there's nothing to tend this injury with. */
export const NO_TREATMENT: Readonly<Record<InjuryKind, string>> = {
  cut: 'binding a cut needs a dressing, 1 materials or a hide',
  sprain: 'a splint needs 1 firewood and 1 materials',
  hand: 'easing a hurt hand needs herbs — 1 food',
};

/** How good a treatment is: half your First aid level, +1 for a better dressing; 2 or more is good. */
export const treatmentQuality = (firstAidLevel: number, better: boolean): Treatment =>
  Math.floor(firstAidLevel / 2) + (better ? 1 : 0) >= 2 ? 'good' : 'fair';

const TREAT_WORDS: Readonly<Record<TreatVia, (name: string) => string>> = {
  dressing: n => `You clean the ${n} and dress it from the first-aid kit`,
  cloth: n => `You wash the ${n} and bind it with a strip of cloth`,
  hide: n => `You wash the ${n} and bind it with soft hide`,
  splint: n => `You splint the ${n} with a straight stick and lash it firm`,
  herbs: n => `You crush yarrow and plantain into a poultice for the ${n}`,
};
export const treatLine = (i: Injury, via: TreatVia, quality: Treatment): string =>
  `${TREAT_WORDS[via](INJURY_NAME[i.kind])} — ${quality === 'good' ? 'well done; it will mend faster' : 'it will mend a little faster'}.`;
export const festerLine = (i: Injury): string => `The ${INJURY_NAME[i.kind]} has gone bad overnight — hot, red and angry. It's grave now.`;

/** An injury from an older save (#1286): `daysLeft`, no severity. Read as a minor one with that much healing left. */
export function readInjury(x: unknown): Injury | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  if (o.kind !== 'sprain' && o.kind !== 'hand' && o.kind !== 'cut') return null;
  const severity = SEVERITIES.includes(o.severity as Severity) ? o.severity as Severity : 'minor';
  const heal = typeof o.heal === 'number' ? o.heal : typeof o.daysLeft === 'number' ? o.daysLeft : HEAL_POINTS[severity];
  return { kind: o.kind, severity, heal, ...(o.treated === 'fair' || o.treated === 'good' ? { treated: o.treated } : {}), ...(o.mended === true ? { mended: true as const } : {}) };
}

// ── Healers on the road (#1394) ─────────────────────────────────────────────

/** A healer's care: an hour, free for a friend (trust 40+), else this many marks; it heals this much at once. */
export const HEAL_HOURS = 1, HEAL_FEE = 4, FRIEND_HEAL = 40, HEALER_POINTS = 2;
/** Trust at which a healer will set a grave injury properly, so it heals without a lasting harm. */
export const SET_BONE_TRUST = 60;

/**
 * What a healer would tend (#1394): a grave injury not yet set, if they trust you enough to set
 * it; else the worst untreated one; else nothing.
 */
export function healerTarget(injuries: readonly Injury[] | undefined, trust: number): Injury | null {
  const grave = trust >= SET_BONE_TRUST ? (injuries ?? []).find(i => i.severity === 'grave' && !i.mended) : undefined;
  return grave ?? worstUntreated(injuries);
}

/** A healer's care applied: treated well, two points healed now, and — at trust 60+ — a grave one set properly. */
export const healerCare = (i: Injury, trust: number): Injury =>
  ({ ...i, treated: 'good', heal: Math.max(0, i.heal - HEALER_POINTS), ...(i.severity === 'grave' && trust >= SET_BONE_TRUST ? { mended: true as const } : {}) });

/** What a healer says of an old harm (#1394): it can't be undone, but it can be understood. */
export const HARM_LORE: Readonly<Record<Harm, string>> = {
  'stiff-knee': 'It knitted crooked. Keep it warm and it will carry you; push it on the long walks and it will remind you.',
  'weak-grip': 'The tendons healed short. Fine work will always cost you a little — but hands learn around a wound.',
  scar: 'An old cut, closed well enough. It will ache when the weather turns. That is all it will do.',
};

// ── Showing injuries (#1395) ────────────────────────────────────────────────

/** An injury this work could make worse (#1395): a serious, untreated one it strains — the same rule the sim rolls. */
export const atRisk = (injuries: readonly Injury[] | undefined, action: string, ring: number, craft: boolean): Injury | null =>
  (injuries ?? []).find(i => i.severity === 'serious' && !i.treated && strains(i.kind, action, ring, craft)) ?? null;

const SHORT_NAME: Readonly<Record<InjuryKind, string>> = { sprain: 'sprain', hand: 'hurt hand', cut: 'cut' };
/** The queue's warning for work that could make an injury worse. */
export const riskLine = (i: Injury): string => `🩹 could make your ${SHORT_NAME[i.kind]} worse`;

/** Could this injury get worse, from work or by itself (an untreated serious cut can fester)? */
export const canWorsen = (i: Injury): boolean => i.severity === 'serious' && !i.treated;

// ── What you understand (#1410) ─────────────────────────────────────────────

/**
 * The First aid levels at which you understand more of an injury (#1410). Pain is felt by
 * everyone (#1409); First aid turns it into understanding.
 */
export const KNOWS = { badness: 1, severity: 2, nights: 3, everything: 4 } as const;

/** What you understand of an injury, at a First aid level. Absent fields are what you don't know. */
export interface InjuryView {
  /** What you call it: "ankle" untrained, "bad sprain" at Novice, "sprained ankle" from Apprentice. */
  name: string;
  /** Novice: light (minor) or bad (serious or grave). */
  badness?: 'light' | 'bad';
  /** Apprentice: the severity — and whether heavy work could make it worse (the queue warning). */
  severity?: Severity;
  risk?: boolean;
  /** Adept: about how many good nights it still needs (a treated one heals faster). */
  nights?: number;
  /** Journeyman: an untreated serious cut could fester; the chance of worsening; whether a grave one will leave a mark. */
  festers?: boolean;
  worsenChance?: number;
  willMark?: boolean;
  treated?: Treatment;
}

const PLAIN: Readonly<Record<InjuryKind, string>> = { sprain: 'ankle', hand: 'hand', cut: 'cut' };
const BAD: Readonly<Record<InjuryKind, string>> = { sprain: 'sprain', hand: 'hurt hand', cut: 'cut' };

/** What an injury looks like to someone with this much First aid (#1410). The screen, the journal and the AI all read it. */
export function injuryView(i: Injury, firstAid: number): InjuryView {
  const badness = i.severity === 'minor' ? 'light' : 'bad';
  const v: InjuryView = {
    name: firstAid >= KNOWS.severity ? INJURY_NAME[i.kind] : firstAid >= KNOWS.badness ? `${badness} ${BAD[i.kind]}` : PLAIN[i.kind],
    ...(i.treated ? { treated: i.treated } : {}),
  };
  if (firstAid >= KNOWS.badness) v.badness = badness;
  if (firstAid >= KNOWS.severity) { v.severity = i.severity; v.risk = canWorsen(i); }
  if (firstAid >= KNOWS.nights) v.nights = Math.ceil(i.heal / (1 + (i.treated ? TREAT_BONUS[i.treated] : 0)));
  if (firstAid >= KNOWS.everything) {
    v.festers = i.kind === 'cut' && canWorsen(i);
    if (canWorsen(i) && i.kind !== 'cut') v.worsenChance = AGGRAVATE_CHANCE;
    v.willMark = i.severity === 'grave' && !i.mended;
  }
  return v;
}

/** The queue's warning (#1395) — but only for someone who knows heavy work could do it (#1410): Apprentice First aid. */
export const riskFor = (injuries: readonly Injury[] | undefined, action: string, ring: number, craft: boolean, firstAid: number): string | null => {
  if (firstAid < KNOWS.severity) return null;
  const i = atRisk(injuries, action, ring, craft);
  return i ? riskLine(i) : null;
};

/** An injury in words, as far as you understand it (#1410) — for the screen's tooltip and the AI. */
export function injuryWords(i: Injury, firstAid: number): string {
  const v = injuryView(i, firstAid);
  const felt = i.kind === 'sprain' ? 'walking and heavy work are harder' : i.kind === 'hand' ? 'crafting is slower' : 'it bleeds a little each night';
  const cost = v.severity ? (i.kind === 'cut' ? 'costs 1 Condition a night' : `${i.kind === 'sprain' ? 'physical work and walking cost' : 'crafting takes'} ${INJURY_COST[i.severity]}x`) : felt;
  return [
    `${v.severity ?? v.badness ?? ''} ${v.name}`.trim(),
    cost,
    v.nights !== undefined ? `about ${v.nights} more good night${v.nights === 1 ? '' : 's'} to heal` : null,
    v.treated ? `treated (${v.treated})` : 'untreated',
    v.risk && i.kind !== 'cut' ? `heavy work could make it worse${v.worsenChance ? ` (${Math.round(v.worsenChance * 100)}% each time)` : ''}` : null,
    v.festers ? 'watch it — untreated, it could go bad' : null,
    v.willMark ? 'it will leave its mark when it heals' : null,
  ].filter(Boolean).join(', ');
}
