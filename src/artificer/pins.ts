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
