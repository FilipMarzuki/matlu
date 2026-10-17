/**
 * Acceptance tests for #1740 — the time of day in words in the queue box, at the start (switch
 * `time-words`). One test per Given/When/Then, in the issue's order:
 *
 *   1. Start of day — given a new day before any task, the queue's "now" line describes early
 *                     morning in words, with no hours, in both languages (and the AI and the API see it).
 *   2. Day parts    — given the day's real sunrise and sunset, the parts of the day change where they should.
 *   3. Durations    — given a 4-hour task starting at dawn, it reads as all morning; one starting
 *                     mid-afternoon runs toward dusk; short, partial, rest-of, most-of and past-dark tasks too.
 *   4. End of queue — given a queue past dusk, the box says it runs past dark.
 *   5. Short days   — given a late-autumn day, the same task covers more of the daylight in words.
 *   6. Dev mode     — given dev mode, exact hours show as today.
 *   7. Switch off   — given the switch off (or a run from before it), hours show exactly as today.
 *   8. Same game    — given the same seed and moves, the same run, switch on or off.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegion1, queueHours, DAY_HOURS, type QueueItem, type Region1State } from './region1';
import { FULL_WORLD, type WorldConfig } from './world';
import { makeT } from './i18n';
import { DEFAULT_CALENDAR, MIDWINTER_AFTER } from './winter';
import { sunrise, sunset } from './clock';
import { TIME_WORDS, dayShape, partAt, nowWords, nowText, durationWords, durationText, endWords, queueStarts, timeView } from './time-words';
import { previewQueue, todayHours, type AppState } from '../artificer-app/controller';
import { paletteBlock, phaseText } from '../artificer-app/camp-blocks';
import { actionTime, nowTotal, queueTimes, timerClock, timerLength } from '../artificer-app/time-view';
import { clockText, type DayPlay, type Moment } from '../artificer-app/playback';
import { observe } from '../artificer-ai/observe';
import { playRun } from '../artificer-ai/runner';
import { scriptedPlayer } from '../artificer-ai/players/scripted';
import { startGame, view } from '../artificer-play/session';

const en = makeT('en');
const sv = makeT('sv');
const cal = DEFAULT_CALENDAR;

const world = (on: boolean | 'absent'): WorldConfig => ({ ...FULL_WORLD, encounters: false, ...(on === 'absent' ? {} : { features: { [TIME_WORDS]: on } }) });

/** A Warden on a given day and hour: the words only read the state, so this is all they need. */
const warden = (over: Partial<Region1State> = {}, on: boolean | 'absent' = true): Region1State =>
  ({ ...createRegion1({ planning: 'learned', world: world(on) }, undefined, { id: 'w-sigrid' }), ...over });
const app = (sim: Region1State, queue: QueueItem[] = []): AppState => ({ sim, queue, stage: 'reach' });

/** Any digit, or an "h" standing alone (as in "4h" or "6 / 14h"). */
const NUMBERS = /\d|(?<!\p{L})h(?!\p{L})/u;
const textOf = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").trim();
const late = cal.winterDay - 3;
const midwinter = cal.winterDay + MIDWINTER_AFTER;

describe('The time of day in words (#1740)', () => {
  it('1. start of day: the "now" line describes early morning in words, with no hours', () => {
    const s = warden();
    expect(timeView(s)).toBe('words');
    // Day 1 at 06:00: the sun rises at 07:00, so the first grey light.
    expect(nowWords(s.day, s.hoursToday, cal)).toEqual({ part: 'early', light: 'grey' });
    const a = app(s, ['water', 'wood']);
    for (const t of [en, sv]) {
      const q = queueTimes(a, previewQueue(a), t, false);
      expect(q.now).toBe(t('time.now.early.grey'));
      for (const text of [q.now!, ...q.rows, textOf(q.total), q.status, q.empty, textOf(nowTotal(s, t, false))]) expect(text).not.toMatch(NUMBERS);
      // The action buttons too: every length in words.
      const palette = paletteBlock(a, previewQueue(a), { dev: false, t });
      expect([...palette.matchAll(/<span class="h">([^<]*)<\/span>/g)].map(m => m[1]).filter(x => NUMBERS.test(x))).toEqual([]);
    }
    expect(queueTimes(app(s), previewQueue(app(s)), en, false).now).toBe('Early morning, the first grey light.');
    expect(queueTimes(app(s), previewQueue(app(s)), sv, false).now).toBe('Tidig morgon, det första grå ljuset.');
    // The AI and the API are told the same words (the hours stay for planning).
    expect(observe(s)).toContain('TIME OF DAY: Early morning, the first grey light.');
    expect(view(startGame({ seed: 'tw-1', features: { [TIME_WORDS]: true } })).text).toContain('TIME OF DAY: Early morning, the first grey light.');
    expect(view(startGame({ seed: 'tw-1', features: { [TIME_WORDS]: true }, lang: 'sv' })).text).toContain('Tid på dagen: Tidig morgon, det första grå ljuset.');
  });

  it('2. the parts of the day follow the day\'s real sunrise and sunset', () => {
    // Day 1: sunrise 07:00, sunset 18:30, the sun highest at 12:45.
    const d1 = dayShape(1, cal);
    expect(d1.ends).toEqual([8, 11.75, 13.75, 17.5, 19.5]);
    const at = (h: number): string => partAt(h, d1);
    expect([at(6), at(7.99), at(8), at(11.74), at(11.75), at(13.74), at(13.75), at(17.49), at(17.5), at(19.49), at(19.5), at(21)])
      .toEqual(['early', 'early', 'morning', 'morning', 'midday', 'midday', 'afternoon', 'afternoon', 'evening', 'evening', 'night', 'night']);
    // The light within the early morning and the evening.
    expect(nowWords(1, 1.5, cal)).toEqual({ part: 'early', light: 'sun' });
    expect(nowText(nowWords(1, 12, cal), en)).toBe('Evening, the sun low over the trees.');
    expect(nowText(nowWords(1, 13, cal), en)).toBe('Dusk, the light going.');
    expect(nowText(nowWords(1, 14, cal), en)).toBe('Night has fallen.');
    // Midwinter: still dark at waking, and the evening comes in the early afternoon by the clock.
    expect(nowText(nowWords(midwinter, 0, cal), en)).toBe('Early morning, still dark.');
    expect(partAt(sunset(midwinter, cal) - 0.5, dayShape(midwinter, cal))).toBe('evening');
    expect(sunset(midwinter, cal)).toBeLessThan(15);
    expect(partAt(sunrise(midwinter, cal) + 2, dayShape(midwinter, cal))).toBe('midday');
  });

  it('3. durations: from the task\'s real hours and when it starts', () => {
    const words = (day: number, start: number, hours: number) => durationText(durationWords(day, start, hours, cal)!, en);
    // A 4-hour task from waking (06:00) is all morning, on day 1 and in midwinter.
    expect(durationWords(1, 0, 4, cal)).toEqual({ kind: 'all', part: 'morning' });
    expect(words(1, 0, 4)).toBe('all morning');
    expect(durationText(durationWords(1, 0, 4, cal)!, sv)).toBe('hela morgonen');
    expect(words(midwinter, 0, 4)).toBe('all morning');
    // From mid-afternoon (15:00) it runs into the evening, toward dusk.
    expect(durationWords(1, 9, 4, cal)).toEqual({ kind: 'into', from: 'afternoon', to: 'evening' });
    expect(words(1, 9, 4)).toBe('the afternoon and into the evening');
    expect(durationText(durationWords(1, 9, 4, cal)!, sv)).toBe('eftermiddagen och in på kvällen');
    // The rest of the scale.
    expect(words(1, 0, 0.5)).toBe('a short while');
    expect(words(1, 0, 1.5)).toBe('part of the morning');
    expect(words(1, 3, 2.75)).toBe('the rest of the morning');
    expect(words(1, 6, 1)).toBe('around midday');
    expect(words(1, 0, 12)).toBe('most of the day');
    expect(words(1, 10, 4)).toBe('from the afternoon until past dark');
    // A task that takes no time (refused) has no length.
    expect(durationWords(1, 0, 0, cal)).toBeNull();
    // No digits in any of it, in either language.
    for (const t of [en, sv]) for (const [st, h] of [[0, 0.5], [0, 1.5], [3, 2.75], [6, 1], [0, 12], [10, 4], [9, 4], [6, 4]] as const) {
      expect(durationText(durationWords(1, st, h, cal)!, t)).not.toMatch(NUMBERS);
      expect(durationText(durationWords(late, st, h, cal)!, t)).not.toMatch(NUMBERS);
    }
    // Each queued task starts where the one before it ended, the next day from waking; a skipped one takes no time.
    expect(queueStarts(2, [{ day: 0, hours: 4 }, { day: 0, hours: 0 }, { day: 0, hours: 9 }, { day: 1, hours: 3 }])).toEqual({ starts: [2, 6, 6, 0], next: { day: 1, start: 3 } });
    expect(queueStarts(10, [{ day: 0, hours: 5 }]).next).toEqual({ day: 1, start: 0 });
  });

  it('4. end of queue: a queue past dusk says it runs past dark', () => {
    const s = warden();
    // Wood until today's plan reaches the end of the waking day (the last task can run past it).
    let a = app(s);
    while (todayHours(a) < DAY_HOURS) a = { ...a, queue: [...a.queue, 'wood'] };
    expect(endWords(s.day, todayHours(a), cal)).toBe('night');
    expect(textOf(queueTimes(a, previewQueue(a), en, false).total)).toBe('This runs past dark.');
    expect(textOf(queueTimes(a, previewQueue(a), sv, false).total)).toBe('Det här drar ut till efter mörkrets inbrott.');
    expect(queueTimes(a, previewQueue(a), en, false).status).toBe('NIGHT');
    // A short plan ends earlier in the day, in words.
    const short = app(s, ['water']);
    expect(textOf(queueTimes(short, previewQueue(short), en, false).total)).toBe("You'd be done before midday.");
    // An empty queue has no end to tell.
    expect(queueTimes(app(s), previewQueue(app(s)), en, false).total).toBe('');
  });

  it('5. short days: on a late-autumn day the same task covers more of the daylight in words', () => {
    // Four hours from midday (12:00): into the afternoon on day 1, until dusk late in autumn.
    expect(durationWords(1, 6, 4, cal)).toEqual({ kind: 'into', from: 'midday', to: 'afternoon' });
    expect(durationWords(late, 6, 4, cal)).toEqual({ kind: 'span', from: 'midday', to: 'evening' });
    expect(durationText(durationWords(late, 6, 4, cal)!, en)).toBe('from midday until dusk');
    expect(durationText(durationWords(late, 6, 4, cal)!, sv)).toBe('från middagstid till skymningen');
    // The same clock hour is later in the day's light, too.
    expect(partAt(16, dayShape(1, cal))).toBe('afternoon');
    expect(partAt(16, dayShape(late, cal))).toBe('evening');
  });

  it('6. dev mode shows exact hours, as today', () => {
    const s = warden({ hoursToday: 2.5 });
    const a = app(s, ['wood']);
    const preview = previewQueue(a);
    const dev = queueTimes(a, preview, en, true);
    expect(dev.now).toBeNull();
    expect(dev.rows).toEqual([`${queueHours('wood', preview.before[0])}h`]);
    expect(dev.total).toBe(`Today <b>${todayHours(a)} / 14h</b>`);
    expect(dev.status).toBe(`${todayHours(a)}/14H`);
    expect(nowTotal(s, en, true)).toBe('Today <b>2.5 / 14h</b>');
    expect(timerClock(s, 8.5, en, true)).toBe('08:30');
    expect(timerLength(s, 0, 4, en, true)).toBe('4h');
    expect(actionTime(a, preview, 4, en, true)).toBe('4H');
    expect(paletteBlock(a, preview, { dev: true, t: en })).toMatch(/<span class="h">\d+(\.\d)?H<\/span>/);
  });

  it('7. with the switch off, or a run from before it, hours show exactly as today', () => {
    const play = (s: Region1State): DayPlay => ({ before: app(s), after: app(s), steps: [{ item: 'wood', start: 0, hours: 4, logFrom: 0, sim: s, phases: null }], night: true, fromQueue: true });
    const moment: Moment = { index: 0, frac: 0.5, done: 0, clock: 8, phase: null, over: false };
    for (const on of [false, 'absent'] as const) {
      const s = warden({ hoursToday: 3 }, on);
      expect(timeView(s)).toBe('hours');
      const a = app(s, ['water', 'wood']);
      const preview = previewQueue(a);
      const q = queueTimes(a, preview, en, false);
      // Exactly the old strings: the queue rows, its total, the status bar, the empty queue's line.
      expect(q).toEqual({
        now: null,
        rows: a.queue.map((it, i) => `${queueHours(it, preview.before[i])}h`),
        total: `Today <b>${todayHours(a, preview)} / ${DAY_HOURS}h</b>`,
        status: `${todayHours(a, preview)}/${DAY_HOURS}H`,
        empty: en('queue.empty', { hours: DAY_HOURS }),
      });
      expect(nowTotal(s, en, false)).toBe('Today <b>3 / 14h</b>');
      expect(actionTime(a, preview, 4, en, false)).toBe('4H');
      expect(timerClock(s, 8.5, en, false)).toBe(clockText(8.5));
      expect(phaseText(play(s), moment, en)).toBe('4h');
      expect(observe(s)).not.toContain('TIME OF DAY');
      // The palette is the same, off or absent, with its hours.
      expect(paletteBlock(a, preview, { dev: false, t: en })).toBe(paletteBlock(app(warden({ hoursToday: 3 }, false), a.queue), previewQueue(app(warden({ hoursToday: 3 }, false), a.queue)), { dev: false, t: en }));
      expect(paletteBlock(a, preview, { dev: false, t: en })).toMatch(/<span class="h">\d+(\.\d)?H<\/span>/);
    }
    // Switched on, the same pieces are in words.
    const s = warden({ hoursToday: 3 });
    expect(phaseText(play(s), moment, en)).toBe('all morning');
    expect(timerClock(s, 8.5, en, false)).toBe('MORNING');
    expect(view(startGame({ seed: 'tw-7', features: { [TIME_WORDS]: false } })).text).not.toContain('TIME OF DAY');
    expect(view(startGame({ seed: 'tw-7', features: { [TIME_WORDS]: false }, lang: 'sv' })).text).not.toContain('Tid på dagen');
  });

  it('8. the same seed and moves play the same run, switch on or off', async () => {
    const told: string[] = [];
    const year = (on: boolean) => {
      const p = scriptedPlayer();
      return playRun(on ? { ...p, decide: (m, st) => { told.push(m); return p.decide(m, st); } } : p, { characterId: 'ai-scripted-s3-r1', encounters: false, features: { [TIME_WORDS]: on } });
    };
    const [a, b] = await Promise.all([year(true), year(false)]);
    const strip = (x: Region1State): unknown => ({ ...x, config: { ...x.config, world: { ...x.config.world, features: {} } } });
    expect(a.final.day).toBeGreaterThan(DEFAULT_CALENDAR.winterDay);
    expect(a.turns.map(t => t.day)).toEqual(b.turns.map(t => t.day));
    expect(strip(a.final)).toEqual(strip(b.final));
    expect(a.record.kind).toBe(b.record.kind);
    // The AI was told the time of day in words.
    expect(told[0]).toContain('TIME OF DAY: Early morning');
    // Nothing that plays the game reads the words: only the views (the app, the AI's and the API's text) do.
    const here = dirname(fileURLToPath(import.meta.url));
    const sim = readdirSync(here).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'time-words.ts');
    expect(sim.filter(f => /from '\.\/time-words'/.test(readFileSync(join(here, f), 'utf8')))).toEqual([]);
  }, 60_000);
});
