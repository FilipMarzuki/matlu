/**
 * The encounter screen's controller (#1347): a new game meets encounters, a choice is made,
 * and carrying on runs the rest of the day's queue.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1 } from '../artificer/region1';
import { createExploration, scout } from '../artificer/exploration';
import { choose, carryOn, newGame, GAME_WORLD, type AppState } from './controller';

const paused = (): AppState => {
  const s = createRegion1({ world: GAME_WORLD }, undefined, { id: 'w-app' });
  const sim = { ...s, hoursToday: 6, explore: scout(createExploration(), 1), pending: { id: 'fox-at-the-treeline', day: 1, hour: 12, ring: 2 as const, action: 'wood' }, encounterDay: 1 };
  return { sim, queue: ['water', 'gather'], stage: 'reach' };
};

describe('Encounter screen controller (#1347)', () => {
  it('plays new games with encounters on', () => {
    expect(newGame().sim.config.world.encounters).toBe(true);
  });

  it('chooses, then carries on with the queued day', () => {
    const a = paused();
    // Nothing to carry on to while the choice waits.
    expect(carryOn(a)).toBe(a);
    const chosen = choose(a, 'watch');
    expect(chosen.sim.pending).toBeNull();
    expect(chosen.queue).toEqual(['water', 'gather']);
    const on = carryOn(chosen);
    expect(on.sim.day).toBe(2);
    expect(on.sim.log.some(l => /^Fetched/.test(l.text))).toBe(true);
  });

  it('keeps waiting when the choice is refused', () => {
    const a = paused();
    expect(choose(a, 'stalk').sim.pending).toEqual(a.sim.pending);
  });
});
