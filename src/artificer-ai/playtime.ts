/**
 * How long a person would take to play a run (#1471) — an estimate from a transcript, so every
 * bench and AI run also says something about pacing: is a year in the Reach an evening or a week
 * of evenings?
 *
 * The model is deliberately simple: count what a person does, price each thing in seconds, and
 * add the reading. What a person does is what the transcript records — the days played, the
 * actions queued, the encounters answered, the road and the caravan meeting, and the journal lines
 * that came up. Three paces bracket it: a fast player who skims, a typical one, and a careful one
 * who reads everything and weighs each choice.
 *
 * These are guesses, not measurements. Every number lives in {@link PACES}, so once real playtime
 * is recorded in the app they can be fitted to it.
 */

/** What one pace costs, in seconds, plus reading speed in words a minute. */
export interface Pace {
  /** The intro, making the Warden (name, portrait, talents, stats) and packing: once per run — every Warden is new (#1455). */
  setup: number;
  /** Looking over a Reach day (vitals, stores, weather, the land) and ending it. */
  day: number;
  /** Choosing one action — what, where, and its options — on the Reach or the road. */
  action: number;
  /** Reading an encounter and answering it. */
  encounter: number;
  /** Looking over a road day (the village, the people, the caravan) and ending it. */
  roadDay: number;
  /** One step of the caravan meeting at the thaw. */
  meetingStep: number;
  /** Reading the journal, words a minute. */
  wpm: number;
}

export type PaceName = 'fast' | 'typical' | 'careful';

export const PACES: Readonly<Record<PaceName, Readonly<Pace>>> = {
  fast: { setup: 120, day: 8, action: 4, encounter: 10, roadDay: 6, meetingStep: 8, wpm: 350 },
  typical: { setup: 240, day: 20, action: 8, encounter: 25, roadDay: 15, meetingStep: 20, wpm: 230 },
  careful: { setup: 420, day: 40, action: 14, encounter: 45, roadDay: 30, meetingStep: 40, wpm: 160 },
};

/** The parts of a transcript the estimate reads — both a live `RunResult` and a saved transcript have them. */
export interface PlayRecord {
  turns: readonly { queue: readonly unknown[]; encounters?: readonly unknown[]; journal?: readonly string[] }[];
  road?: { turns: readonly { actions: readonly unknown[]; encounters?: readonly unknown[]; journal?: readonly string[] }[] };
  meeting?: { steps: readonly unknown[] };
  /** The budget ran out at the thaw (#1449): the road wasn't played, so the run is only part of a game. */
  roadStopped?: string;
}

/** What a person would have done in a run. */
export interface PlayCounts {
  days: number;
  actions: number;
  encounters: number;
  words: number;
  roadDays: number;
  roadActions: number;
  meetingSteps: number;
}

const wordsIn = (lines: readonly string[] | undefined): number => (lines ?? []).reduce((n, l) => n + l.split(/\s+/).filter(Boolean).length, 0);

/** Count what a person would have done: days, actions, encounters, the journal they'd read, the road and the meeting. */
export function playCounts(t: PlayRecord): PlayCounts {
  const road = t.road?.turns ?? [];
  return {
    days: t.turns.length,
    actions: t.turns.reduce((n, d) => n + d.queue.length, 0),
    encounters: t.turns.reduce((n, d) => n + (d.encounters?.length ?? 0), 0) + road.reduce((n, d) => n + (d.encounters?.length ?? 0), 0),
    words: t.turns.reduce((n, d) => n + wordsIn(d.journal), 0) + road.reduce((n, d) => n + wordsIn(d.journal), 0),
    roadDays: road.length,
    roadActions: road.reduce((n, d) => n + d.actions.length, 0),
    meetingSteps: t.meeting?.steps.length ?? 0,
  };
}

/** Minutes at one pace. */
export function minutesAt(c: PlayCounts, p: Pace): number {
  const seconds = p.setup + c.days * p.day + (c.actions + c.roadActions) * p.action + c.encounters * p.encounter
    + c.roadDays * p.roadDay + c.meetingSteps * p.meetingStep + (c.words / p.wpm) * 60;
  return seconds / 60;
}

export interface Playtime { fast: number; typical: number; careful: number }

/** The estimate for a run, in whole minutes, at each pace. */
export function playtimeOf(t: PlayRecord): Playtime {
  const c = playCounts(t);
  return { fast: Math.round(minutesAt(c, PACES.fast)), typical: Math.round(minutesAt(c, PACES.typical)), careful: Math.round(minutesAt(c, PACES.careful)) };
}

/** "38 min (22 min–70 min)" — typical, then the fast–careful range; hours past 90 minutes ("1.7 h (52 min–2.9 h)"). */
export function playtimeText(p: Playtime): string {
  const f = (m: number): string => (m >= 90 ? `${(m / 60).toFixed(1)} h` : `${m} min`);
  return `${f(p.typical)} (${f(p.fast)}–${f(p.careful)})`;
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/**
 * Over a set of runs: the median at each pace, and how many runs it covers. Runs the budget cut off
 * at the thaw are left out — they're only part of a game, and would pull the median down. (Runs
 * stopped mid-Reach never reach the report.) Null when no whole run is left.
 */
export function playtimeSummaryOf(runs: readonly PlayRecord[]): (Playtime & { runs: number }) | null {
  const whole = runs.filter(r => !r.roadStopped);
  if (!whole.length) return null;
  const each = whole.map(playtimeOf);
  return { runs: whole.length, fast: median(each.map(e => e.fast)), typical: median(each.map(e => e.typical)), careful: median(each.map(e => e.careful)) };
}
