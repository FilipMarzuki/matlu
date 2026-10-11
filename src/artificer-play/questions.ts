/**
 * Free questions, as kept (#1575, plan #1574): every question a player asks a villager in their own
 * words goes into `artificer_questions`, matched or not. The owner's call is that the questions are
 * the value: what players ask, and what nobody in the game can answer yet, shows how to grow it.
 *
 * The game's side (matching, answering) is artificer/free-questions.ts. This file is what may be
 * kept of the text. The audience includes kids, so before anything is stored:
 * - it's cut to QUESTION_CHARS, with control and invisible characters dropped;
 * - email addresses, links and runs of four or more digits (phone numbers, birth years) are cut out;
 * - a question holding a blocked word (the nickname filter's list) is kept as blocked, with no text.
 * Nothing else about the player is stored: no address, no account, no game id.
 *
 * Plain functions with no game code, so the web game can clean a question the way the server does.
 */

import { holdsBlockedWord, type Surface } from './records';
import { QUESTION_CHARS } from '../artificer/free-questions';

export { QUESTION_CHARS };

/** A question, as stored. */
export interface Question {
  /** The question, cleaned (`cleanQuestion`), or null when it held a blocked word. */
  question: string | null;
  blocked: boolean;
  /** Who was asked (a person id), and the topic it matched (a focus key), or null for none. */
  person: string;
  topic: string | null;
  /** Whether they answered: a match is always answered (v0 passes the gates), so this is `topic !== null` for now. */
  answered: boolean;
  /** The person's trust in the Warden when asked, 0–100. */
  trust: number;
  gameVersion: string;
  /** Where it was asked. The playtest asks no free questions, so never `bench`. */
  surface: Exclude<Surface, 'bench'>;
}

/** The notice under every question box (the web game and the console show it as written). */
export const QUESTION_NOTICE = "Don't write your name or anything about you. Questions are kept to improve the game.";

/**
 * Whole words the blocklist would catch that are fair questions in a survival game: "How do I kill
 * a wolf?" Only these, and only as whole words; everything blocked anywhere in a word stays blocked.
 */
const FAIR_HERE = ['kill'];

/** What's cut out, and what's left in its place. */
const CUT = '…';
const EMAIL = /[^\s@]+@[^\s@]+/g;
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
/** Four or more digits in a run, spaces, dots, dashes, slashes and brackets between them allowed. */
const DIGIT_RUN = /\+?\d(?:[\s().\-/]*\d){3,}/g;

/**
 * A question fit to keep, or null if there's no question in it (not text, or nothing left once
 * cleaned). `text` is null when it held a blocked word: it's kept as blocked, without its words.
 */
export function cleanQuestion(raw: unknown): { text: string | null; blocked: boolean } | null {
  if (typeof raw !== 'string') return null;
  const flat = raw.normalize('NFC').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ');
  const cut = flat.replace(LINK, CUT).replace(EMAIL, CUT).replace(DIGIT_RUN, CUT).replace(/\s+/g, ' ').trim();
  // Cut by characters, not UTF-16 units: half of a letter outside the basic plane is invalid text
  // that Postgres refuses (as with nicknames).
  const text = [...cut].slice(0, QUESTION_CHARS).join('').trim();
  if (!text || text === CUT) return null;
  return holdsBlockedWord(text, FAIR_HERE) ? { text: null, blocked: true } : { text, blocked: false };
}
