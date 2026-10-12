/**
 * The day on a timer (#1669): the queue's actions play out in real time, with a progress bar
 * and a clock moving through the hours, instead of the results appearing all at once.
 *
 * **Presentation only.** The day is resolved exactly as before, by `runQueuedDay` (or `act`,
 * or `runWholeQueue`), and that result is what the game keeps. This module then works out how
 * the day got there, one action at a time, so the page can replay it slowly: which log lines
 * each action wrote, how many hours it took, and the state once it finished. Nothing here
 * draws a random number or changes the sim, so the API, the MCP server and the AI player stay
 * instant and see the same game.
 *
 * Kept pure (no DOM, no timers, no storage) so the rules can be unit-tested in Node; `main.ts`
 * drives the clock, and the tests pin that a replayed day ends in the state the instant run
 * gives (playback.test.ts).
 */

import { DAY_HOURS, endDay, runAction, sessionOf, type QueueItem, type Region1State } from '../artificer/region1';
import { DAY_START } from '../artificer/clock';
import { act, runQueuedDay, runWholeQueue, type AppState } from './controller';

/** One leg of a trip session (#1668): walking out, working the patch, or walking back. */
export interface Phase {
  kind: 'out' | 'work' | 'back';
  /** Which trip of the session (1-based), and how many trips there are. */
  trip: number;
  trips: number;
  /** In-game hours, scaled to what the action really took. */
  hours: number;
}

/** One action of the day, as it played out. */
export interface PlayStep {
  item: QueueItem;
  /** Waking hours already spent when it started (the clock reads 06:00 plus this). */
  start: number;
  /** Hours it took: 0 for an action that was refused (a skip costs no time). */
  hours: number;
  /** The journal lines it wrote: `sim.log.slice(logFrom)`. */
  logFrom: number;
  /** The sim once it finished. */
  sim: Region1State;
  /** A session of chosen length (#1668) as its trips' legs; null for anything else. */
  phases: Phase[] | null;
}

/** A day (or a single action) worked out for the timer. */
export interface DayPlay {
  before: AppState;
  /** What the instant run gives: the only state the game keeps. */
  after: AppState;
  steps: PlayStep[];
  /** The night comes at the end (false when an encounter paused the day, or for one action done by hand). */
  night: boolean;
  /** The steps came off the queue (a day run), rather than one thing done by hand. */
  fromQueue: boolean;
}

/**
 * The trips of a session of chosen length, as legs (#1668): out, work, back for each trip.
 * Walking time is split evenly there and back. Scaled to `took`, the hours the action really
 * took (an accident or an encounter can cut a session short). Null for a usual action.
 */
export function phasesOf(s: Region1State, item: QueueItem, took: number): Phase[] | null {
  const ses = sessionOf(s, item);
  if (!ses || took <= 0) return null;
  const planned = ses.plan.work + ses.plan.travel;
  if (planned <= 0) return null;
  const k = took / planned;
  const n = ses.plan.trips.length;
  const out: Phase[] = [];
  ses.plan.trips.forEach((t, i) => {
    const walk = (t.travel / 2) * k;
    if (walk > 0) out.push({ kind: 'out', trip: i + 1, trips: n, hours: walk });
    if (t.work > 0) out.push({ kind: 'work', trip: i + 1, trips: n, hours: t.work * k });
    if (walk > 0) out.push({ kind: 'back', trip: i + 1, trips: n, hours: walk });
  });
  return out.length ? out : null;
}

/** One action stepped, the way `runDay` steps it. */
function stepOnce(sim: Region1State, item: QueueItem): PlayStep {
  const next = runAction(sim, item);
  const hours = Math.max(0, next.hoursToday - sim.hoursToday);
  return { item, start: sim.hoursToday, hours, logFrom: sim.log.length, sim: next, phases: phasesOf(sim, item, hours) };
}

/**
 * The state a play's steps lead to: the last step's sim, then the night if it came. For a
 * faithful play this equals `after.sim` (the tests pin it, and `playDay` checks it).
 */
export function replayedEnd(p: DayPlay): Region1State {
  const last = p.steps.length ? p.steps[p.steps.length - 1].sim : p.before.sim;
  return p.night ? endDay(last) : last;
}

/**
 * If stepping ever disagreed with the instant run (a future change to `runDay` this file
 * missed), the timer would show something that didn't happen. Then show nothing step by step:
 * the day simply arrives, as it did before the timer.
 */
function faithful(p: DayPlay): DayPlay {
  return JSON.stringify(replayedEnd(p)) === JSON.stringify(p.after.sim) ? p : { ...p, steps: [], night: false };
}

/**
 * Today's queue, for the timer: `runQueuedDay`'s result, and the steps that got there. The
 * stepping mirrors `runDay`: one action at a time while the day has hours left (only the first
 * before planning is learned, #1350), stopping where an encounter waits for the player (#1343).
 * `after` is the instant run's result when the caller already has it (the whole queue does).
 */
export function playDay(a: AppState, after: AppState = runQueuedDay(a)): DayPlay {
  const s = a.sim;
  if (after === a || s.outcome || s.pending) return { before: a, after, steps: [], night: false, fromQueue: true };
  const steps: PlayStep[] = [];
  let sim = s;
  const remaining = [...a.queue];
  if (!s.canPlan) {
    if (remaining.length) { const st = stepOnce(sim, remaining.shift() as QueueItem); steps.push(st); sim = st.sim; }
  } else {
    while (remaining.length > 0 && sim.hoursToday < DAY_HOURS) {
      const st = stepOnce(sim, remaining.shift() as QueueItem);
      steps.push(st);
      sim = st.sim;
      if (sim.pending) break;
    }
  }
  return faithful({ before: a, after, steps, night: !sim.pending, fromQueue: true });
}

/** One thing done now, before planning is learned (#1350): `act`'s result, as a single step with no night. */
export function playAct(a: AppState, item: QueueItem): DayPlay {
  const after = act(a, item);
  if (after === a) return { before: a, after, steps: [], night: false, fromQueue: false };
  return faithful({ before: a, after, steps: [stepOnce(a.sim, item)], night: false, fromQueue: false });
}

/** The whole queue, day after day (`runWholeQueue`), each day worked out for the timer. */
export function playWholeQueue(a: AppState): DayPlay[] {
  const days: DayPlay[] = [];
  runWholeQueue(a, (before, after) => { days.push(playDay(before, after)); });
  return days;
}

// ── The timeline ────────────────────────────────────────────────────────────

/** Real milliseconds per in-game hour at 1× (the owner's choice: about 10 s, #1669). */
export const MS_PER_HOUR = 10_000;
/** The speeds on offer. */
export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
/** A stored speed, or 1× for anything else. */
export const parseSpeed = (raw: string | null | undefined): Speed => (SPEEDS as readonly number[]).includes(Number(raw)) ? Number(raw) as Speed : 1;

/** A refused action still gets a beat, so its line can be read (in-game hours of playback). */
export const SKIP_BEAT = 0.15;
/** The night's beat at the end of the day. */
export const NIGHT_BEAT = 0.3;

/** How long each segment of a play lasts on the timer, in playback hours: each step, then the night. */
export function segmentsOf(p: DayPlay): number[] {
  return [...p.steps.map(s => Math.max(s.hours, SKIP_BEAT)), ...(p.night ? [NIGHT_BEAT] : [])];
}

/** The whole play's length on the timer, in playback hours. */
export const lengthOf = (p: DayPlay): number => segmentsOf(p).reduce((x, y) => x + y, 0);

/** Where the timer is in a play. */
export interface Moment {
  /** The step running (`steps.length` for the night), or -1 when there's nothing to play. */
  index: number;
  /** How far through it, 0..1. */
  frac: number;
  /** How many steps have finished. */
  done: number;
  /** The clock, in hours (8.5 = 08:30). */
  clock: number;
  /** The trip leg running, for a session of chosen length. */
  phase: Phase | null;
  /** The whole play has run. */
  over: boolean;
}

/** The moment `t` playback hours into a play. */
export function momentAt(p: DayPlay, t: number): Moment {
  const segs = segmentsOf(p);
  if (!segs.length) return { index: -1, frac: 1, done: 0, clock: DAY_START + p.before.sim.hoursToday, phase: null, over: true };
  let at = Math.max(0, t);
  for (let i = 0; i < segs.length; i++) {
    if (at < segs[i]) {
      const frac = at / segs[i];
      if (i >= p.steps.length) return { index: i, frac, done: p.steps.length, clock: endClock(p), phase: null, over: false };
      const st = p.steps[i];
      return { index: i, frac, done: i, clock: DAY_START + st.start + st.hours * frac, phase: phaseAt(st, frac), over: false };
    }
    at -= segs[i];
  }
  return { index: segs.length - 1, frac: 1, done: p.steps.length, clock: endClock(p), phase: null, over: true };
}

/** The clock once the last step finished. */
const endClock = (p: DayPlay): number => {
  const last = p.steps[p.steps.length - 1];
  return DAY_START + (last ? last.start + last.hours : p.before.sim.hoursToday);
};

/** The leg of a session running `frac` of the way through it. */
function phaseAt(st: PlayStep, frac: number): Phase | null {
  if (!st.phases) return null;
  let at = frac * st.hours;
  for (const ph of st.phases) {
    if (at < ph.hours) return ph;
    at -= ph.hours;
  }
  return st.phases[st.phases.length - 1];
}

/** "08:30" for 8.5. */
export function clockText(h: number): string {
  const mins = Math.floor(h * 60 + 1e-6);
  return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * What the screen shows `done` steps into a play: the sim as the last finished step left it,
 * and the queue without the steps already taken off it.
 */
export function shownAt(p: DayPlay, done: number): AppState {
  const sim = done > 0 ? p.steps[Math.min(done, p.steps.length) - 1].sim : p.before.sim;
  return { ...p.before, sim, queue: p.fromQueue ? p.before.queue.slice(done) : p.before.queue };
}

/** The journal lines a play has written by `done` steps in, and the night's once it's reached. */
export function linesAt(p: DayPlay, done: number, night: boolean): Region1State['log'] {
  const lines = p.steps.slice(0, done).flatMap(st => st.sim.log.slice(st.logFrom));
  if (!night || !p.night) return lines;
  const from = p.steps.length ? p.steps[p.steps.length - 1].sim.log.length : p.before.sim.log.length;
  return [...lines, ...p.after.sim.log.slice(from)];
}

/** The plays that have anything to show on the timer. */
export const worthPlaying = (plays: readonly DayPlay[]): boolean => plays.some(p => p.steps.length > 0 || p.night);
