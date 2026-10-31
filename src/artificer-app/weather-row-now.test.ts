/**
 * #2000: the weather row says the time now. It used to say the part of the day the plan ends in (the
 * old TODAY chip's text), so on a morning with a day's plan queued the top of the page read "Fog ·
 * Chilly · evening" over a queue that said "Early morning, still dark." With the ui switch
 * `day-forecast` on, the line under the queue says where the day ends, and the row says the time now.
 * Off, nothing else says where the day ends, so the row is as before. The look is checked by
 * screenshot (`ui-hud`); what the row says is checked here, in English and Swedish, with no browser.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { knownSpots } from '../artificer/camp-sites';
import { endDay, runAction, type QueueItem, type Region1State } from '../artificer/region1';
import { enqueue, makeWarden, previewQueue, type AppState } from './controller';
import { dayEnd, dayEndText } from './day-forecast';
import { queueTimes, weatherRowTime } from './time-view';
import { weatherRowText } from './weather-row';

const en = makeT('en');
const sv = makeT('sv');

/** A Warden who has scouted, made camp and slept: the next morning, nothing done yet, able to plan. */
function morning(): Region1State {
  let s = makeWarden({ id: 'w-2000' }).sim;
  for (const q of ['scout', 'survey', 'explore'] as QueueItem[]) s = runAction(s, q);
  s = runAction(s, { q: 'camp', opts: { spot: knownSpots(s)[0].id } });
  s = endDay(s);
  return { ...s, canPlan: true };
}

/** That morning with a full day's plan queued, its preview and the weather row's text. */
function planned(now: boolean, t = en, dev = false): { a: AppState; row: string; ends: string } {
  const a = (['wood', 'water', 'wood', 'water', 'wood'] as QueueItem[]).reduce(enqueue, { sim: morning(), queue: [], stage: 'reach' } as AppState);
  const p = previewQueue(a);
  const e = dayEnd(a, p, !dev, t);
  return { a, row: weatherRowText([], weatherRowTime(a, p, t, dev, now)), ends: e ? dayEndText(e, t) : '' };
}

describe('the weather row says the time now (#2000)', () => {
  it('in the morning with a day planned: the row says the morning, and the line under the queue where the day ends', () => {
    const { a, row, ends } = planned(true);
    expect(a.sim.hoursToday).toBe(0);
    expect(row).toBe(en('time.short.early').toLocaleLowerCase('en'));
    // The plan runs on into the day, so where it ends is a later part of it, said under the queue.
    const later = queueTimes(a, previewQueue(a), en, false).status;
    expect(later).not.toBe(en('time.short.early'));
    expect(ends).toMatch(/^Back at camp /);
  });

  it('in Swedish', () => {
    expect(planned(true, sv).row).toBe(sv('time.short.early').toLocaleLowerCase('sv'));
  });

  it('with the hours shown, the hours so far', () => {
    expect(planned(true, en, true).row).toBe('0/14h');
  });

  it('with `day-forecast` off, as before: the part of the day the plan ends in', () => {
    const { a, row } = planned(false);
    expect(row).toBe(queueTimes(a, previewQueue(a), en, false).status.toLocaleLowerCase('en'));
    expect(row).not.toBe(en('time.short.early').toLocaleLowerCase('en'));
  });
});
