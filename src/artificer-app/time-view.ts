/**
 * The time of day on the page (#1740, switch `time-words`): the queue box, the action buttons, the
 * status bar and the timer, in words from time-words.ts or in hours as before.
 *
 * Each function gives exactly the text the page showed before when the words aren't shown (the
 * switch off, or dev mode, which always shows the hours), so main.ts and camp-blocks.ts can drop
 * them in where the hours were. Pure: state in, text out, so a test can draw them without a browser.
 */

import type { T } from '../artificer/i18n';
import { DAY_HOURS, queueHours, type QueueItem } from '../artificer/region1';
import { dayShape, durationText, durationWords, endText, endWords, nowText, nowWords, partAt, partShort, queueStarts, timeWordsOn } from '../artificer/time-words';
import { esc, hrs } from './html';
import { todayHours, type AppState, type QueuePreview } from './controller';
import { clockText } from './playback';

type Sim = AppState['sim'];

/** Words instead of hours: the switch on, and not in dev mode (dev always shows the hours). */
export const timeWordsShown = (s: Sim, dev: boolean): boolean => timeWordsOn(s) && !dev;

/** A task's length in words, starting `start` hours into day `day`; "a short while" for one that takes none. */
const lengthWords = (s: Sim, day: number, start: number, hours: number, t: T): string =>
  durationText(durationWords(day, start, hours, s.config.calendar) ?? { kind: 'moment' }, t);

/** The "now" line ("Early morning, the sun just up."), or null when the hours are shown. */
export const nowLine = (s: Sim, t: T, dev: boolean): string | null =>
  timeWordsShown(s, dev) ? nowText(nowWords(s.day, s.hoursToday, s.config.calendar), t) : null;

export interface QueueTimes {
  /** The "now" line above the queue, or null when the hours are shown. */
  now: string | null;
  /** Each queued task's length: "4h" as before, or "all morning". */
  rows: string[];
  /** The total under the queue (HTML): "Today 6 / 14h" as before, or where today's plan ends. */
  total: string;
  /** The status bar's TODAY (HTML-safe): "6/14H" as before, or the part of the day the plan ends in. */
  status: string;
  /** The empty queue's line. */
  empty: string;
}

/** The queue box's times, from the preview. */
export function queueTimes(a: AppState, preview: QueuePreview, t: T, dev: boolean): QueueTimes {
  const s = a.sim;
  const today = todayHours(a, preview);
  const hours = a.queue.map((item, i) => queueHours(item, preview.before[i]));
  if (!timeWordsShown(s, dev)) {
    return {
      now: null,
      rows: hours.map(h => `${hrs(h, t)}h`),
      total: `${esc(t('queue.todayHours'))} <b>${hrs(today, t)} / ${DAY_HOURS}h</b>`,
      status: `${hrs(today, t)}/${DAY_HOURS}H`,
      empty: t('queue.empty', { hours: DAY_HOURS }),
    };
  }
  const cal = s.config.calendar;
  // A refused task takes no time, so the next starts where it would have.
  const { starts } = queueStarts(s.hoursToday, a.queue.map((_, i) => ({ day: preview.dayOffset[i], hours: preview.warnings[i] ? 0 : hours[i] })));
  const runsToday = preview.dayOffset.some((d, i) => d === 0 && !preview.warnings[i]);
  return {
    now: nowLine(s, t, dev),
    rows: hours.map((h, i) => lengthWords(s, s.day + preview.dayOffset[i], starts[i], h, t)),
    total: runsToday ? `<b>${esc(endText(endWords(s.day, today, cal), t))}</b>` : '',
    status: esc(partShort(endWords(s.day, today, cal), t)),
    empty: t('time.queueEmpty'),
  };
}

/**
 * The weather row's time (weather-row.ts, #1825), HTML-safe. As before, the old TODAY chip's text:
 * the part of the day the plan ends in ("EVENING"). With `now` (the ui switch `day-forecast` on,
 * #2000), the time now ("EARLY MORNING"), or the hours so far ("6/14H") when the hours are shown: the
 * queue's own line says where the day ends then, and at the top of the page "Fog · Chilly · evening"
 * read as the time now, over a queue that said "Early morning, still dark."
 */
export function weatherRowTime(a: AppState, preview: QueuePreview, t: T, dev: boolean, now: boolean): string {
  if (!now) return queueTimes(a, preview, t, dev).status;
  const s = a.sim;
  return timeWordsShown(s, dev) ? esc(partShort(nowWords(s.day, s.hoursToday, s.config.calendar).part, t)) : `${hrs(s.hoursToday, t)}/${DAY_HOURS}H`;
}

/** One-at-a-time play's total: "Today 3 / 14h" as before, or the "now" line (HTML). */
export function nowTotal(s: Sim, t: T, dev: boolean): string {
  const now = nowLine(s, t, dev);
  return now ? esc(now) : `${esc(t('queue.todayHours'))} <b>${hrs(s.hoursToday, t)} / ${DAY_HOURS}h</b>`;
}

/**
 * An action button's length: "4H" as before, or how long it would take if added now, after the
 * queue ("all morning"). `hours` is the action's hours (queueHours against the queue's end state).
 */
export function actionTime(a: AppState, preview: QueuePreview, hours: number, t: T, dev: boolean): string {
  const s = a.sim;
  if (!timeWordsShown(s, dev)) return `${hrs(hours, t)}H`;
  const { next } = queueStarts(s.hoursToday, a.queue.map((_: QueueItem, i) => ({ day: preview.dayOffset[i], hours: preview.warnings[i] ? 0 : queueHours(a.queue[i], preview.before[i]) })));
  return lengthWords(s, s.day + next.day, next.start, hours, t);
}

/** The timer's clock: "08:30" as before, or the part of the day ("MORNING"). */
export const timerClock = (s: Sim, clock: number, t: T, dev: boolean): string =>
  timeWordsShown(s, dev) ? partShort(partAt(clock, dayShape(s.day, s.config.calendar)), t) : clockText(clock);

/** The timer's length of the action running: "4h" as before, or its length in words from when it started. */
export const timerLength = (s: Sim, start: number, hours: number, t: T, dev: boolean): string =>
  timeWordsShown(s, dev) ? lengthWords(s, s.day, start, hours, t) : `${hrs(hours, t)}h`;
