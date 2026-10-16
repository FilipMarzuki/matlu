/**
 * Acceptance test for #1797's thresholds: given `MAP_NIGHTS`, `MAP_PLACES` and `MAP_DIRECTIONS`,
 * a player who explores normally unlocks the map around day 4–6.
 *
 * Measured on twelve seeds (`MEASURE_SEEDS`) with the game's default rules and `map-learning` on,
 * no paid model (map-unlock.ts has how each is played):
 *
 * - the scripted baseline, which was written before the land had to be explored and seldom finds
 *   enough places: its days are pinned as measured, and the ones that unlock land in 4–6;
 * - the random baseline (`legal`, seeds 1–12): median in 4–6;
 * - the explorer ("explore each day, make camp, explore again"), standing in for a player who
 *   explores normally, since the scripted baseline doesn't: median in 4–6, and every seed unlocks.
 *
 * Before #1797 (3 nights, 5 places, 3 directions) the same seeds measured: explorer all 12 on day 4;
 * scripted 1 of 12 (day 4); random 10 of 12, median 4 (4–6). The issue's starting guess, 3 nights
 * and 4 places, measured the same median 4 (explorer all day 4). The explorer was held back only by
 * the nights, so every map opened on the first morning allowed; four nights and four places put it
 * at day 5, the middle of the target, and let the scripted baseline's thinner exploring unlock too.
 *
 * The numbers are pinned, so a change to the rules that moves them shows here: re-measure with
 * this file, and retune the thresholds if the median leaves 4–6.
 */

import { describe, it, expect } from 'vitest';
import { MAP_NIGHTS, MAP_PLACES, MAP_DIRECTIONS } from '../artificer/map-learning';
import { explorerUnlock, scriptedUnlock, randomUnlock, summarise, MEASURE_SEEDS } from './map-unlock';

const inTarget = (d: number | null): boolean => d !== null && d >= 4 && d <= 6;

describe('Learning the map: the unlock comes around day 4–6 (#1797)', () => {
  it('the thresholds are the tuned ones', () => {
    expect([MAP_NIGHTS, MAP_PLACES, MAP_DIRECTIONS]).toEqual([4, 4, 3]);
  });

  it('the explorer unlocks on every seed, median in 4–6', () => {
    const days = MEASURE_SEEDS.map(id => explorerUnlock(id).day);
    const sum = summarise(days);
    expect(sum.unlocked).toBe(MEASURE_SEEDS.length);
    expect(inTarget(sum.median)).toBe(true);
    expect(days).toEqual(EXPLORER_DAYS);
  }, 60_000);

  it('the scripted baseline, pinned as measured: the seeds that unlock do so in 4–6', async () => {
    const days: (number | null)[] = [];
    for (const id of MEASURE_SEEDS) days.push((await scriptedUnlock(id)).day);
    expect(days).toEqual(SCRIPTED_DAYS);
    const sum = summarise(days);
    expect(sum.unlocked).toBeGreaterThan(0);
    expect(inTarget(sum.median)).toBe(true);
    expect(days.filter(d => d !== null).every(inTarget)).toBe(true);
  }, 60_000);

  it('the random baseline: median in 4–6', async () => {
    const days: (number | null)[] = [];
    for (const [i, id] of MEASURE_SEEDS.entries()) days.push((await randomUnlock(id, i + 1)).day);
    expect(days).toEqual(RANDOM_DAYS);
    expect(inTarget(summarise(days).median)).toBe(true);
  }, 60_000);
});

// Measured with MAP_NIGHTS 4, MAP_PLACES 4, MAP_DIRECTIONS 3 (index i is seed `map-${i + 1}`):
// explorer 12/12, median 5 (5–5); scripted 4/12, median 5 (5–5); random 11/12, median 5 (5–6).
const EXPLORER_DAYS: (number | null)[] = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
const SCRIPTED_DAYS: (number | null)[] = [null, null, null, null, 5, 5, null, 5, 5, null, null, null];
// With \`thermal-model\` (#1770) a night without a bag is dangerous, so the random player dies sooner:
// random 8/12, median 5 (5–8). The explorer and the scripted baseline didn't move.
const RANDOM_DAYS: (number | null)[] = [5, 5, 6, null, 5, null, null, 5, 6, 5, 8, 5];
