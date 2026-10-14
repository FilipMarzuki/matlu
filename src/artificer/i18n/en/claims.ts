/**
 * What people know and claim, in English (#1709, phase 3 of #1685): the facts the knowledge model
 * answers from beyond each person's own answers (what a village, the road, a trade and an
 * organisation know, what a teacher teaches, what people say of those they're tied to), and the
 * claims of rumours and lies (#1580): what each thing is filed under in the journal, each lie and
 * what its teller says when caught, each rumour's words and where you can see for yourself.
 *
 * Built from the sim's own data (facts.ts, content/claims.json, run-rumours.ts), so the English has
 * one copy. A rumour's words change as it's passed on (the number grows, the place moves, a name
 * swaps), so each is a template here (`log.rumour.*`), its blanks read back from what was said.
 *
 * Left English for now (#1709 says which): a people's or culture's ways told to a free question
 * (content/peoples-lore.json, cultures-lore.json), and rumours of the village's past, which the
 * story engine tells (phase 4).
 */

import { ALL_FACTS } from '../../facts';
import { claimEntries, NUMBER_WORDS, TELLING_BENDS } from '../../claims';
import { SOURCE_HEDGE } from '../../knowledge';
import { SPOT, TIE_TALK } from '../../run-rumours';

type ClaimKey = `fact.${string}` | `claim.${string}` | `w.${string}` | `num.${number}` | `say.${string}` | `log.${string}`;

const { propositions, lies, poolLies, rumours } = claimEntries();
/** A rumour's words as a template: the number in words (`{num}`), the place (`{w}`), the name (`{who}`). */
const template = (core: string): string => core.replace('{n}', '{num}').replace('{where}', '{w}');

export const claims = Object.fromEntries([
  ...ALL_FACTS.filter(f => /^(teaches|scope|org|tie):/.test(f.id)).map(f => [`fact.${f.id}`, f.text]),
  ...propositions.flatMap(p => [[`claim.prop.${p.id}`, p.label], [`claim.prop.${p.id}.in`, p.label.replace(/^The /, 'the ')]]),
  ...[...lies, ...poolLies].flatMap(l => [[`claim.lie.${l.id}`, l.text], ...(l.caught ? [[`claim.lie.${l.id}.caught`, l.caught]] : [])]),
  ...rumours.flatMap(r => [
    [`claim.rumour.${r.id}`, r.label],
    [`claim.rumour.${r.id}.in`, r.label.replace(/^The /, 'the ')],
    ...(r.check ? [[`claim.rumour.${r.id}.check`, r.check.text]] : []),
    [`log.rumour.${r.id}`, template(r.core)],
    ...r.places.map((place, i) => [`w.rplace.${r.id}.${i}`, place]),
  ]),
  ...Object.entries(SPOT).map(([v, s]) => [`w.spot.${v}`, s]),
  ...NUMBER_WORDS.map((w, i) => [`num.${i}`, w]),
  ...Object.entries(SOURCE_HEDGE).map(([k, h]) => [`say.hedge.${k}`, h]),
  // How a teller's bias shows in their words (claims.ts TELLING_BENDS): a line of their own after the news.
  ...Object.entries(TELLING_BENDS).flatMap(([b, bend]) => (bend?.frame ? [[`log.frame.${b}`, `{line} ${bend.frame}`]] : [])),
  // The road's own rumours, made for each run (run-rumours.ts): ties talked about, and organisations seen.
  ...Object.entries(TIE_TALK).flatMap(([kind, talk]) => [
    [`log.runtie.${kind}`, template(talk.core).replace('{other}', '{who2}')],
    [`log.runtie.${kind}.label`, talk.label.replace('{a}', '{who}').replace('{b}', '{who2}')],
  ]),
]) as Record<ClaimKey, string>;

/** Handwritten: how a rumour is hedged as it's passed on, and the run's organisation rumours. */
export const claimsHand = {
  'log.rumour.saw': 'I saw it myself: {line}',
  'log.rumour.heard': 'I heard it from {who}: {line}',
  'log.rumour.common': "Everyone's saying it: {line}",
  'log.runorg.keeps': "{who} was seen meeting {num} strangers wearing {w}'s sign at {w2}, after dark, where nobody was meant to see.",
  'log.runorg.open': '{who} brought {w} word of {num} strangers camped by {w2}.',
  'log.runorg.keepsLabel': 'Who meets {w} after dark',
  'log.runorg.openLabel': 'Word for {w}',
  // What a teacher says of their own skill (facts.ts teacherFact), for a teacher whose count of ways differs.
  'log.teaches.many': "{Skill}? That's what I teach. I can show you {n} ways to do it better. Come and learn when you have the time.",
  'log.teaches.one': "{Skill}? That's what I teach. I can show you one way to do it better. Come and learn when you have the time.",
  'log.teaches.none': "{Skill}? That's what I teach. Come and learn when you have the time.",
} as const;

/** Every key above (for the Swedish file's type). */
export type ClaimsKey = ClaimKey | keyof typeof claimsHand;
