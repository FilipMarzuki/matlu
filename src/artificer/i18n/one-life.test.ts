import { describe, expect, it } from 'vitest';
import { en } from './en';
import { sv } from './sv';

/**
 * One Warden, one life (#1837). The game isn't played as "runs" by the same character: a new game is
 * a new Warden, who at most finds the last one's tools (the intro's "Someone was here before you").
 * So nothing the app shows may say "next run", "run 3", "runs played", "you keep what you learned"
 * and the like. This scans every string in both catalogs for that wording.
 *
 * A few keys are allowed, each for a reason:
 * - `api.*`: the play API and MCP text for people's AIs, where "a run" is one game played and
 *   is the word the API and the Records use (out of scope in #1837).
 * - `dev.*`: the dev panel, a testing view players don't see.
 * - `log.carryLearned*`: the sim's line for a legacy that carries knowledge to the same character.
 *   The app's legacy is heirlooms only (#1455), so a game never writes it; it stays, word for word,
 *   so the journal's Swedish still matches the sim's English.
 */
const ALLOWED = [/^api\./, /^dev\./, /^log\.carryLearned/];

/** English wording that counts games played by one character. */
const EN_MULTI_RUN: readonly RegExp[] = [
  // Not "a run": a hare's run through the grass is one (Hollowford's hunter shows you how to read it).
  /\b(this|next|previous|last|another|each|every|per|the) run\b(?! (?:the|it|out|past|down|thin|dark))/i,
  /\bruns? (?:played|ended|over)\b/i,
  /\b(?:past|finished|standard|previous|other|over the) runs\b/i,
  /\bRUN \{n\}/,
  /\bkeep what you(?:'ve)? learn(?:ed|t)\b/i,
  /\bnext time you play\b/i,
  /\bsame Warden again\b/i,
  /\bplay(?:s|ed)? (?:it )?again\b/i,
];

/** Swedish: the playthrough words (runda, omgång) and their carry-over lines. */
const SV_MULTI_RUN: readonly RegExp[] = [
  // Not bare `runda`: it's also "round" (Sabine's round burn marks).
  /\b(?:rundan|rundans|rundor|rundorna|rundornas)\b/i,
  /\b(?:den här|nästa|förra|en|varje|per) runda\b/i,
  /\bRUNDA \{n\}/,
  /\bomgång(?:en|ens|ar|arna)?\b/i,
  /\bbehåller det du lärt\b/i,
  /\bnästa gång du spelar\b/i,
  /\bspela(?:r)? igen\b/i,
];

const hits = (catalog: Readonly<Record<string, string>>, patterns: readonly RegExp[]): string[] =>
  Object.entries(catalog)
    .filter(([k]) => !ALLOWED.some(a => a.test(k)))
    .filter(([, v]) => patterns.some(p => p.test(v)))
    .map(([k, v]) => `${k}: ${v}`);

describe('one Warden, one life (#1837)', () => {
  it('the English catalog never talks of several runs by the same character', () => {
    expect(hits(en, EN_MULTI_RUN)).toEqual([]);
  });

  it('the Swedish catalog never talks of rundor or omgångar', () => {
    expect(hits(sv as Record<string, string>, SV_MULTI_RUN)).toEqual([]);
  });

  it('catches the wording it is there for', () => {
    // So a pattern that silently stops matching shows up here, not as a pass.
    const enBad = { a: 'Runs played in this browser: 4', b: '✝ RUN {n} ENDED', c: 'You keep what you learned.', d: 'If this run is over' };
    const svBad = { a: 'Omgångar spelade i den här webbläsaren', b: '✝ RUNDA {n} SLUT', c: 'Du behåller det du lärt dig.', d: 'den här rundan' };
    expect(hits(enBad, EN_MULTI_RUN)).toHaveLength(4);
    expect(hits(svBad, SV_MULTI_RUN)).toHaveLength(4);
    // And leaves the ordinary verb alone.
    expect(hits({ a: 'The larder runs thin.', b: 'Run the day and see how it goes.', c: 'This runs past dark.' }, EN_MULTI_RUN)).toEqual([]);
    expect(hits({ a: 'små runda brännmärken' }, SV_MULTI_RUN)).toEqual([]);
  });
});
