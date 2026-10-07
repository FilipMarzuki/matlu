/**
 * Pins (#1378, epic #1376): places worth remembering. Out on the land you sometimes come across
 * a place — a sheltered hollow, a deep pool, a strange carving — and you can try to remember it.
 *
 * You can't remember everything. How many places you can hold comes from your mind (INT) and
 * from practice: Memory, a skill like any other, practised by remembering. Pins belong to the
 * run — a new run starts with none — but Memory, being a skill, carries on.
 *
 * Pure data and helpers. The places themselves are encounters (kind `place`, in encounters.ts);
 * region1.ts records a pin when you choose to remember one, and lets one go with `forgetPin`.
 */

import type { Ring } from './exploration';
import type { Stats } from './stats';
import { skillLevel, type SkillPractice } from './skills';

/** What a place is good for. What each does in the game comes with #1379. */
export type PinKind = 'shelter' | 'fishing' | 'forage' | 'stone' | 'wonder' | 'peaceful';
/** How a place made you feel, when it made you feel something. */
export type Feeling = 'eerie' | 'awed' | 'peaceful';

/** A place you remember. */
export interface Pin {
  /** The place and its ring (`deep-pool@2`): you remember a place once. */
  id: string;
  /** The encounter that found it. */
  place: string;
  kind: PinKind;
  ring: Ring;
  day: number;
  feeling?: Feeling;
  /** How much it interests you (#1379), once Memory is good enough to weigh places. */
  interest?: Interest;
  /** Been back since (#1379): the first return to an awe-inspiring place teaches something. */
  visited?: boolean;
}

export const pinId = (place: string, ring: Ring): string => `${place}@${ring}`;

/** Places held with an ordinary mind (INT 10) and no practice. */
export const PIN_BASE = 2;

/**
 * How many places you can hold: 2, one more for every 2 points of INT above 10 (fewer below,
 * but always at least 1), and one more for every true level of Memory.
 */
export function pinCapacity(w: { character: { stats: Stats }; skills: SkillPractice }): number {
  return Math.max(1, PIN_BASE + Math.floor((w.character.stats.int - 10) / 2)) + skillLevel(w.skills, 'memory');
}

/** What the journal calls each kind of place. */
export const PIN_WORDS: Readonly<Record<PinKind, string>> = {
  shelter: 'a place for a shelter', fishing: 'a fishing spot', forage: 'a place to forage', stone: 'good stone',
  wonder: 'something strange', peaceful: 'a quiet place',
};

export const FULL_MEMORY = 'your memory is full — let a place go first';
export const ALREADY_PINNED = 'you already remember it';

// ── What a held pin does (#1379) ────────────────────────────────────────────

/** How much a place interests you (#1379): ★ to ★★★. Absent: simply remembered. */
export type Interest = 1 | 2 | 3;

/** A ★★★ place you know well: its effect counts double. */
export const pinWeight = (p: Pin): number => (p.interest === 3 ? 2 : 1);

/** The most interest you can give a place: none until Memory reaches Apprentice (2), ★★ there, ★★★ from Adept (3). */
export function maxInterest(skills: SkillPractice): 0 | 2 | 3 {
  const lvl = skillLevel(skills, 'memory');
  return lvl >= 3 ? 3 : lvl >= 2 ? 2 : 0;
}

/** The work a kind of place makes richer, in its ring. */
const PIN_WORK: Partial<Record<PinKind, readonly string[]>> = { fishing: ['fish', 'water'], forage: ['gather'], stone: ['quarry'] };

/** Extra haul for this work in this ring, from the places you remember there: +1 each, +2 at ★★★. */
export function pinYield(pins: readonly Pin[] | undefined, action: string, ring: Ring): number {
  return (pins ?? []).filter(p => p.ring === ring && PIN_WORK[p.kind]?.includes(action)).reduce((n, p) => n + pinWeight(p), 0);
}

/** How the places you remember make a ring feel (#1367's ambient threat): a peaceful one −1, an eerie one +1 (doubled at ★★★). */
export function pinAmbient(pins: readonly Pin[] | undefined, ring: Ring): number {
  return (pins ?? []).filter(p => p.ring === ring).reduce((n, p) => n + (p.feeling === 'eerie' ? pinWeight(p) : p.feeling === 'peaceful' ? -pinWeight(p) : 0), 0);
}

/** Something that awed you there (#1379): that ring feels no worse in the dark. */
export const awedIn = (pins: readonly Pin[] | undefined, ring: Ring): boolean => (pins ?? []).some(p => p.ring === ring && p.feeling === 'awed');

/** A shelter place you remember near camp (ring 1): build while you hold it and the shelter is warmer. */
export const shelterPin = (pins: readonly Pin[] | undefined): boolean => (pins ?? []).some(p => p.kind === 'shelter' && p.ring === 1);
/** How much warmer (warmth is 0–1): you knew where the wind doesn't reach. */
export const SHELTER_PIN_WARMTH = 0.05;

/** The place you'd let go first when your memory is full: the least interesting, the oldest of those. A suggestion only. */
export function letGoFirst(pins: readonly Pin[] | undefined): Pin | undefined {
  return [...(pins ?? [])].sort((a, b) => (a.interest ?? 0) - (b.interest ?? 0) || a.day - b.day)[0];
}
