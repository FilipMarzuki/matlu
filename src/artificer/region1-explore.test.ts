/**
 * Acceptance tests for #1217 — exploration rings in Region 1 (criteria 4–5).
 * The module itself (1–3) is in exploration.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, routeKnown, queueHours, parseQueueId, type Region1State } from './region1';
import { level, scouted, survey, track, scout, createExploration } from './exploration';

const scoutedNear = (): Region1State => runAction(createRegion1(), 'scout');

describe('Region 1 exploration rings', () => {
  // 4a. Rings are reached in order; outer trips cost travel and pay more.
  it('opens rings outward, charging travel and paying richer yields', () => {
    const fresh = createRegion1();
    const tooFar = runAction(fresh, 'scout@2');
    expect(tooFar.log.at(-1)?.text).toMatch(/near ring isn't known yet/);
    expect(tooFar.hoursToday).toBe(0);

    const near = scoutedNear();
    expect(runAction(near, 'scout@3').log.at(-1)?.kind).toBe('skip'); // far ring not known yet
    const far = runAction(near, 'scout@2');
    expect(scouted(far.explore, 2)).toBe(true);
    expect(far.hoursToday).toBe(near.hoursToday + 4 + 3); // scout + the walk
    expect(queueHours('wood@3')).toBe(4 + 6);
    expect(parseQueueId('hunt@2')).toEqual({ id: 'hunt', ring: 2 });

    // Same knowledge (observed), fresh ground: the far ring yields 1.5×.
    const both = { ...near, explore: survey(survey(near.explore, 1), 2) };
    const woodNear = runAction(both, 'wood').stores.firewood - both.stores.firewood;
    const woodFar = runAction(both, 'wood@2').stores.firewood - both.stores.firewood;
    expect(woodFar).toBeGreaterThan(woodNear);
  });

  // 4b. Hunting needs game tracked in that ring; working teaches detail and finds are journalled.
  it('needs tracking per ring and rewards working the land with finds', () => {
    const s = { ...scoutedNear(), explore: track(scout(scout(createExploration(), 1), 2), 1) };
    expect(runAction(s, 'hunt').stores.rawFood).toBeGreaterThan(s.stores.rawFood);
    expect(runAction(s, 'hunt@2').log.at(-1)?.text).toMatch(/no game tracked in the far ring/);

    let q = { ...scoutedNear(), explore: survey(scout(createExploration(), 1), 1) };
    for (let i = 0; i < 3; i++) q = runAction({ ...q, hoursToday: 0 }, 'quarry');
    expect(level(q.explore, 1, 'stone')).toBe(3);
    expect(q.log.some(l => /found a flint seam/.test(l.text))).toBe(true);
    expect(q.stores.stone).toBeGreaterThan(6); // quarrying fills the stone store
  });

  // 4c. The near ring runs thin as you work it.
  it('depletes the near ring with repeated trips', () => {
    let s = { ...scoutedNear(), explore: track(scout(createExploration(), 1), 1) };
    const first = runAction(s, 'hunt').stores.rawFood - s.stores.rawFood;
    for (let i = 0; i < 6; i++) s = runAction({ ...s, hoursToday: 0 }, 'hunt');
    const later = runAction(s, 'hunt').stores.rawFood - s.stores.rawFood;
    expect(later).toBeLessThan(first + 2); // even with the game-trail find (+2), the take shrinks
    expect(s.explore.worked[1].game).toBe(6);
  });

  // 5. The pass out shows only from the distant hills.
  it('reveals the pass only once the distant ring is scouted', () => {
    const s = chooseSite(runAction(createRegion1(), 'scout'), 'cave');
    expect(routeKnown(s)).toBe(false);
    expect(routeKnown({ ...s, explore: scout(scout(s.explore, 2), 3) })).toBe(true);
  });
});
