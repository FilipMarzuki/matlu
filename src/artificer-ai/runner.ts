/**
 * The AI play loop (#1226): observe → decide → apply → repeat, one decision
 * per game day, until the player takes an exit.
 *
 * Pure apart from awaiting the player, so it runs the same with a real model,
 * a scripted bot or a test double. Every decision goes through
 * `parseDecision`, whoever made it.
 */

import { scouted } from '../artificer/exploration';
import { setFocus, createRegion1, chooseSite, choose, runDay, type Region1State, parseItem, type QueueItem, type SiteId } from '../artificer/region1';
import { availableChoices, type Choice } from '../artificer/winter';
import { summarizeRun, type Legacy, type RunRecord } from '../artificer/legacy';
import { observe } from './observe';
import { parseFocus } from '../artificer/focus';
import type { TalentId } from '../artificer/talents';
import { progressOf, type Progress } from './progress';
import { invariantViolations } from './invariants';
import { parseDecision } from './decision';

/** Token usage a model player reports per call (all optional; summed per run). */
export interface Usage {
  input: number; output: number; cacheRead: number; cacheWrite: number;
  /** Actual billed USD, summed over the run's calls; null when the player doesn't report it (#1231). */
  cost: number | null;
}

/**
 * Anything that can play: given the next user message (an observation, or a
 * correction after an invalid reply) and the live state, return reply text.
 * Model players keep their own conversation history between calls.
 */
export interface Player {
  name: string;
  decide(message: string, state: Region1State): Promise<{ text: string; usage?: Partial<Usage> }>;
}

export interface Turn {
  day: number;
  thoughts: string;
  site: SiteId | null;
  exit: Choice | null;
  queue: QueueItem[];
  /** True when the reply stayed invalid after the retry and the day was passed. */
  invalid: boolean;
  /** For an invalid day: the last raw reply and what was wrong with it, for diagnosing a model or prompt. */
  reply?: string;
  errors?: string[];
  /** Sim invariants broken at the end of the turn, if any (should never happen). */
  violations?: string[];
  /** Progression snapshot at the end of the turn (#1229). */
  progress: Progress;
  /** Journal lines this turn produced. */
  journal: string[];
  /** State at the end of the turn, compactly. */
  after: { vigor: number; clarity: number; condition: number; food: number; water: number; firewood: number; materials: number; rations: number; warmth: number };
}

export interface RunResult {
  player: string;
  turns: Turn[];
  record: RunRecord;
  /** Run ended by the day cap rather than the player's own exit. */
  forced: boolean;
  usage: Usage;
  /** Progression at the start of the run, before day 1 (#1229). */
  start: Progress;
  final: Region1State;
}

export interface PlayOptions {
  /** Stop and winter over if the player hasn't left by this day. */
  maxDays?: number;
  legacy?: Legacy;
  /** Talents the Warden picked (#1263); none by default. (No id, so no hidden talent — #1267 adds that.) */
  talents?: TalentId[];
  /** Called after every turn (for live progress printing). */
  onTurn?: (t: Turn) => void;
}

function snapshot(s: Region1State, warmthOf: (s: Region1State) => number): Turn['after'] {
  return {
    vigor: Math.round(s.vitals.vigor.current), clarity: Math.round(s.vitals.clarity.current), condition: Math.round(s.vitals.condition),
    food: s.stores.rawFood, water: s.stores.water, firewood: s.stores.firewood, materials: s.stores.materials, rations: s.stores.rations,
    warmth: Math.round(warmthOf(s) * 100) / 100,
  };
}

/** Play one Region 1 run with `player`. */
export async function playRun(player: Player, opts: PlayOptions = {}): Promise<RunResult> {
  const { warmth } = await import('../artificer/region1');
  let s = createRegion1({}, opts.legacy, { name: player.name, chosen: opts.talents ?? [] });
  const startKnown = s.known.length;
  const start = progressOf(s, startKnown);
  // The cap can't end a run before any exit opens, so it is at least the caravan's first day.
  const maxDays = Math.max(opts.maxDays ?? 16, s.config.calendar.caravanOpen);
  const turns: Turn[] = [];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null };
  let notes: string[] = [];
  let forced = false;

  const ask = async (message: string): Promise<string> => {
    const r = await player.decide(message, s);
    usage.input += r.usage?.input ?? 0;
    usage.output += r.usage?.output ?? 0;
    usage.cacheRead += r.usage?.cacheRead ?? 0;
    usage.cacheWrite += r.usage?.cacheWrite ?? 0;
    // Unknown stays unknown: one call without a cost doesn't turn a known total into a guess.
    if (r.usage?.cost !== undefined && r.usage.cost !== null) usage.cost = (usage.cost ?? 0) + r.usage.cost;
    return r.text;
  };

  while (!s.outcome) {
    if (s.day > maxDays) {
      // A player that never leaves winters over, so every run ends in a recorded outcome.
      if (availableChoices(s.day, s.config.calendar).includes('winter')) s = choose(s, 'winter');
      forced = true;
      break;
    }
    const day = s.day;
    const logStart = s.log.length;
    let reply = await ask(observe(s, notes));
    let parsed = parseDecision(reply);
    notes = [];
    if (!parsed.ok) {
      reply = await ask(`Your reply was invalid:\n- ${parsed.errors.join('\n- ')}\nReply again with only the JSON object for day ${day}.`);
      parsed = parseDecision(reply);
    }
    if (!parsed.ok) {
      s = runDay(s, []).state;
      notes.push(`Your reply for day ${day} was invalid twice, so the day passed with nothing done.`);
      const t: Turn = { day, thoughts: '', site: null, exit: null, queue: [], invalid: true, reply, errors: parsed.errors, journal: s.log.slice(logStart).map(l => l.text), after: snapshot(s, warmth), progress: progressOf(s, startKnown), ...broken(s) };
      turns.push(t); opts.onTurn?.(t);
      continue;
    }

    const d = parsed.decision;
    if (d.focus) s = setFocus(s, parseFocus(d.focus));
    // A site can only be claimed once ring 1 is scouted. A day-1 plan of "scout, then settle" is
    // reasonable, so when the land isn't scouted yet the claim waits until after the day's queue.
    const deferSite = !!d.site && d.site !== s.site && !scouted(s.explore, 1);
    if (d.site && d.site !== s.site && !deferSite) s = chooseSite(s, d.site);
    if (d.exit) {
      if (availableChoices(s.day, s.config.calendar).includes(d.exit)) {
        s = choose(s, d.exit);
        const t: Turn = { day, thoughts: d.thoughts, site: d.site, exit: d.exit, queue: [], invalid: false, journal: s.log.slice(logStart).map(l => l.text), after: snapshot(s, warmth), progress: progressOf(s, startKnown), ...broken(s) };
        turns.push(t); opts.onTurn?.(t);
        break;
      }
      notes.push(`The ${d.exit} exit was not open on day ${day}; the day was played instead.`);
    }
    // A build later in that same day still needs to know where: hand it the chosen site
    // (Build takes a `site` option, which claims the ground once the land is scouted).
    const queue = deferSite && d.site
      ? d.queue.map(item => {
        const { id, opts } = parseItem(item);
        return id === 'build' && !opts.site ? { q: typeof item === 'string' ? item : item.q, opts: { ...opts, site: d.site! } } : item;
      })
      : d.queue;
    const r = runDay(s, queue);
    s = r.state;
    if (deferSite && d.site && d.site !== s.site) s = chooseSite(s, d.site);
    if (r.remaining.length) notes.push(`${r.remaining.length} queued action(s) didn't fit in day ${day} and were dropped.`);
    const t: Turn = { day, thoughts: d.thoughts, site: d.site, exit: null, queue, invalid: false, journal: s.log.slice(logStart).map(l => l.text), after: snapshot(s, warmth), progress: progressOf(s, startKnown), ...broken(s) };
    turns.push(t); opts.onTurn?.(t);
  }

  return { player: player.name, turns, record: summarizeRun(s, 1), forced, usage, start, final: s };
}

/** `{ violations }` only when something is broken, so clean transcripts stay clean. */
function broken(s: Region1State): { violations?: string[] } {
  const v = invariantViolations(s);
  return v.length ? { violations: v } : {};
}
