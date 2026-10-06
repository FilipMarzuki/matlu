/**
 * Acceptance tests for #1306 — balancing a 30-day autumn and a 30-day winter.
 * A careful autumn comes out hale at the thaw, a careless one dies before it,
 * and the shelter in between decides how hard the winter is. These are the
 * balance canaries: if tuning breaks them, this file says so.
 *
 * They play the full world on fixed seeds (luck, weather and the cold are the
 * point here), plus the flat world for an exact baseline.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, chooseSite, winterReady, type QueueItem, type Region1State, type SiteId } from './region1';
import { FLAT_WORLD } from './world';
import { DEFAULT_CALENDAR } from './winter';
import { isBlizzard } from './weather';
import { playRun } from '../artificer-ai/runner';
import { scriptedPlayer } from '../artificer-ai/players/scripted';

const { thawDay } = DEFAULT_CALENDAR;

/** The careful autumn: settle the cave, wall it in, track and hunt, smoke what's spare, keep the woodpile up. */
const CAREFUL_START: QueueItem[][] = [
  ['wood', 'build'],
  ['survey', 'track', 'water'],
  ['hunt', 'hunt', 'water'],
  ['wood', 'wood', 'preserve'],
  ['build', 'hunt'],
];
const ROUTINE: QueueItem[][] = [['hunt', 'preserve', 'water'], ['wood', 'hunt', 'preserve'], ['water', 'wood', 'rest']];

/**
 * Play `start` days, then the routine to the end — recovering as a person would when bad luck costs a build
 * (no roof: put one up, fetching water too; walls wanted but not up yet: try again), and staying in through blizzards.
 */
function play(s: Region1State, start: QueueItem[][], site: SiteId, walls = true): Region1State {
  for (const d of start) s = runDay(s, d).state;
  while (!s.outcome) {
    // A careful player stays in through a blizzard (#1315): going out in one can kill.
    const day: QueueItem[] = isBlizzard(s.weatherToday, s.day) ? ['rest', 'rest']
      : s.tier === 0 ? ['water', 'wood', { q: 'build', opts: { site } }]
      : walls && s.tier === 1 ? ['water', 'wood', 'build']
      : ROUTINE[s.day % 3];
    s = runDay(s, day).state;
  }
  return s;
}

/** The careless autumn: a lean-to, one load of wood, then forage and fetch — never smoking anything, never more wood. */
function careless(id: string): Region1State {
  let s = runDay(createRegion1({}, undefined, { id }), ['scout', 'wood', { q: 'build', opts: { site: 'cave' } }]).state;
  while (!s.outcome) s = runDay(s, ['gather', 'water', 'rest']).state;
  return s;
}

describe('Balance: a 30-day autumn and a 30-day winter (#1306)', () => {
  // 1. The careful plan on the flat world comes out hale at the thaw.
  it('brings the careful plan through hale on the flat world', () => {
    const s = play(chooseSite(runAction(createRegion1({ world: FLAT_WORLD }), 'scout'), 'cave'), CAREFUL_START, 'cave');
    expect(s.outcome).toMatchObject({ choice: 'thaw', kind: 'survived', grade: 'hale' });
    expect(s.day).toBe(thawDay);
  });

  // 2. A plan that never preserves and cuts no more than one load of firewood dies before the thaw.
  it('kills the careless plan before the thaw', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const s = careless(`careless-${seed}`);
      expect(['died', 'collapsed']).toContain(s.outcome?.kind);
      expect(s.day).toBeLessThan(thawDay);
    }
  });

  // 3. The careful plan (the scripted baseline) survives at least 8 of 10 seeds of the full world.
  it('lets the careful plan survive most seeds of the full world', async () => {
    let survived = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const r = await playRun(scriptedPlayer(), { characterId: `ai-scripted-s${seed}-r1` });
      if (r.record.kind === 'survived') survived++;
    }
    expect(survived).toBeGreaterThanOrEqual(8);
  }, 60_000);

  // 4. The pacing stretches over the long autumn: winter-ready comes in the second or third week, not the first.
  it('stretches the climb to winter-ready across the autumn', async () => {
    for (let seed = 1; seed <= 3; seed++) {
      const r = await playRun(scriptedPlayer(), { characterId: `ai-scripted-s${seed}-r1` });
      expect(r.record.readyDay).not.toBeNull();
      expect(r.record.readyDay!).toBeGreaterThanOrEqual(10);
      expect(r.record.readyDay!).toBeLessThan(DEFAULT_CALENDAR.winterDay);
    }
    // Nine careful days are no longer enough to be winter-ready (it used to take eight).
    let s = chooseSite(runAction(createRegion1({ world: FLAT_WORLD }), 'scout'), 'cave');
    for (const d of CAREFUL_START) s = runDay(s, d).state;
    for (let i = 0; i < 4; i++) s = runDay(s, ROUTINE[s.day % 3]).state;
    expect(winterReady(s)).toBe(false);
  }, 60_000);

  // The shelter decides how hard the winter is: walls in the cave come out hale, a lean-to worn, an exposed lean-to not at all.
  it('makes the shelter decide the winter', () => {
    const run = (site: SiteId, walls: boolean, seed: number) => {
      const start: QueueItem[][] = [['scout', 'wood', { q: 'build', opts: { site } }], ['survey', 'track', 'water'], ['wood', 'wood', 'hunt'], ['wood', 'wood', 'preserve'], walls ? ['build', 'hunt'] : ['hunt', 'water']];
      return play(createRegion1({}, undefined, { id: `shelter-${seed}` }), start, site, walls);
    };
    const walled = [1, 2, 3, 4, 5, 6].map(seed => run('cave', true, seed));
    expect(walled.filter(s => s.outcome?.grade === 'hale').length).toBeGreaterThanOrEqual(5);
    // A lean-to in the cave — the best site, the least shelter — mostly leaves you worn.
    const leanTo = [1, 2, 3, 4, 5, 6].map(seed => run('cave', false, seed));
    expect(leanTo.filter(s => s.outcome?.grade === 'hale').length).toBeLessThanOrEqual(2);
    expect(leanTo.filter(s => s.outcome?.kind === 'survived').length).toBeGreaterThanOrEqual(4);
    // In a treeline lean-to the winter wins.
    const exposed = [1, 2, 3].map(seed => run('tree', false, seed));
    expect(exposed.every(s => s.outcome?.kind !== 'survived' && s.day > DEFAULT_CALENDAR.winterDay)).toBe(true);
  });
});
