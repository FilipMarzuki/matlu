/**
 * The day on a timer (#1669). The screen is exempt (ui-hud); these pin the one rule that isn't a
 * look: the timer is presentation only. A day replayed step by step ends in exactly the state the
 * instant run gives, the same seed to the same state, so skipping, watching and the API agree.
 */

import { describe, it, expect } from 'vitest';
import { act, enqueue, makeWarden, runQueuedDay, runWholeQueue, type AppState } from './controller';
import { playAct, playDay, playWholeQueue, replayedEnd, momentAt, segmentsOf, lengthOf, parseSpeed, clockText, phasesOf, worthPlaying, NIGHT_BEAT, SKIP_BEAT } from './playback';
import { chooseSite, runAction, type QueueItem } from '../artificer/region1';

/** A Warden who has scouted and surveyed the near ring and camps in the cave, able to plan. */
function ready(id: string, features?: Record<string, boolean>): AppState {
  // Scouting and surveying straight away: a Warden from before actions were learned as you go (#1690).
  const a = makeWarden({ id }, undefined, { 'action-visibility': false, ...features });
  let s = runAction(a.sim, 'scout');
  s = runAction(s, 'survey');
  s = chooseSite(s, 'cave');
  return { ...a, sim: { ...s, canPlan: true } };
}
const queued = (a: AppState, items: QueueItem[]): AppState => items.reduce(enqueue, a);
const len = (q: string, opts: Record<string, string>): QueueItem => ({ q, opts } as QueueItem);

describe('Timed playback is presentation only (#1669)', () => {
  it('a replayed day ends in the instant run\'s state', () => {
    const a = queued(ready('w-timer'), ['wood', 'water', 'gather', 'wood', 'water']);
    const p = playDay(a);
    expect(p.after).toEqual(runQueuedDay(a));
    expect(p.steps.length).toBeGreaterThan(0);
    expect(p.night).toBe(true);
    expect(replayedEnd(p)).toEqual(p.after.sim);
    // Each step's lines are the instant run's lines, in order.
    const lines = p.steps.flatMap(st => st.sim.log.slice(st.logFrom).map(l => l.text));
    expect(p.after.sim.log.slice(a.sim.log.length, a.sim.log.length + lines.length).map(l => l.text)).toEqual(lines);
    // The clock moves forward through the day.
    p.steps.forEach((st, i) => { if (i) expect(st.start).toBeCloseTo(p.steps[i - 1].start + p.steps[i - 1].hours); });
  });

  it('the whole queue, day by day, ends where the instant run does, encounters and all', () => {
    // A seed whose far trips meet an encounter on the third day (the game world: weather, luck, encounters).
    const a = queued(ready('w-probe-3'), ['scout@2', 'wood@2', 'gather@2', 'wood@2', 'gather@2', 'wood@2', 'gather@2', 'wood@2', 'gather@2']);
    const days = playWholeQueue(a);
    const instant = runWholeQueue(a);
    expect(days.at(-1)!.after).toEqual(instant);
    for (const d of days) expect(replayedEnd(d)).toEqual(d.after.sim);
    days.slice(1).forEach((d, i) => expect(d.before).toBe(days[i].after));
    // Where the game asks the player, the timer stops there: the encounter waits, and no night comes.
    const last = days.at(-1)!;
    expect(last.after.sim.pending).toBeTruthy();
    expect(last.night).toBe(false);
    expect(last.steps.at(-1)!.sim.pending).toBeTruthy();
  });

  it('sessions of chosen length (#1668) replay as trips, to the same state', () => {
    const a = queued(ready('w-timer-len', { 'action-length': true }), [len('wood', { hours: '3' }), len('gather', { hours: 'day' })]);
    const p = playDay(a);
    expect(replayedEnd(p)).toEqual(runQueuedDay(a).sim);
    const st = p.steps[0];
    expect(st.phases).not.toBeNull();
    // The legs add up to the hours the session took.
    expect(st.phases!.reduce((h, ph) => h + ph.hours, 0)).toBeCloseTo(st.hours);
    expect(st.phases!.some(ph => ph.kind === 'work')).toBe(true);
    // A usual trip has no legs.
    expect(phasesOf(a.sim, 'wood', 3)).toBeNull();
  });

  it('far sessions walk out and back on every trip', () => {
    let a = ready('w-timer-far', { 'action-length': true });
    a = { ...a, sim: { ...runAction(runAction(a.sim, 'scout@2'), 'survey@2'), hoursToday: 0 } };
    const phases = phasesOf(a.sim, len('wood@2', { hours: 'day' }), 14);
    expect(phases?.[0].kind).toBe('out');
    expect(phases?.at(-1)!.kind).toBe('back');
  });

  it('one thing done by hand (#1350) replays as one step with no night', () => {
    const a = makeWarden({ id: 'w-timer-act' });
    expect(a.sim.canPlan).toBe(false);
    const p = playAct(a, 'scout');
    expect(p.after).toEqual(act(a, 'scout'));
    expect(p.steps).toHaveLength(1);
    expect(p.night).toBe(false);
    expect(replayedEnd(p)).toEqual(p.after.sim);
    // …and the day before planning, through the queue, runs only the first.
    const q = playDay({ ...a, queue: ['scout', 'water'] });
    expect(q.steps).toHaveLength(1);
    expect(replayedEnd(q)).toEqual(q.after.sim);
  });

  it('the same seed gives the same playback', () => {
    const a = queued(ready('w-timer'), ['wood', 'gather', 'water']);
    expect(JSON.stringify(playDay(a))).toBe(JSON.stringify(playDay(a)));
  });

  it('a finished run has nothing to play', () => {
    const a = ready('w-timer');
    const over = { ...a, sim: { ...a.sim, outcome: { kind: 'collapsed', choice: 'collapse', day: 3 } as unknown as AppState['sim']['outcome'] } };
    expect(worthPlaying([playDay(over)])).toBe(false);
  });
});

describe('The timeline (#1669)', () => {
  const a = queued(ready('w-timer'), ['wood', 'water']);
  const p = playDay(a);

  it('runs each step for its hours, then the night', () => {
    expect(segmentsOf(p)).toEqual([...p.steps.map(s => Math.max(s.hours, SKIP_BEAT)), NIGHT_BEAT]);
    expect(momentAt(p, 0)).toMatchObject({ index: 0, done: 0, over: false });
    expect(momentAt(p, 0).clock).toBeCloseTo(6 + a.sim.hoursToday);
    const mid = momentAt(p, p.steps[0].hours / 2);
    expect(mid.frac).toBeCloseTo(0.5);
    expect(mid.clock).toBeCloseTo(6 + p.steps[0].start + p.steps[0].hours / 2);
    expect(momentAt(p, p.steps[0].hours + 0.01)).toMatchObject({ index: 1, done: 1 });
    expect(momentAt(p, lengthOf(p) - 0.01)).toMatchObject({ index: p.steps.length, done: p.steps.length, over: false });
    expect(momentAt(p, lengthOf(p) + 1).over).toBe(true);
  });

  it('a refused action still gets a beat', () => {
    const s = playDay(queued(ready('w-timer'), ['quarry@3']));
    expect(s.steps[0].hours).toBe(0);
    expect(segmentsOf(s)[0]).toBe(SKIP_BEAT);
  });

  it('reads the speed setting, 1× for anything unknown', () => {
    expect(parseSpeed('2')).toBe(2);
    expect(parseSpeed('4')).toBe(4);
    expect(parseSpeed('3')).toBe(1);
    expect(parseSpeed(null)).toBe(1);
  });

  it('shows the clock', () => {
    expect(clockText(6)).toBe('06:00');
    expect(clockText(8.5)).toBe('08:30');
    expect(clockText(19.99)).toBe('19:59');
  });
});
