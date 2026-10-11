/**
 * The regions the road villages belong to (#1586), for the knowledge model's `region:` scope
 * (docs/knowledge-model-design.md §1): everyone living or travelling in a region can know its facts.
 *
 * Each road village belongs to two:
 * - **its province**: the generated province it's seated in (provinces.ts `placeAnchors`), the
 *   lordship whose holder and history its people know;
 * - **the north road**: the caravan road the three villages share (road.ts ROUTE), which the
 *   caravan's own people travel too.
 *
 * Derived from the generated world rather than written on the villages (villages.ts): which
 * province a village sits in changes with every seed, and a hand-written field would only repeat
 * what `placeAnchors` already decided. Pure: no randomness, nothing read but the arguments.
 */

import { ANCHORS, type AnchorId, type Province, type Provinces } from './provinces';

/** The region the three road villages share: the caravan road south out of the Reach. */
export const NORTH_ROAD = 'north-road';

/**
 * A province's region id: its name as a key ("Kestrel Gate" → `kestrel-gate`). Names are unique
 * within a Reach, and `placeAnchors` names each road village's province after the village, so a
 * road village's province region always reads the same as the village's id, in every Reach. That
 * lets hand-written facts target `region:hollowford` without knowing the seed, while the province
 * behind it (its land, its lords, its past) is this run's own.
 */
export function regionOf(p: Pick<Province, 'name'>): string {
  return p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Where a road village sits: its generated province and the regions it belongs to. */
export interface VillageRegion {
  village: AnchorId;
  /** The generated province it's seated in: its id this run (`p3`) and its name. */
  province: { id: string; name: string };
  /** The province's region id (`regionOf`). */
  region: string;
  /** The region it shares with the other road villages. */
  road: typeof NORTH_ROAD;
}

/** Each road village's regions, in the order the road reaches them (ANCHORS). */
export function roadRegions(provinces: Provinces): VillageRegion[] {
  return ANCHORS.map(village => {
    const p = provinces.list.find(q => q.anchor === village);
    // placeAnchors seats all three in every Reach (settlements.test.ts pins it), so this is only a guard.
    if (!p) throw new Error(`No province is seated at ${village}`);
    return { village, province: { id: p.id, name: p.name }, region: regionOf(p), road: NORTH_ROAD };
  });
}
