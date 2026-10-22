/**
 * Rapport (#1578): how the people on the caravan road seem to feel about you. A word, never a number.
 *
 * Everyone you meet keeps a hidden regard for you: `RoadState.trust`, 0–100. It still decides
 * everything it decided before (quests offered, answers, free lessons and healing, a friend's price,
 * who remembers you), but the player never sees it. What the player sees is a felt word, "cordial"
 * or "warm", and a felt word can be wrong:
 *
 *   felt = true + misreading × what's left of it
 *
 * The misreading is:
 * - **seeded per Warden and person**: a hash of the two ids, never a draw from any of the sim's
 *   streams (rng.ts). The same Warden always misreads the same person the same way, a replay reads
 *   alike, and adding this changed no one's luck;
 * - **narrowed by Charisma** (`statEffects(...).misread`): someone good with people reads them truer;
 * - **widened by a tired mind**: below CLEAR_READ Clarity, the read gets worse, up to twice as bad;
 * - **colder for reserved people**: the "liking gap" (Boothby et al. 2018, *The Liking Gap in
 *   Conversations*): after talking, people underestimate how much the other person liked them,
 *   and someone dry or severe gives you even less to go on;
 * - **colder after a ragged winter**: a Warden who boarded half-frozen expects the worst of people.
 *
 * **Moments of truth.** When someone shows where you really stand (a friend's price, a free lesson
 * or healing, a favour asked, a secret told, becoming someone who'll remember you), your read of
 * them moves halfway to the truth. If that changes the word, the journal says so: "Maren is warmer
 * to you than you thought." What's left of each misreading is kept (`RoadState.readings`), so a
 * save carries it.
 *
 * Pure: the words, the misreading and the moment of truth. road.ts applies them; the views
 * (road-view.ts, observe.ts) show the word.
 */

import { generator, seedOf } from './rng';
import { statEffects, type Stats } from './stats';
import { VILLAGES, TRAVELLERS, BASE_TRUST, FRIEND_LESSON, CONTACT_TRUST, MAX_TRUST, type Person } from './villages';
import { OFFER_TRUST } from './quests';
import { SET_BONE_TRUST } from './injuries';

// ── The words ───────────────────────────────────────────────────────────────

export type Rapport = 'wary' | 'stranger' | 'civil' | 'cordial' | 'friendly' | 'warm' | 'trusted' | 'close';

/**
 * The ladder, coldest first, and where on the hidden score each word starts. The bands are cut at
 * the gates, so a word changing roughly lines up with something opening: `civil` is when they'll
 * ask you a favour, `friendly` when lessons and healing come free, `warm` when you get a friend's
 * price and they'll remember you. The edges are the gates' own constants, so moving a gate moves
 * its word with it.
 */
export const RAPPORT_BANDS: readonly { word: Rapport; from: number }[] = [
  // Below where anyone starts: you've let someone down, or came off the mountain looking like trouble.
  { word: 'wary', from: 0 },
  // Where a ragged Warden is met.
  { word: 'stranger', from: BASE_TRUST.ragged },
  // They'll ask you for help (quests, OFFER_TRUST). A thriving Warden is met here.
  { word: 'civil', from: OFFER_TRUST },
  // Their second lore line, and what most of them will tell you when asked.
  { word: 'cordial', from: 25 },
  // A teacher's lesson and a healer's care come free (FRIEND_LESSON, FRIEND_HEAL).
  { word: 'friendly', from: FRIEND_LESSON },
  // A friend's price (FRIEND_TRUST), and they'll remember you on the next road (CONTACT_TRUST).
  { word: 'warm', from: CONTACT_TRUST },
  // A healer will set a grave injury properly (SET_BONE_TRUST).
  { word: 'trusted', from: SET_BONE_TRUST },
  // The last of what they have to tell.
  { word: 'close', from: 75 },
];

/** The words, coldest first. */
export const RAPPORT_WORDS: readonly Rapport[] = RAPPORT_BANDS.map(b => b.word);

/** The word for a score on the hidden 0–100 scale (the felt one, or the true one in dev mode). */
export function rapportWord(score: number): Rapport {
  let word: Rapport = RAPPORT_BANDS[0].word;
  for (const b of RAPPORT_BANDS) if (score >= b.from) word = b.word;
  return word;
}

/** The ladder in one line, for a tooltip or the AI's rules. */
export const RAPPORT_LADDER = RAPPORT_WORDS.join(' → ');

// ── The misreading ──────────────────────────────────────────────────────────

/** The widest the seeded part of a read goes either way, in trust points, at CHA 10 with a clear head. */
export const MISREAD_SPREAD = 12;
/** How much colder a reserved person reads (the liking gap), before Charisma and Clarity. */
export const RESERVED_LEAN = -6;
/** How much colder everyone reads to a Warden who came through the winter ragged. */
export const RAGGED_LEAN = -4;
/** Clarity at or above which tiredness doesn't cloud your read; at 0 it's twice as far off. */
export const CLEAR_READ = 50;
/** The share of what's left of a misreading that a moment of truth clears. */
export const TRUTH_SHOWS = 0.5;
/** A lore line or an answer gated this high is a secret: being told it is a moment of truth. */
export const SECRET_GATE = 50;

/** Who's doing the reading: the Warden's id (the seed), stats, Clarity now, and how the winter went. */
export interface Reader { id: string; stats: Stats; clarity: number; ragged: boolean }

/**
 * The seeded part of how `wardenId` misreads `personId`, in [-1, 1). Two draws added, so most reads
 * are near the truth and few are far (a triangle, not a flat spread). Its own generator, seeded from
 * both ids: it takes nothing from the day's streams, so no other roll in the run moves.
 */
export function misreadDraw(wardenId: string, personId: string): number {
  const r = generator(seedOf(`${wardenId}|rapport|${personId}`));
  return r() + r() - 1;
}

/** How far off a reader's reads run, as a multiplier: Charisma narrows it, a tired mind widens it. */
export function readError(stats: Stats, clarity: number): number {
  const frayed = Math.max(0, Math.min(1, (CLEAR_READ - clarity) / CLEAR_READ));
  return statEffects(stats).misread * (1 + frayed);
}

/**
 * How far `reader` misreads `person`, in trust points: positive, they seem warmer than they are;
 * negative, colder. The leans (a reserved manner, a ragged winter) add to the seeded part, and the
 * reader's error scales the lot: a charismatic, clear-headed Warden is fooled less by everything.
 */
export function misreading(reader: Reader, person: Pick<Person, 'id' | 'reserved'>): number {
  const lean = (person.reserved ? RESERVED_LEAN : 0) + (reader.ragged ? RAGGED_LEAN : 0);
  return (misreadDraw(reader.id, person.id) * MISREAD_SPREAD + lean) * readError(reader.stats, reader.clarity);
}

// ── On the road ─────────────────────────────────────────────────────────────

/**
 * What reading people needs from the road: a slice of `RoadState`, so this module doesn't import
 * road.ts (road.ts imports it).
 */
export interface RapportState {
  character: { id: string; stats: Stats };
  vitals: { clarity: { current: number } };
  arrival: 'thrive' | 'ragged';
  trust: Readonly<Record<string, number>>;
  /** How much of each person's misreading is left, 0–1. Absent (or a person missing from it) is all of it. */
  readings?: Readonly<Record<string, number>>;
}

/** Everyone on the road, by id: the villages' people and the caravan's own. */
const PEOPLE: Readonly<Record<string, Person>> = Object.fromEntries([...Object.values(VILLAGES).flatMap(v => v.people), ...TRAVELLERS].map(p => [p.id, p]));

/** The Warden on the road, as a reader of people. */
export const readerOf = (s: RapportState): Reader =>
  ({ id: s.character.id, stats: s.character.stats, clarity: s.vitals.clarity.current, ragged: s.arrival === 'ragged' });

/** How much of the misreading of `pid` is left: all of it until a moment of truth. */
export const readingLeft = (s: RapportState, pid: string): number => s.readings?.[pid] ?? 1;

/** How someone seems to you: the felt word, and the felt score behind it (never shown). */
export interface Felt { word: Rapport; score: number }

/** How `pid` seems to the Warden now. `left` overrides what's left of the misreading (for a what-if). */
export function feltOf(s: RapportState, pid: string, left = readingLeft(s, pid)): Felt {
  const truth = s.trust[pid] ?? 0;
  const score = Math.max(0, Math.min(MAX_TRUST, truth + misreading(readerOf(s), PEOPLE[pid] ?? { id: pid }) * left));
  return { word: rapportWord(score), score };
}

/** The felt word for `pid`: what every player-facing view shows. */
export const feltWord = (s: RapportState, pid: string): Rapport => feltOf(s, pid).word;

/** The true word for `pid`: for dev mode only, beside the felt one. */
export const trueWord = (s: RapportState, pid: string): Rapport => rapportWord(s.trust[pid] ?? 0);

/**
 * A moment of truth with `pid`: what's left of your misreading of them halves. Returns the new
 * readings, and the journal line if your read changed its word (warmer or cooler than you
 * thought), else null. Pure: road.ts stores the readings and writes the line.
 */
export function momentOfTruth(s: RapportState, pid: string): { readings: Record<string, number>; line: string | null } {
  const left = readingLeft(s, pid);
  const after = left * (1 - TRUTH_SHOWS);
  const was = feltOf(s, pid, left).word;
  const now = feltOf(s, pid, after).word;
  const name = PEOPLE[pid]?.name ?? pid;
  const line = was === now ? null
    : `${name} is ${RAPPORT_WORDS.indexOf(now) > RAPPORT_WORDS.indexOf(was) ? 'warmer' : 'cooler'} to you than you thought.`;
  return { readings: { ...(s.readings ?? {}), [pid]: after }, line };
}
