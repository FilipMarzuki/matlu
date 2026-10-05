/**
 * Acceptance tests for #1208 — the headless Region 1 end-to-end playthrough.
 *
 * Whole runs scripted through the real sim (no browser, no Phaser): a careful
 * player who prepares for winter, and a neglectful one who doesn't. One test
 * per Given/When/Then criterion (1–5) in the issue.
 *
 * The "good" plan below was found by playing the sim and is a useful balance
 * canary: if tuning changes break it, this file is where you'll find out.
 */

import { describe, it, expect } from 'vitest';
// These check exact numbers and long plans written for an evenly lit day, so they play the flat world (#1281).
import { FLAT_WORLD } from './world';
import { fastForward, SHORT_YEAR } from './test-helpers';
import { createRegion1, runAction, chooseSite, runDay, choose, winterReady, REGION1_MILESTONES, type QueueId, type Region1State } from './region1';
import { BASELINE } from './vitality';
import { PENALTY } from './winter';

/**
 * A careful player: cave on day 1, a roof the first night, then stock up —
 * and once the near ring runs thin, push out (day 8) and find the pass (day 9).
 */
const GOOD_PLAN: QueueId[][] = [
  ['wood', 'build'],                 // day 1 (after scouting + claiming the cave)
  ['survey', 'track', 'water'],      // day 2 — richer yields, find the game
  ['hunt', 'hunt', 'water'],         // day 3
  ['wood', 'wood', 'preserve'],      // day 4 — materials + fuel, the larder begins
  ['build', 'hunt'],                 // day 5 — winterize the shelter
  ['hunt', 'preserve', 'preserve'],  // day 6
  ['wood', 'coldGear', 'hunt'],      // day 7 — gear for the road, just in case
  ['scout@2', 'hunt', 'preserve'],   // day 8 — push out to the far ring
  ['scout@3', 'water', 'rest'],      // day 9 — the distant hills: glimpse the pass out
];

/** Play the careful run up to the caravan's arrival (day 10). */
function playGood(): Region1State {
  let s = createRegion1({ world: FLAT_WORLD, calendar: SHORT_YEAR });
  s = runAction(s, 'scout');
  s = chooseSite(s, 'cave');
  for (const day of GOOD_PLAN) {
    const r = runDay(s, day);
    expect(r.remaining).toEqual([]); // the plan fits each day
    s = r.state;
  }
  return s;
}

/** A neglectful player: looks around once, then mostly sits about. */
function playNeglect(): Region1State {
  let s = runAction(createRegion1({ world: FLAT_WORLD, calendar: SHORT_YEAR }), 'scout');
  s = fastForward(s, SHORT_YEAR.caravanOpen, ['rest', 'rest']);
  return s;
}

describe('Region 1 playthrough (headless e2e)', () => {
  // 1. A good run is winter-ready before the caravan and climbs the whole ladder.
  it('gets a careful player winter-ready before the caravan, with every milestone', () => {
    const s = playGood();
    expect(s.day).toBe(SHORT_YEAR.caravanOpen);
    expect(winterReady(s)).toBe(true);
    expect(s.milestones).toEqual(REGION1_MILESTONES.map(m => m.id));
    // They also came out stronger than they arrived, and never went hungry.
    expect(s.vitals.vigor.cap).toBeGreaterThan(BASELINE);
    expect(s.vitals.clarity.cap).toBeGreaterThanOrEqual(BASELINE);
    expect(s.log.some(l => /Hungry|Thirsty/.test(l.text))).toBe(false);
  });

  // 2. From that run, each exit resolves as designed.
  it('resolves each exit for the careful player', () => {
    const s = playGood();
    expect(choose(s, 'caravan').outcome?.kind).toBe('thrive');
    expect(choose(s, 'solo').outcome?.kind).toBe('crossed');
    expect(choose(s, 'winter').outcome?.kind).toBe('wintered');
    expect(choose(s, 'solo').outcome?.injury).toBeUndefined();
  });

  // 3. A neglectful run arrives unready; wintering is grim, the road turns them back.
  it('leaves a neglectful player unready, with grim and frostbitten exits', () => {
    const s = playNeglect();
    expect(winterReady(s)).toBe(false);

    const wintered = choose(s, 'winter');
    expect(wintered.outcome?.kind).toBe('grim');
    expect(wintered.vitals.vigor.cap).toBeLessThan(s.vitals.vigor.cap);

    const road = choose(s, 'solo');
    expect(road.outcome?.kind).toBe('turnedBack');
    expect(road.outcome?.injury).toBe('frostbite');
    expect(road.vitals.vigor.cap).toBe(Math.max(50, s.vitals.vigor.cap - PENALTY.frostbite.vigorCap));

    expect(choose(s, 'caravan').outcome?.kind).toBe('ragged');
  });

  // 4. The caravan can't be boarded once its window has closed.
  it('refuses the caravan after its window closes, leaving solo and winter', () => {
    let s = playGood();
    s = fastForward(s, SHORT_YEAR.caravanClose + 1);
    expect(() => choose(s, 'caravan')).toThrow(/not available/);
    expect(choose(s, 'winter').outcome?.kind).toBeDefined();
    expect(choose(s, 'solo').outcome?.kind).toBeDefined();
  });

  // 5. Deterministic: same script, same result.
  it('is deterministic — the same script yields an identical state', () => {
    expect(playGood()).toEqual(playGood());
    expect(choose(playGood(), 'caravan')).toEqual(choose(playGood(), 'caravan'));
  });
});
