/**
 * Random baselines: what does *no* intelligence score?
 *
 * - `uniform`: any action, any ring, any option, 2–6 a day, whether or not
 *   it's possible. The true floor. Most picks get skipped by the sim, so it
 *   mostly measures what doing very little gets you.
 * - `legal`: only actions that are possible right now, with random allowed
 *   options, until the day's hours are spent. It plays the day forward as it
 *   picks, so later picks see earlier ones' effects. This is the fair baseline:
 *   "how much of an AI's result is planning, and how much is the game being
 *   forgiving?"
 *
 * Both are seeded and use no API, so hundreds of runs take seconds and repeat
 * exactly. They reply in JSON like a model, so they go through the same parser
 * and runner, and a run of hundreds of them doubles as a fuzz test of the sim.
 */

import { ACTIONS, blockedReason, SITES, DAY_HOURS, runAction, chooseSite, type ActionId, type ActionOpts, type QueueId, type Region1State, type SiteId } from '../../artificer/region1';
import { scouted } from '../../artificer/exploration';
import { availableChoices } from '../../artificer/winter';
import type { Player } from '../runner';

export type RandomMode = 'uniform' | 'legal';

/** mulberry32: a tiny, fast, seedable PRNG. Math.random can't be seeded, so runs couldn't repeat. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Entry = { action: string; ring: number; options: { key: string; value: string }[] };
const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];
const SITE_IDS = Object.keys(SITES) as SiteId[];
/** Chance each day, once exits open, of taking one (else keep playing until the day cap). */
const EXIT_CHANCE = 0.35;

export interface RandomPlayerOptions {
  mode?: RandomMode;
  seed?: number;
}

export function randomPlayer(opts: RandomPlayerOptions = {}): Player {
  const mode = opts.mode ?? 'legal';
  const rand = rng(opts.seed ?? 1);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

  /** A random value for each option group the action offers (`allowed` skips blocked choices). */
  const randomOpts = (s: Region1State, id: ActionId, allowed: boolean): ActionOpts => {
    const out: Record<string, string> = {};
    for (const g of ACTIONS[id].options?.(s, {}) ?? []) {
      const choices = allowed ? g.choices.filter(c => !c.blocked) : g.choices;
      if (choices.length) out[g.key] = pick(choices).value;
    }
    return out as ActionOpts;
  };
  const toEntry = (id: ActionId, ring: number, o: ActionOpts): Entry =>
    ({ action: id, ring, options: Object.entries(o).map(([key, value]) => ({ key, value: String(value) })) });

  function uniformDay(s: Region1State): Entry[] {
    const n = 2 + Math.floor(rand() * 5);
    return Array.from({ length: n }, () => {
      const id = pick(ACTION_IDS);
      return toEntry(id, ACTIONS[id].ringed ? 1 + Math.floor(rand() * 3) : 1, randomOpts(s, id, false));
    });
  }

  function legalDay(start: Region1State): Entry[] {
    let s = start;
    const day: Entry[] = [];
    // An action starts only if hours remain, so keep picking until the day is spent.
    while (s.hoursToday < DAY_HOURS && day.length < 10) {
      const options: { id: ActionId; ring: number; o: ActionOpts }[] = [];
      for (const id of ACTION_IDS) {
        for (const ring of ACTIONS[id].ringed ? [1, 2, 3] : [1]) {
          const o = randomOpts(s, id, true);
          if (blockedReason(s, id, ring as 1 | 2 | 3, o) === null) options.push({ id, ring, o });
        }
      }
      if (!options.length) break;
      const c = pick(options);
      day.push(toEntry(c.id, c.ring, c.o));
      const q = (c.ring === 1 ? c.id : `${c.id}@${c.ring}`) as QueueId;
      s = runAction(s, Object.keys(c.o).length ? { q, opts: c.o } : q);
    }
    return day;
  }

  return {
    name: `random:${mode}`,
    async decide(_message, s) {
      const exits = availableChoices(s.day, s.config.calendar);
      const exit = exits.length && rand() < EXIT_CHANCE ? pick(exits) : null;
      // Legal claims a site only once the land is scouted; uniform tries whenever.
      const site = !s.site && rand() < (mode === 'legal' ? (scouted(s.explore, 1) ? 0.6 : 0) : 0.2) ? pick(SITE_IDS) : null;
      // Plan the legal day from where it will actually start: on the newly claimed site.
      const queue = exit ? [] : mode === 'legal' ? legalDay(site ? chooseSite(s, site) : s) : uniformDay(s);
      return { text: JSON.stringify({ thoughts: `random (${mode})`, site, exit, queue }), usage: { cost: 0 } };
    },
  };
}
