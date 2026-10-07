/**
 * Quirks (#1362, epic #1366): character rather than gifts. Talents are things you're good at;
 * quirks are how you are — neither good nor bad, and usually hidden until a moment reveals them.
 *
 * - **Panic response** — every Warden has one: what the body does when panic takes over (#1361).
 *   Fighters lash out, runners bolt, freezers lock up, appeasers placate.
 * - **Temperament** — about half have one: reckless (danger looks smaller than it is), jumpy
 *   (it looks bigger, but you're quick to get away), stoic (the crash after a panic is halved).
 * - **Fears** — acquired, not born: a panic that ends badly leaves a fear of that kind of thing
 *   (`fear:heights`), which makes it look worse. Facing it calmly, again and again, fades it.
 *
 * Seeded from the character id like the hidden talent, so the same person is always the same
 * person; carried across runs with them. Pure data and pure helpers.
 */

import { streamFor } from './rng';

export interface Quirk {
  id: string;
  /** Hidden until it first shows itself. */
  known: boolean;
  /** For a fear: calm or shaken successes against it so far — FEAR_FADES of them, and it's gone. */
  faced?: number;
}

export type ResponseQuirk = 'fighter' | 'runner' | 'freezer' | 'appeaser';
export type TemperamentQuirk = 'reckless' | 'jumpy' | 'stoic';

/** How common each panic response is: running most of all. */
export const RESPONSE_WEIGHTS: Readonly<Record<ResponseQuirk, number>> = { fighter: 25, runner: 40, freezer: 25, appeaser: 10 };
/** The chance of a temperament, and which (equally likely). */
export const TEMPERAMENT_CHANCE = 0.5;
export const TEMPERAMENTS: readonly TemperamentQuirk[] = ['reckless', 'jumpy', 'stoic'];
/** Jumpy: flight options get this much better (the startle reflex gets you away fast). */
export const JUMPY_FLIGHT = 0.1;
/** Stoic: the crash after a panic is cut to this share. */
export const STOIC_CRASH = 0.5;
/** Calm or shaken successes against a fear before it fades. */
export const FEAR_FADES = 3;

/** Names and what they do, for the Warden sheet (#1364) and the journal. */
export const QUIRKS: Readonly<Record<string, { name: string; blurb: string; revealed: string }>> = {
  fighter: { name: 'Fighter', blurb: 'when panic takes over, you go at it', revealed: 'You didn\'t know you had that in you.' },
  runner: { name: 'Runner', blurb: 'when panic takes over, you run', revealed: 'You didn\'t know you could run like that.' },
  freezer: { name: 'Freezer', blurb: 'when panic takes over, you lock up', revealed: 'So that\'s what you do when it\'s too much: you go still.' },
  appeaser: { name: 'Appeaser', blurb: 'when panic takes over, you try to give it something', revealed: 'Your first thought was to give it something. You\'ll remember that about yourself.' },
  reckless: { name: 'Reckless', blurb: 'danger looks smaller to you than it is', revealed: 'Anyone else would have been frightened. You hardly noticed.' },
  jumpy: { name: 'Jumpy', blurb: 'danger looks bigger to you, but you\'re quick to get away', revealed: 'Your heart was going before you even knew why.' },
  stoic: { name: 'Stoic', blurb: 'the shaking after a fright passes quicker for you', revealed: 'The shaking passes quicker than it should. It always has, you realise.' },
};

/** The words for a fear of each tag. */
export const FEAR_OF: Readonly<Record<string, string>> = { heights: 'heights', animal: 'wild animals', person: 'strangers', dark: 'the dark', dead: 'the dead', uncanny: 'uncanny things', corruption: 'the corruption' };
export const fearId = (tag: string): string => `fear:${tag}`;
export const isFear = (id: string): boolean => id.startsWith('fear:');
/** A quirk's display name: its own, or "Fear of heights". */
export const quirkName = (id: string): string => (isFear(id) ? `Fear of ${FEAR_OF[id.slice(5)] ?? id.slice(5)}` : QUIRKS[id]?.name ?? id);

/** A new Warden's quirks: one panic response, and perhaps a temperament — hidden, seeded from the character id. */
export function startingQuirks(seed: number): Quirk[] {
  const r = streamFor(seed, 0, 'quirks');
  const total = Object.values(RESPONSE_WEIGHTS).reduce((a, b) => a + b, 0);
  let pick = r() * total;
  let response: ResponseQuirk = 'runner';
  for (const [id, w] of Object.entries(RESPONSE_WEIGHTS) as [ResponseQuirk, number][]) { pick -= w; if (pick < 0) { response = id; break; } }
  const out: Quirk[] = [{ id: response, known: false }];
  if (r() < TEMPERAMENT_CHANCE) out.push({ id: TEMPERAMENTS[Math.floor(r() * TEMPERAMENTS.length)], known: false });
  return out;
}

/** Whether the Warden has this quirk (known or not — quirks work before you know them). */
export const hasQuirk = (w: { character: { quirks?: readonly Quirk[] } }, id: string): boolean => !!w.character.quirks?.some(q => q.id === id);

/** The quirk list with `id` made known — and whether that just happened. */
export function reveal(quirks: readonly Quirk[] | undefined, id: string): { quirks: Quirk[]; revealed: boolean } {
  const list = (quirks ?? []).map(q => ({ ...q }));
  const q = list.find(x => x.id === id);
  if (!q || q.known) return { quirks: list, revealed: false };
  q.known = true;
  return { quirks: list, revealed: true };
}
