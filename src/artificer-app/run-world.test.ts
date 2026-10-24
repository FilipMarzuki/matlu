/**
 * #1905 (review of PR #1970) — the page's world caches (run-world.ts). A Warden's id, and with it
 * the run's seed, carries over from one run to the next, and with `hex-world` toggled the same
 * seed makes other provinces (the road villages move out of the Reach) and so other settlements.
 * Kept by the seed alone, the next run was drawn with the last one's: kept by the seed and where
 * the run seats the road villages, each run gets its own.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { seedOf } from '../artificer/rng';
import { generateReach } from '../artificer/world/reach';
import { provincesOf } from '../artificer/world/provinces';
import { provincesFor, runWorldKey, settlementFor } from './run-world';

const WARDEN = 'w-vega';
const runWith = (hexWorld: boolean): Region1State =>
  createRegion1({ world: { ...FULL_WORLD, features: { 'hex-world': hexWorld } } }, undefined, { id: WARDEN });

describe("the page's world caches (#1905)", () => {
  it('draw a run with hex-world toggled, under the same Warden, with its own provinces and settlements', () => {
    const off = runWith(false);
    const on = runWith(true);
    const reach = generateReach(seedOf(WARDEN));
    expect(runWorldKey(on)).not.toBe(runWorldKey(off));
    expect(runWorldKey(runWith(false))).toBe(runWorldKey(off));

    // Switch off: Hollowford is seated in one of the Reach's provinces, and its settlement is the village.
    const hollowford = provincesFor(off).list.find(p => p.anchor === 'hollowford')!;
    expect(settlementFor(off, hollowford.id).anchor).toBe('hollowford');
    // The next run, the same Warden, the switch on: no village is seated in the Reach.
    expect(provincesFor(on)).toEqual(provincesOf(reach, { roadAnchors: 'hexes' }));
    expect(settlementFor(on, hollowford.id).anchor).toBeUndefined();
    // And back again.
    expect(provincesFor(off)).toEqual(provincesOf(reach));
    expect(settlementFor(off, hollowford.id).anchor).toBe('hollowford');
  });
});
