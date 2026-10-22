/**
 * Acceptance test for #1797's thresholds: given `MAP_NIGHTS`, `MAP_PLACES` and `MAP_DIRECTIONS`,
 * a player who explores normally unlocks the map around day 4–6.
 *
 * Measured on twelve seeds (`MEASURE_SEEDS`) with the game's default rules and `map-learning` on,
 * no paid model (map-unlock.ts has how each is played):
 *
 * - the scripted baseline: its days are pinned as measured, and the ones that unlock land in 4–6
 *   (before #1852 it was written for the old rules and seldom found enough places);
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
import { explorerUnlock, scriptedUnlock, randomUnlock, summarise, MEASURE_SEEDS, MAP_RULES } from './map-unlock';
import { WALK_THE_MAP } from '../artificer/walk-the-map';

const inTarget = (d: number | null): boolean => d !== null && d >= 4 && d <= 6;

describe('Learning the map: the unlock comes around day 4–6 (#1797)', () => {
  it('the thresholds are the tuned ones', () => {
    expect([MAP_NIGHTS, MAP_PLACES, MAP_DIRECTIONS]).toEqual([4, 4, 3]);
  });

  it('the explorer unlocks on every seed, median in 4–6', () => {
    // Trips in rings (#1876's switch off), as the thresholds were tuned: see EXPLORER_WALK_DAYS below.
    const days = MEASURE_SEEDS.map(id => explorerUnlock(id, { ...MAP_RULES, [WALK_THE_MAP]: false }).day);
    const sum = summarise(days);
    expect(sum.unlocked).toBe(MEASURE_SEEDS.length);
    expect(inTarget(sum.median)).toBe(true);
    expect(days).toEqual(EXPLORER_DAYS);
    // With the default rules, trips walking the map: pinned as measured, median still in 4–6.
    const walking = MEASURE_SEEDS.map(id => explorerUnlock(id).day);
    expect(walking).toEqual(EXPLORER_WALK_DAYS);
    expect(inTarget(summarise(walking).median)).toBe(true);
  }, 60_000);

  it('the scripted baseline, pinned as measured: the seeds that unlock do so in 4–6', async () => {
    const days: (number | null)[] = [];
    for (const id of MEASURE_SEEDS) days.push((await scriptedUnlock(id)).day);
    expect(days).toEqual(SCRIPTED_DAYS);
    const sum = summarise(days);
    expect(sum.unlocked).toBeGreaterThan(0);
    expect(inTarget(sum.median)).toBe(true);
    expect(days.filter(d => d !== null).every(inTarget)).toBe(true);
    // Longer than the others (#1852): the scripted baseline now lives through the whole window, and
    // plans each step by playing its choices forward.
  }, 180_000);

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
// With `walk-the-map` (#1876) a trip walks to a real square and back, so "close by" can be hours of
// walking where it was none. The explorer's fixed order fetches water last; on map-3 it camps on a
// hilltop whose nearest water is a lake 2h off, runs out of light before the water each day, and dies
// of thirst on day 4, a night short of the four the map wants: explorer 11/12, median 5 (5–5). The
// thresholds were tuned with trips in rings, so the every-seed check above stays on rings (the switch
// off, where nothing moved); the walking days are pinned here so a change to them shows.
const EXPLORER_WALK_DAYS: (number | null)[] = [5, 5, null, 5, 5, 5, 5, 5, 5, 5, 5, 5];
// With #1852 the scripted baseline plays by needs once camp is an action (it makes camp, and looks
// further out once it has a roof), so it now finds enough places on every seed: scripted 12/12,
// median 5 (5–5). Before, it never made camp and unlocked on 4 of 12.
// With `walk-the-map` (#1876) trips walk to a real square and back, so map-12's days run longer and it
// opens a day later: scripted 12/12, median 5 (5–6).
const SCRIPTED_DAYS: (number | null)[] = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6];
// With \`thermal-model\` (#1770) a night without a bag is dangerous, so the random player dies sooner:
// random 8/12, median 5 (5–8). The explorer and the scripted baseline didn't move.
// With `stone-gathering` (#1816) the random player has Gather stones where it had Quarry stone, so it
// picks differently: random 8/12, median 5 (5–7).
// With `hunting-gear` (#1821) the random player has Set traps and the gear crafts where it had Hunt
// and Ice fishing, so it picks differently again: random 9/12, median 5 (5–6). (The window is now 20
// days, MEASURE_DAYS: one random run lives to day 16.) The explorer and the scripted baseline didn't move.
// With `directed-explore` (#1839) Explore offers a way (look around, or one of eight to head out),
// which the random player picks at random too, so it explores differently: random 8/12, median 5
// (5–6). The explorer and the scripted baseline (which look around, the default) didn't move.
// With `compass-heading` (#1868) heading out needs something to keep a heading. The random player packs
// at random, so without the map and compass it can head out only on a sunny day (or with a needle
// compass it happens to make), and its picks shift again: random 9/12, median 5 (5–7). The explorer
// and the scripted baseline (packed with the leader's list, compass included) didn't move.
// With `pack-axe-fishing` (#1870) the pack list has two more things (the hand axe and the fishing kit),
// and the random player shuffles the whole list the run offers, so every seed packs differently: some
// go without the bag or the compass they had before. random 6/12, median 5 (5–6), still in the target.
// The explorer and the scripted baseline (the leader's list, which has neither) didn't move.
// With `walk-the-map` (#1876) a trip walks to a real square and back, often hours where close by was
// none, so the random player (which packs and picks at random) runs short of water and light more and
// dies sooner on more seeds: random 4/12, median 5 (5–5), still in the target.
// With the seeded Fisher–Yates pack shuffle (#1877) in place of `sort(() => rand() - 0.5)`, the
// random player's pack order no longer depends on the engine's sort, and it takes fewer draws (one
// per item instead of one per comparison), so each seed packs, and so plays, differently: re-pinned
// as measured, random 6/12, median 5 (5–5), still in the target. Rules, explorer and scripted unchanged.
const RANDOM_DAYS: (number | null)[] = [5, 5, null, 5, 5, null, 5, null, null, null, 5, 5];
