/**
 * Encounters in English (#1709, phase 3 of #1685): what you see, each option's label, and what came
 * of it (the effect's text, what comes in overnight, and what killed you), for every encounter in
 * the Reach and on the road, every step of a dialogue, and the meeting with the spring caravan.
 * Turned into catalog keys straight from encounters.ts and caravan-meeting.ts, so the English has
 * one copy (the AI player and the API read the data); the Swedish is in ../sv/encounters.ts.
 *
 * Keys: `enc.<id>.text`, `enc.<id>.freeze`, `enc.<id>.opt.<option>` (the label) and
 * `enc.<id>.opt.<option>.<success|mixed|fail>`, with `.overnight` and `.killed` after an effect
 * that has them; a dialogue's later steps are `enc.<id>.step.<step>.text` and
 * `enc.<id>.step.<step>.opt.<option>...`. The meeting is `meet.<step>.text`, `meet.opt.<option>`
 * and `meet.opt.<option>.<success|fail>`.
 */

import { ENCOUNTERS, type Effect, type EncounterOption } from '../../encounters';
import { MEETING_STEPS, type MeetingOption } from '../../caravan-meeting';

type EncKey = `enc.${string}` | `meet.${string}`;

/** An effect's words: its text, and what comes in overnight or killed you, if it says. */
const effect = (key: string, e: Effect): [string, string][] => [
  [key, e.text],
  ...(e.overnight ? [[`${key}.overnight`, e.overnight.text] as [string, string]] : []),
  ...(e.killedBy ? [[`${key}.killed`, e.killedBy] as [string, string]] : []),
];

const options = (prefix: string, opts: readonly EncounterOption[]): [string, string][] => opts.flatMap(o => [
  [`${prefix}.opt.${o.id}`, o.label] as [string, string],
  ...effect(`${prefix}.opt.${o.id}.success`, o.success),
  ...(o.mixed ? effect(`${prefix}.opt.${o.id}.mixed`, o.mixed) : []),
  ...effect(`${prefix}.opt.${o.id}.fail`, o.fail),
]);

/** Every meeting option once (the fare options are shared by two steps). */
const MEETING_OPTIONS: readonly MeetingOption[] = [...new Map(Object.values(MEETING_STEPS).flatMap(s => s.options).map(o => [o.id, o])).values()];

export const encounters = Object.fromEntries([
  ...ENCOUNTERS.flatMap(e => [
    [`enc.${e.id}.text`, e.text] as [string, string],
    ...effect(`enc.${e.id}.freeze`, e.freeze),
    ...options(`enc.${e.id}`, e.options),
    ...Object.entries(e.steps ?? {}).flatMap(([sid, s]) => [[`enc.${e.id}.step.${sid}.text`, s.text] as [string, string], ...options(`enc.${e.id}.step.${sid}`, s.options)]),
  ]),
  ...Object.values(MEETING_STEPS).map(s => [`meet.${s.id}.text`, s.text]),
  ...MEETING_OPTIONS.flatMap(o => [[`meet.opt.${o.id}`, o.label], [`meet.opt.${o.id}.success`, o.success.text], ...(o.fail ? [[`meet.opt.${o.id}.fail`, o.fail.text]] : [])]),
]) as Record<EncKey, string>;
