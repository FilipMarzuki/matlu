/**
 * Acceptance tests for #1496 (epic #1493, docs/focus-and-dialogue-design.md §3): noticing is
 * passive. In a village, a Warden focused on a topic may notice who's tied to it — the chance from
 * Clarity and INT, no hours spent. Knowing about a topic makes it possible even without the focus.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, ROUTE, type RoadState } from './road';
import { NOTICE_TRUST, SIGNS, noticeChance } from './notice';
import { answerFor } from './asks';
import type { Focus } from './focus';

const COMPACT: Focus = { kind: 'group', id: 'compact' };

/** A Warden on the caravan road, at Hollowford, focused on `focus`, with `clarity`. */
function atHollowford(focus: Focus | null, clarity = 80, over: Partial<RoadState> = {}): RoadState {
  const s = createRegion1({}, undefined, { id: 'w-notice', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const vitals = createVitals({ vigor: 80, clarity, condition: 90 });
  const from: Region1State = { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 30, water: 30, rations: 6 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
  const village = ROUTE.findIndex(l => l.kind === 'village');
  let r = createRoad(from);
  for (let i = 0; i < 10 && r.leg < village; i++) r = endRoadDay(r);
  return { ...r, focus, ...over };
}

/** Pass the days of the stay, resting; the clarity stays where the test put it. */
function stay(r: RoadState, days: number): RoadState {
  let s = r;
  for (let i = 0; i < days && ROUTE[s.leg].kind === 'village'; i++) s = endRoadDay({ ...s, vitals: { ...s.vitals, clarity: { ...r.vitals.clarity } } });
  return s;
}

describe('Passive noticing (#1496)', () => {
  // 1. Focused on the Compact, in Hollowford, Tobin's tie to it comes to light: a journal line and a mark on his card.
  it('lets a focused Warden notice who is tied to the topic', () => {
    expect(SIGNS['hf-tobin']?.['group:compact']).toBeDefined();
    const after = stay(atHollowford(COMPACT), 3);
    expect(after.noticed?.['hf-tobin']).toContain('group:compact');
    expect(after.log.some(l => l.text === SIGNS['hf-tobin']['group:compact'])).toBe(true);
    // A clear mind notices more than a foggy one, and INT helps.
    const clear = noticeChance({ focused: true, known: false, clarity: 80, unreliableBelow: 30, int: 10 });
    expect(noticeChance({ focused: true, known: false, clarity: 20, unreliableBelow: 30, int: 10 })).toBeLessThan(clear);
    expect(noticeChance({ focused: true, known: false, clarity: 80, unreliableBelow: 30, int: 14 })).toBeGreaterThan(clear);
  });

  // 2. Knowing about the Compact makes noticing possible without the focus — less likely than with it.
  it('lets knowledge notice too, at a lower chance than focus', () => {
    const focused = noticeChance({ focused: true, known: true, clarity: 80, unreliableBelow: 30, int: 10 });
    const known = noticeChance({ focused: false, known: true, clarity: 80, unreliableBelow: 30, int: 10 });
    const neither = noticeChance({ focused: false, known: false, clarity: 80, unreliableBelow: 30, int: 10 });
    expect(known).toBeGreaterThan(0);
    expect(known).toBeLessThan(focused);
    expect(neither).toBe(0);
    // Neither focused nor known: nothing comes to light, however long the stay.
    expect(stay(atHollowford(null), 3).noticed?.['hf-tobin'] ?? []).not.toContain('group:compact');
  });

  // 3. Seeded: the same Warden, day and village notice the same things — and nothing else in the run moves.
  it('notices the same things for the same seed and day', () => {
    const a = stay(atHollowford(COMPACT), 2);
    const b = stay(atHollowford(COMPACT), 2);
    expect(a.noticed).toEqual(b.noticed);
    // The day's encounter roll is its own stream: noticing doesn't change whether one comes.
    const plain = stay(atHollowford(null), 2);
    expect(plain.pending?.id).toEqual(a.pending?.id);
  });

  // Having noticed opens the ask one trust gate early: you've shown you know.
  it('opens an ask one gate early once you have noticed', () => {
    const at = answerFor('hf-tobin', 'group:compact')!;
    const trust = at.at - NOTICE_TRUST + 1;
    const unnoticed = runRoadAction(atHollowford(COMPACT, 80, { trust: { 'hf-tobin': trust } }), 'ask:hf-tobin');
    expect(unnoticed.log.at(-1)?.text).not.toContain(at.text);
    const noticed = runRoadAction(atHollowford(COMPACT, 80, { trust: { 'hf-tobin': trust }, noticed: { 'hf-tobin': ['group:compact'] } }), 'ask:hf-tobin');
    expect(noticed.log.at(-1)?.text).toContain(at.text);
  });
});
