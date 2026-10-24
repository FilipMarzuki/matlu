/**
 * The run's world as the page draws it: its provinces (#1540) and the settlement at each one's seat
 * (#1541), built the first time they're asked for and kept while the run is played, so a render
 * doesn't rebuild them. Moved out of main.ts (#1905) so the caching can be tested.
 *
 * Kept by `runWorldKey`: the run's seed *and* where it seats the three road villages (#1905,
 * `roadAnchorsOf`). A Warden's id, and with it the seed, carries over from one run to the next,
 * and with `hex-world` toggled the same seed makes other provinces (the villages move out of the
 * Reach) and so other settlements. Kept by the seed alone, the next run would be drawn with the
 * last one's. main.ts keeps the run's told history by the same key.
 */

import { reachOfRun } from '../artificer/descriptive-map';
import { seedOf } from '../artificer/rng';
import type { Region1State } from '../artificer/region1';
import { roadAnchorsOf } from '../artificer/world/hex-window';
import { provincesOf, worldKey, type Provinces } from '../artificer/world/provinces';
import { settlementOf, type Settlement } from '../artificer/world/settlements';

/** What a run's world is made from: its Warden (whose id seeds it) and its rule switches. */
type RunWorld = Pick<Region1State, 'character' | 'config'>;

/** The key the run's provinces, settlements and history are kept by: its seed and where it seats the road villages. */
export const runWorldKey = (s: RunWorld): string => worldKey(seedOf(s.character.id), roadAnchorsOf(s.config.world.features));

let provincesCache: Provinces | null = null;
let provincesKey: string | null = null;

/** The run's provinces: quick to make from the map, but asked for on every render of the map and history. */
export function provincesFor(s: RunWorld): Provinces {
  const key = runWorldKey(s);
  if (provincesKey !== key || !provincesCache) {
    provincesCache = provincesOf(reachOfRun(s), { roadAnchors: roadAnchorsOf(s.config.world.features) });
    provincesKey = key;
  }
  return provincesCache;
}

// Laying a settlement out takes a few milliseconds, so each is built the first time it's opened.
let settlementCache = new Map<string, Settlement>();
let settlementKey: string | null = null;

/** The settlement at a province's seat, by the province's id. */
export function settlementFor(s: RunWorld, provinceId: string): Settlement {
  const key = runWorldKey(s);
  if (settlementKey !== key) { settlementCache = new Map(); settlementKey = key; }
  let found = settlementCache.get(provinceId);
  if (!found) {
    found = settlementOf(reachOfRun(s), provincesFor(s).list.find(p => p.id === provinceId)!);
    settlementCache.set(provinceId, found);
  }
  return found;
}
