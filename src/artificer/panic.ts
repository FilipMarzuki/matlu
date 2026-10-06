/**
 * Panic, part 1 (#1360, epic #1366): how dangerous something *looks*, and whether you can hold.
 *
 * Two numbers matter when an encounter opens. Its **real threat** is the danger it truly holds:
 * it sets what can happen and never changes. Its **perceived threat** is how it looks to this
 * Warden, right now — the unknown looms, a foggy mind and a hurt body make everything worse,
 * while having met it before and knowing the field make it smaller. Panic follows perception,
 * not truth, so you can be terrified of a fox in the dark or walk calmly up to a bear — the same
 * gap between belief and fact as self-assessed skill (#1236).
 *
 * **Nerve** (from Willpower) is what you can hold. Perceived threat against nerve gives your state:
 * calm, shaken or panicked. Pure and deterministic: the same Warden meeting the same thing in
 * the same state always feels the same.
 */

import { skillLevel, LEVELS, type SkillId, type SkillPractice } from './skills';
import type { Stats } from './stats';
import type { Vitals } from './vitality';

/** Threat levels, 0–4. */
export type Threat = 0 | 1 | 2 | 3 | 4;
export const THREAT_WORDS: Readonly<Record<Threat, string>> = { 0: 'harmless', 1: 'uneasy', 2: 'frightening', 3: 'terrifying', 4: 'overwhelming' };

export type PanicState = 'calm' | 'shaken' | 'panicked';

/** Below this Clarity a mind sees danger everywhere; below this Condition a body does. */
export const FOGGY_CLARITY = 30, HURT_CONDITION = 40;
/** Meetings survived before something stops looming (habituation). */
export const HABITUATED = 3;
/** The true skill level from which you read danger in your own field: Adept. */
export const FIELD_LEVEL = LEVELS.indexOf('Adept');
/** Ambient threat (the dark, a storm — #1367) from which anything you meet looks worse. */
export const AMBIENT_LOOMS = 2;
/** Shaken: careful options lose this much chance (one odds word), and the encounter costs this much Clarity. */
export const SHAKEN_PENALTY = 0.15, SHAKEN_CLARITY = 5;

/** What perception reads off the Warden. */
export interface Perceiver {
  vitals: Pick<Vitals, 'clarity' | 'condition'>;
  skills: SkillPractice;
  character: { stats: Stats };
  /** Encounters met and survived, by template id. */
  met?: Readonly<Record<string, number>>;
}

/** What perception reads off the thing met. */
export interface Threatening {
  id: string;
  threat: Threat;
  /** The skill whose mastery makes it smaller (hunting for animals, scouting for the land). */
  field?: SkillId;
}

const clamp = (n: number): Threat => Math.max(0, Math.min(4, n)) as Threat;

/**
 * How dangerous it looks: the real threat, +1 each for the unknown, a looming hour (ambient
 * threat 2+), a foggy mind and a hurt body; −1 each for having met it often and for knowing
 * its field. Clamped to 0–4.
 */
export function perceivedThreat(w: Perceiver, t: Threatening, ambient = 0): Threat {
  const met = w.met?.[t.id] ?? 0;
  let p: number = t.threat;
  if (met === 0) p += 1;
  if (ambient >= AMBIENT_LOOMS) p += 1;
  if (w.vitals.clarity.current < FOGGY_CLARITY) p += 1;
  if (w.vitals.condition < HURT_CONDITION) p += 1;
  if (met >= HABITUATED) p -= 1;
  if (t.field && skillLevel(w.skills, t.field) >= FIELD_LEVEL) p -= 1;
  return clamp(p);
}

/** What you can hold: 2 at WIL 10, one more for every 4 points above (one less for every 4 below). */
export const nerveOf = (w: Pick<Perceiver, 'character'>): number => 2 + Math.floor((w.character.stats.wil - 10) / 4);

/** Calm while the threat is within your nerve; shaken one past it; panicked beyond. */
export function panicState(perceived: number, nerve: number): PanicState {
  const margin = perceived - nerve;
  return margin <= 0 ? 'calm' : margin === 1 ? 'shaken' : 'panicked';
}

/** The whole read, for the encounter that opens: what it looks like, what you can hold, and how you stand. */
export function readThreat(w: Perceiver, t: Threatening, ambient = 0): { perceived: Threat; nerve: number; state: PanicState } {
  const perceived = perceivedThreat(w, t, ambient);
  const nerve = nerveOf(w);
  return { perceived, nerve, state: panicState(perceived, nerve) };
}
