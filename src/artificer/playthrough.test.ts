/**
 * Acceptance tests for #1208 — the headless Region 1 end-to-end playthrough.
 *
 * Whole runs scripted through the real sim (no browser, no Phaser): a careful
 * player who prepares for winter and lives through it (#1302), and a
 * neglectful one who doesn't. The short year (snow on day 13) keeps them quick. One test
 * per Given/When/Then criterion (1–5) in the issue.
 *
 * The "good" plan below was found by playing the sim and is a useful balance
 * canary: if tuning changes break it, this file is where you'll find out.
 */

import { describe, it, expect } from 'vitest';
// These check exact numbers and long plans written for an evenly lit day, so they play the flat world (#1281).
import { FLAT_WORLD } from './world';
import { fastForward, SHORT_YEAR } from './test-helpers';
import { createRegion1, runAction, chooseSite, runDay, winterReady, REGION1_MILESTONES, type QueueId, type Region1State } from './region1';
import { BASELINE } from './vitality';

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

/** Play the careful run through its nine-day plan, to day 10. */
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

/** Through the winter: hunt and fetch, smoke what's spare, keep the woodpile up — until the thaw. */
const WINTER_ROUTINE: QueueId[][] = [
  ['hunt', 'water', 'preserve'],
  ['wood', 'hunt', 'water'],
  ['gather', 'water', 'rest'],
];

function playWinter(from: Region1State): Region1State {
  let s = from;
  while (!s.outcome) s = runDay(s, WINTER_ROUTINE[s.day % WINTER_ROUTINE.length]).state;
  return s;
}

/** A neglectful player: looks around once, then mostly sits about. */
function playNeglect(): Region1State {
  let s = runAction(createRegion1({ world: FLAT_WORLD, calendar: SHORT_YEAR }), 'scout');
  s = fastForward(s, 10, ['rest', 'rest']);
  return s;
}

describe('Region 1 playthrough (headless e2e)', () => {
  // 1. A good run is winter-ready well before the snow and climbs the whole ladder.
  it('gets a careful player winter-ready before the snow, with every milestone', () => {
    const s = playGood();
    expect(s.day).toBe(10);
    expect(winterReady(s)).toBe(true);
    expect(s.milestones).toEqual(REGION1_MILESTONES.map(m => m.id));
    // They also came out stronger than they arrived, and never went hungry.
    expect(s.vitals.vigor.cap).toBeGreaterThan(BASELINE);
    expect(s.vitals.clarity.cap).toBeGreaterThanOrEqual(BASELINE);
    expect(s.log.some(l => /Hungry|Thirsty/.test(l.text))).toBe(false);
  });

  // 2. The careful player keeps it up through the winter (#1302) and comes out hale at the thaw.
  it('carries the careful player through the winter to the thaw', () => {
    const s = playWinter(playGood());
    expect(s.outcome).toMatchObject({ choice: 'thaw', kind: 'survived', grade: 'hale' });
    expect(s.day).toBe(SHORT_YEAR.thawDay);
  });

  // 3. A neglectful run arrives unready, and sitting about through the winter kills them.
  it('leaves a neglectful player unready, and the winter ends them', () => {
    let s = playNeglect();
    expect(winterReady(s)).toBe(false);
    while (!s.outcome) s = runDay(s, ['rest', 'rest']).state;
    expect(['died', 'collapsed']).toContain(s.outcome.kind);
    expect(s.day).toBeLessThan(SHORT_YEAR.thawDay);
  });

  // 5. Deterministic: same script, same result.
  it('is deterministic — the same script yields an identical state', () => {
    expect(playGood()).toEqual(playGood());
    expect(playWinter(playGood())).toEqual(playWinter(playGood()));
  });
});
