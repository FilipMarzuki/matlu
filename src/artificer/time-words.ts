/**
 * The time of day in words, until the Warden has a way to tell the hour (#1740, switch `time-words`).
 *
 * The owner's idea, after the descriptive map (#1686) and the weather in words (#1729): a scout who
 * has just fallen into another world has no watch that keeps this world's time, so the queue box's
 * "6 / 14h" and an action's "4H" are too exact. At the start you know the time of day the way you'd
 * say it: "Early morning, the sun just up." A task takes "part of the morning" or "all afternoon",
 * and the plan ends "around dusk" or "runs past dark".
 *
 * The words follow the day's real light: sunrise and sunset come from the clock (clock.ts), so as
 * autumn shortens the days, the same four hours cover more of them in words too. The parts of the
 * day, from the waking hour (06:00) on:
 *
 * - **early** — until an hour after sunrise (still dark before it in winter, grey at first light);
 * - **morning** — until an hour before the sun is highest (the midpoint of sunrise and sunset);
 * - **midday** — the two hours around it;
 * - **afternoon** — until an hour before sunset;
 * - **evening** — from then until the twilight is gone, an hour after sunset;
 * - **night** — after that.
 *
 * For a task's length the early morning counts as the morning ("all morning" from waking), so the
 * spans are morning, midday, afternoon, evening and night.
 *
 * Precision is earned, like the map and the calendar; this first step is the words alone:
 *
 * - **hours** — the switch off: hours and "h" as before.
 * - **words** — the switch on: the words above, no numbers. (Dev mode shows the hours, app-side.)
 *
 * Earning the hours back (rough hours once you keep a day tally, exact hours with a sundial or a
 * watch) is an open question for the owner; `TimeView` is where those levels would go.
 *
 * Pure and deterministic, and presentation only: the day, the hours spent and the calendar are all it
 * reads. Nothing is saved and nothing draws on a random stream, so the sim's hours, the 14-hour day
 * and its timing work exactly as before: same seed, same game. No sim module imports this (a test
 * checks it); the app, the API's text and the AI's observation do. The words are drawn through the
 * i18n catalog (en/time.ts, sv/time.ts): the AI reads them in English, the page in the viewer's language.
 */

import { featureOn } from './features';
import { DAY_START, TWILIGHT_HOURS, lightAt, sunrise, sunset } from './clock';
import type { Calendar } from './winter';
import type { Key, T } from './i18n';
import type { Region1State } from './region1';

/** The rule switch (features.ts). */
export const TIME_WORDS = 'time-words';

/** The waking day: 14 hours from 06:00 (region1.ts DAY_HOURS, repeated so this stays free of the sim). */
const WAKING_HOURS = 14;

export const timeWordsOn = (s: Pick<Region1State, 'config'>): boolean => featureOn(s.config.world.features, TIME_WORDS);

/** What the queue box shows: `hours` is the clock and hours (the switch off); `words` the time of day in words. */
export type TimeView = 'hours' | 'words';
export const timeView = (s: Pick<Region1State, 'config'>): TimeView => (timeWordsOn(s) ? 'words' : 'hours');

// ── The parts of the day ────────────────────────────────────────────────────

export type DayPart = 'early' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
export const DAY_PARTS: readonly DayPart[] = ['early', 'morning', 'midday', 'afternoon', 'evening', 'night'];

/** The early morning lasts until this long after sunrise. */
export const EARLY_AFTER_SUNRISE = 1;
/** Midday is this long either side of the sun's highest point. */
export const MIDDAY_HALF = 1;
/** The evening starts this long before sunset (and lasts until the twilight is gone). */
export const EVENING_BEFORE_SUNSET = 1;

/** One day's light: sunrise, sunset, the sun's highest point, and where each part of the day ends. */
export interface DayShape {
  up: number;
  down: number;
  noon: number;
  /** Clock hours where early, morning, midday, afternoon and evening end; night runs on from the last. */
  ends: readonly [number, number, number, number, number];
}

export function dayShape(day: number, cal: Calendar): DayShape {
  const up = sunrise(day, cal), down = sunset(day, cal);
  const noon = (up + down) / 2;
  return { up, down, noon, ends: [up + EARLY_AFTER_SUNRISE, noon - MIDDAY_HALF, noon + MIDDAY_HALF, down - EVENING_BEFORE_SUNSET, down + TWILIGHT_HOURS] };
}

/** The part of the day at a clock hour (8.5 = 08:30). */
export function partAt(clock: number, shape: DayShape): DayPart {
  const i = shape.ends.findIndex(end => clock < end);
  return DAY_PARTS[i < 0 ? DAY_PARTS.length - 1 : i];
}

// ── Now ─────────────────────────────────────────────────────────────────────

/** The light as you see it now: dark, the grey before sunrise or after sunset, or the sun up. */
export type Light = 'dark' | 'grey' | 'sun';
export interface NowWords { part: DayPart; light: Light }

/** When in the day it is, `hoursToday` hours after waking. */
export function nowWords(day: number, hoursToday: number, cal: Calendar): NowWords {
  const clock = DAY_START + hoursToday;
  const l = lightAt(day, clock, cal);
  return { part: partAt(clock, dayShape(day, cal)), light: l >= 1 ? 'sun' : l > 0 ? 'grey' : 'dark' };
}

// ── How long a task takes ───────────────────────────────────────────────────

/** The spans a task's length is told in: the early morning counts as the morning. */
export type SpanPart = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';
const SPANS: readonly SpanPart[] = ['morning', 'midday', 'afternoon', 'evening', 'night'];
const spanOf = (p: DayPart): SpanPart => (p === 'early' ? 'morning' : p);

/** Less than this is "a short while", whatever the hour. */
export const MOMENT_HOURS = 0.75;
/** A task covering this much of its part of the day takes "all" of it. */
export const ALL_OF = 0.65;
/** A task ending within this long of its part's end takes "the rest" of it. */
export const REST_WITHIN = 0.5;
/** A task across three parts or more that covers this much of the daylight takes "most of the day". */
export const MOST_OF = 0.7;

export type Duration =
  | { kind: 'moment' }
  | { kind: 'all' | 'part' | 'rest'; part: SpanPart }
  | { kind: 'into'; from: SpanPart; to: SpanPart }
  | { kind: 'span'; from: SpanPart; to: SpanPart }
  | { kind: 'pastDark'; from: SpanPart }
  | { kind: 'most' };

/** Where a span of the day starts and ends, on this day (the night runs to the end of the waking day, or past it). */
function spanBounds(p: SpanPart, shape: DayShape, end: number): [number, number] {
  const [, morning, midday, afternoon, evening] = shape.ends;
  switch (p) {
    case 'morning': return [DAY_START, morning];
    case 'midday': return [morning, midday];
    case 'afternoon': return [midday, afternoon];
    case 'evening': return [afternoon, evening];
    default: return [evening, Math.max(DAY_START + WAKING_HOURS, end)];
  }
}

/**
 * A task's length in words, from when it starts (`start` hours after waking) and how long it takes.
 * Null for a task that takes no time (a refused one is skipped, and says so).
 */
export function durationWords(day: number, start: number, hours: number, cal: Calendar): Duration | null {
  if (hours <= 0) return null;
  if (hours < MOMENT_HOURS) return { kind: 'moment' };
  const shape = dayShape(day, cal);
  const a = DAY_START + start, e = a + hours;
  // The part the last moment of work falls in: a task ending on the stroke of midday is a morning's.
  const from = spanOf(partAt(a, shape)), to = spanOf(partAt(e - 1e-6, shape));
  const gap = SPANS.indexOf(to) - SPANS.indexOf(from);
  if (gap === 0) {
    const [s0, s1] = spanBounds(from, shape, e);
    if (hours / (s1 - s0) >= ALL_OF) return { kind: 'all', part: from };
    return { kind: s1 - e <= REST_WITHIN ? 'rest' : 'part', part: from };
  }
  if (to === 'night') return { kind: 'pastDark', from };
  if (gap === 1) return { kind: 'into', from, to };
  const lit = Math.max(0, Math.min(e, shape.down) - Math.max(a, shape.up)) / (shape.down - shape.up);
  return lit >= MOST_OF ? { kind: 'most' } : { kind: 'span', from, to };
}

/** The part of the day a plan ends in, `hours` after waking. */
export const endWords = (day: number, hours: number, cal: Calendar): DayPart => partAt(DAY_START + hours, dayShape(day, cal));

/**
 * When each queued task would start, in hours after waking on its own day: the queue's days and
 * hours as the preview has them (`day` 0 is today; a skipped task takes no hours). Then where a task
 * added now would start: after the last one, or first thing the next day once that day is full.
 */
export function queueStarts(hoursToday: number, steps: readonly { day: number; hours: number }[]): { starts: number[]; next: { day: number; start: number } } {
  let h = hoursToday, d = 0;
  const starts = steps.map(st => {
    if (st.day !== d) { d = st.day; h = 0; }
    const at = h;
    h += st.hours;
    return at;
  });
  return { starts, next: h >= WAKING_HOURS ? { day: d + 1, start: 0 } : { day: d, start: h } };
}

// ── The words, through the catalog ──────────────────────────────────────────

/** "Early morning, the sun just up." */
export function nowText(n: NowWords, t: T): string {
  if (n.part === 'early') return t(`time.now.early.${n.light}` as Key);
  if (n.part === 'evening') return t(n.light === 'sun' ? 'time.now.evening.sun' : 'time.now.evening.dusk');
  return t(`time.now.${n.part}` as Key);
}

/** "all morning", "the afternoon and into the evening", "from midday until dusk". */
export function durationText(d: Duration, t: T): string {
  switch (d.kind) {
    case 'moment': return t('time.moment');
    case 'most': return t('time.most');
    case 'all': case 'part': case 'rest': return t(`time.${d.kind}.${d.part}` as Key);
    case 'into': return t('time.into', { from: t(`time.from.${d.from}` as Key), to: t(`time.to.${d.to}` as Key) });
    case 'span': return t('time.span', { from: t(`time.from.${d.from}` as Key), until: t(`time.until.${d.to}` as Key) });
    case 'pastDark': return t('time.pastDark', { from: t(`time.from.${d.from}` as Key) });
  }
}

/** "You'd be done around dusk." / "This runs past dark." */
export const endText = (p: DayPart, t: T): string => t(`time.end.${p}` as Key);

/** The part of the day in a word or two, for the status bar and the timer ("MORNING"). */
export const partShort = (p: DayPart, t: T): string => t(`time.short.${p}` as Key);
