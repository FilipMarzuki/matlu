/**
 * Acceptance tests for #2029 — looking around sees by sightlines and terrain, at camp too (switch
 * `look-around-sightlines`). One test per Given/When/Then of the issue, in order:
 *
 *   1. At camp, open land — looking around close by marks the squares within 2 it can see; with the
 *                           switch off, none, as before.
 *   2. A hill             — a square behind higher land isn't seen.
 *   3. A wood             — the square past a wood isn't seen, but the wood's edge is.
 *   4. In a wood          — only the squares next to you are seen.
 *   5. High ground        — you see a square further.
 *   6. A lake             — doesn't block.
 *   7. Same game          — the same run and moves see the same squares (no randomness).
 *
 * Scenarios 2–6 are on small lands drawn for them (only the squares' kinds and heights matter to a
 * sightline); 1 and 7 are a new Warden's own land, played through the rules.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, type Region1State } from './region1';
import { FULL_WORLD, type WorldConfig } from './world';
import { ruleFeatures } from './features';
import { landOfRun } from './world/hex-window';
import type { Biome, Reach } from './world/reach';
import { LOOK_SQUARES, SIGHTLINES, inSight, sightRadius, sightlinePlan, standingAt } from './directed-explore';
import { observe } from '../artificer-ai/observe';

/** A land drawn for a test: rows of [kind, height] for each square. */
function land(rows: [Biome, number][][]): Reach {
  const cells = rows.flat().map(([biome, height]) => ({ biome, height }));
  return { seed: 1, w: rows[0].length, h: rows.length, cells, camp: { x: 0, y: 0 }, hours: cells.map(() => 0) };
}
/** A strip of open land, 9 squares long and 1 high, flat at `h`, with some squares changed. */
const strip = (changes: Record<number, [Biome, number]> = {}, h = 0.4): Reach =>
  land([Array.from({ length: 9 }, (_, x): [Biome, number] => changes[x] ?? ['meadow', h])]);
/** The x of each square seen, looking along the strip from x = 0. */
const seenXs = (r: Reach, ring: 1 | 2 | 3 = 3): number[] => sightlinePlan(r, { x: 0, y: 0 }, ring).map(i => i % r.w);

/** Daylight, clear weather, no luck: what happens is the rules'. */
const world = (on: boolean | 'absent'): WorldConfig => {
  const features: Record<string, boolean> = { ...ruleFeatures() };
  if (on === 'absent') delete features[SIGHTLINES];
  else features[SIGHTLINES] = on;
  return { ...FULL_WORLD, luck: false, accidents: false, darkness: false, weather: 'clear', encounters: false, features };
};
const warden = (on: boolean | 'absent' = true, id = 'w-sight'): Region1State => createRegion1({ world: world(on) }, undefined, { id });

describe('#2029 — look around by sightlines (switch on)', () => {
  it('1. Given a Warden at camp in open land, When they look around close by, Then the squares in sight within 2 are marked seen; off, none', () => {
    const s = warden();
    expect(s.seenOut ?? []).toEqual([]);
    const after = runAction(s, 'explore');
    const r = landOfRun(s);
    const from = standingAt(s);
    const seen = after.seenOut ?? [];
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).toEqual(sightlinePlan(r, from, 1));
    // Within the radius where they stand (2 in the open, 1 in a wood, 3 on high ground), and each in sight.
    for (const i of seen) {
      const at = { x: i % r.w, y: Math.floor(i / r.w) };
      expect(Math.hypot(at.x - from.x, at.y - from.y)).toBeLessThanOrEqual(sightRadius(r, from, 1) + 0.5);
      expect(inSight(r, from, at)).toBe(true);
    }
    // With the switch off, or a run from before it, looking around at camp marks nothing, as before.
    expect(runAction(warden(false), 'explore').seenOut ?? []).toEqual([]);
    expect(runAction(warden('absent'), 'explore').seenOut ?? []).toEqual([]);
  });

  it('2. Given a hill between the Warden and a square, When they look around, Then that square isn\'t seen', () => {
    // A ridge at x = 2, well above the line from eyes at 0.4 to the ground at 0.4 behind it.
    const r = strip({ 2: ['heath', 0.48] });
    expect(seenXs(r)).toContain(1);
    expect(seenXs(r)).toContain(2); // the near side of the hill
    expect(seenXs(r)).not.toContain(3);
    expect(seenXs(r)).not.toContain(4);
    // The same land with no ridge: all of it out to the radius.
    expect(seenXs(strip())).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('3. Given a wood between the Warden and a square, When they look around, Then the square past the wood isn\'t seen, but the wood\'s edge is', () => {
    // A birch wood at x = 2, its ground as low as the rest: its crowns block.
    const r = strip({ 2: ['birch', 0.4] });
    expect(seenXs(r)).toEqual([1, 2]);
    // A meadow at the same height doesn't.
    expect(seenXs(strip({ 2: ['meadow', 0.4] }))).toContain(4);
  });

  it('4. Given the Warden standing in a wood, When they look around, Then only the squares next to them are seen', () => {
    const r = land([
      [['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4]],
      [['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4]],
      [['meadow', 0.4], ['meadow', 0.4], ['pine', 0.4], ['meadow', 0.4], ['meadow', 0.4]],
      [['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4]],
      [['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4], ['meadow', 0.4]],
    ]);
    const from = { x: 2, y: 2 };
    expect(sightRadius(r, from, 1)).toBe(1);
    const seen = sightlinePlan(r, from, 3).map(i => ({ x: i % r.w, y: Math.floor(i / r.w) }));
    expect(seen).toHaveLength(8);
    for (const at of seen) expect(Math.max(Math.abs(at.x - 2), Math.abs(at.y - 2))).toBe(1);
  });

  it('5. Given the Warden on high ground, When they look around, Then they see a square further', () => {
    // On a fell, and on a knoll higher than every square round it: 3 close by instead of 2.
    expect(sightRadius(strip({ 0: ['fell', 0.8] }), { x: 0, y: 0 }, 1)).toBe(LOOK_SQUARES[1] + 1);
    expect(sightRadius(strip({ 0: ['heath', 0.5] }), { x: 0, y: 0 }, 1)).toBe(LOOK_SQUARES[1] + 1);
    expect(seenXs(strip({ 0: ['heath', 0.5] }), 1)).toEqual([1, 2, 3]);
    // On flat open land: 2.
    expect(sightRadius(strip(), { x: 0, y: 0 }, 1)).toBe(LOOK_SQUARES[1]);
    expect(seenXs(strip(), 1)).toEqual([1, 2]);
  });

  it('6. Given a lake between the Warden and a square, When they look around, Then it doesn\'t block', () => {
    const r = strip({ 2: ['lake', 0.1], 3: ['lake', 0.1] });
    expect(seenXs(r)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('an AI player is told how looking around sees, with the switch on; as before with it off', () => {
    expect(observe(warden())).toContain('Looking around (at camp too, close by) sees the squares in sight from where you stand');
    expect(observe(warden(false))).toContain('Looking around once you have headed out sees about 1/2.5/4h each way.');
  });

  it('7. Given the same run and moves, Then the same squares are seen (no randomness)', () => {
    const a = runAction(warden(true, 'w-same'), 'explore');
    const b = runAction(warden(true, 'w-same'), 'explore');
    expect(a.seenOut).toEqual(b.seenOut);
    expect(a.seenOut?.length).toBeGreaterThan(0);
  });
});
