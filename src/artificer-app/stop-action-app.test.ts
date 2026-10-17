/**
 * Stop on the timer (#1815): the button is a look (exempt), but what it does isn't. A stop played on
 * the timer is the instant stop's state (the timer stays presentation only), the Stop is only
 * offered with the switch on, the move it writes replays to the same game, and its journal line
 * reads in Swedish.
 */

import { describe, it, expect } from 'vitest';
import { enqueue, makeWarden, stopQueuedDay, type AppState } from './controller';
import { playDay, playStopped, replayedEnd, stopPoint, momentAt, timeAt } from './playback';
import { simLine } from './sim-words';
import { makeT } from '../artificer/i18n';
import { chooseSite, runAction, type QueueItem } from '../artificer/region1';
import { stepWeb } from '../artificer-play/web-run';

function ready(id: string, features: Record<string, boolean> = {}): AppState {
  const a = makeWarden({ id }, undefined, { 'action-visibility': false, ...features });
  let s = runAction(a.sim, 'scout');
  s = runAction(s, 'survey');
  s = chooseSite(s, 'cave');
  return { ...a, sim: { ...s, canPlan: true } };
}
const queued = (a: AppState, items: QueueItem[]): AppState => items.reduce(enqueue, a);

describe('Stop on the timer (#1815)', () => {
  it('a stopped day plays out to the instant stop\'s state, and pauses with the rest queued', () => {
    const a = queued(ready('w-stop-timer'), ['water', 'wood', 'gather']);
    const stop = { action: 1, hours: 2 };
    const p = playStopped(a, stop);
    expect(p.after).toEqual(stopQueuedDay(a, stop));
    expect(p.steps.length).toBe(2);
    expect(p.night).toBe(false);
    expect(replayedEnd(p)).toEqual(p.after.sim);
    expect(p.after.queue).toEqual(['gather']);
    // The timer picks up where it was stopped.
    expect(timeAt(p, 1, 2)).toBeCloseTo(p.steps[0].hours + 2);
  });

  it('offers Stop only with the switch on, and on a step that takes time', () => {
    const on = playDay(queued(ready('w-stop-offer'), ['water', 'wood']));
    const m = momentAt(on, on.steps[0].hours / 2);
    expect(stopPoint(on, m)).toEqual({ action: 0, hours: expect.closeTo(on.steps[0].hours / 2, 1) });
    // The night has nothing to stop.
    expect(stopPoint(on, momentAt(on, on.steps[0].hours + on.steps[1].hours + 0.1))).toBeNull();
    const off = playDay(queued(ready('w-stop-offer', { 'stop-action': false }), ['water', 'wood']));
    expect(stopPoint(off, momentAt(off, off.steps[0].hours / 2))).toBeNull();
  });

  it('the move the page writes replays to the game it kept', () => {
    const a = queued(ready('w-stop-log'), ['water', 'wood', 'gather']);
    const stop = { action: 1, hours: 1.5 };
    const kept = playStopped(a, stop).after;
    expect(stepWeb({ ...a, queue: [] }, { plan: a.queue, stop })).toEqual(kept);
  });

  it('says a stop in Swedish', () => {
    const sv = makeT('sv');
    const s = ready('w-stop-sv').sim;
    for (const [item, h] of [['water', 0.5], ['wood', 2], ['rest', 1]] as const) {
      const line = runAction({ ...s, stores: { ...s.stores, materials: 10, stone: 6 } }, item, h).log.slice(s.log.length).find(l => /stopped/.test(l.text))!.text;
      expect(simLine(line, sv)).not.toBe(line);
    }
  });
});
