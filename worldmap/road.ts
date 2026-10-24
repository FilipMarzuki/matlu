/**
 * The road and Mistheim on the hex map (#1905, plan: docs/spikes/artificer-hex-world.md §7 "The
 * road and Mistheim"). Step 12 of 17 of the hex world (#1873).
 *
 * `src/artificer/road.ts`'s `ROUTE` has two travel days before each of the three villages and two
 * more to Mistheim, and hexes are a day apart, so the road runs straight south from the start hex:
 * Hollowford, Saltmere and Kestrel Gate at hexes (0,2), (0,4) and (0,6) (already `outerProvinces`'s
 * road seats, provinces.ts #1904), Mistheim two hexes past Kestrel Gate at (0,8).
 *
 * Mistheim itself is a crafted special place, never a generated province: `outerProvinces` never
 * reaches hex (0,8) (`KNOWN_HEXES` stops at (0,7)), so no outer province ever contains it.
 */

import { hexKey, type Hex } from './coords';
import { outerProvinces, type OuterProvince } from './provinces';

/** Mistheim's hex: the road's end, two hexes past Kestrel Gate. Never a generated province. */
export const MISTHEIM_HEX: Hex = { q: 0, r: 8 };

/** The road's hexes south from the start, one apart, (0,0) to Mistheim at (0,8). */
export const ROAD_HEXES: readonly Hex[] = Array.from({ length: 9 }, (_, r) => ({ q: 0, r }));

export type RoadVillageId = 'hollowford' | 'saltmere' | 'kestrel-gate';

/** The three hand-written road villages' hexes (`outerProvinces`'s road seats), south in order. */
export const ROAD_VILLAGE_HEXES: Readonly<Record<RoadVillageId, Hex>> = {
  hollowford: { q: 0, r: 2 },
  saltmere: { q: 0, r: 4 },
  'kestrel-gate': { q: 0, r: 6 },
};

/** The outer province seated at a road village's hex (`h0`, `h1` or `h2`): where it moves to with `hex-world` on. */
export function roadVillageProvince(seed: number, id: RoadVillageId): OuterProvince {
  const key = hexKey(ROAD_VILLAGE_HEXES[id]);
  const found = outerProvinces(seed).find(p => hexKey(p.seat) === key);
  if (!found) throw new Error(`roadVillageProvince: no outer province seated at ${id}'s hex`);
  return found;
}
