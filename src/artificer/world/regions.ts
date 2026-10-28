/**
 * Which region each place belongs to (#1586), for the knowledge model's `region:` scope
 * (knowledge.ts `Scope`, docs/knowledge-model-design.md §1): everyone living or travelling in a
 * region can know its facts, and a person (knowledge.ts `Knower.region`) belongs to one.
 *
 * **Regions are semi-generated: crafted where we write them, generated where we don't.**
 * A province's region is, in order:
 * 1. **crafted**: a region we've written by hand (CRAFTED_REGIONS), keyed by the hand-written
 *    village seated in the province. Today that's the three road villages, which all belong to
 *    the north road: the caravan road they share (road.ts ROUTE), which the caravan's own
 *    people travel too. A crafted region always wins, so the story we've written holds in every seed;
 * 2. **generated**: the region the story engine's regional level grouped the province into
 *    (#1598: regional-facts.ts `regionOfProvince`, ids like `hollowford-country`), when the caller
 *    has a told history to hand (`generatedRegions(history)`);
 * 3. otherwise **the province's own region** (`regionOf`): its name as a key, a region of one.
 *
 * Which province a village is seated in still comes from the generated world (provinces.ts
 * `placeAnchors`), so it changes with every seed; only the region it belongs to is written down.
 * With `hex-world` on, the villages aren't seated in the Reach at all (#1905, `roadRegions`).
 * Pure: no randomness, nothing read but the arguments.
 */

import { ANCHORS, type AnchorId, type Province, type Provinces, type RoadAnchors } from './provinces';
import type { ReachHistory } from './history-format';
import { regionOfProvince } from './regional-facts';

/** The region the three road villages share: the caravan road south out of the Reach. */
export const NORTH_ROAD = 'north-road';

/**
 * The crafted regions: by the hand-written village a province is seated at. Add a village (or
 * give one a region of its own) here, and that wins over whatever the generator decided.
 */
export const CRAFTED_REGIONS: Readonly<Partial<Record<AnchorId, string>>> = {
  hollowford: NORTH_ROAD,
  saltmere: NORTH_ROAD,
  'kestrel-gate': NORTH_ROAD,
};

/** The generated region a province id belongs to, if the caller has the regions to hand. */
export type GeneratedRegions = (provinceId: string) => string | undefined;

/** The generated regions of a told history (#1598), by province id. */
export function generatedRegions(history: ReachHistory): GeneratedRegions {
  return provinceId => regionOfProvince(history, provinceId)?.id;
}

/**
 * A province's own region id, the last fallback: its name as a key ("Kestrel Gate" →
 * `kestrel-gate`). Names are unique within a Reach.
 */
export function regionOf(p: Pick<Province, 'name'>): string {
  return p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** The region a province belongs to: crafted, else generated, else its own (see the header). */
export function regionFor(p: Pick<Province, 'id' | 'name' | 'anchor'>, generated?: GeneratedRegions): { id: string; crafted: boolean } {
  const crafted = p.anchor ? CRAFTED_REGIONS[p.anchor] : undefined;
  if (crafted) return { id: crafted, crafted: true };
  return { id: generated?.(p.id) ?? regionOf(p), crafted: false };
}

/** Where a road village sits: its generated province and the region it belongs to. */
export interface VillageRegion {
  village: AnchorId;
  /** The generated province it's seated in: its id this run (`p3`) and its name. */
  province: { id: string; name: string };
  /** The region it belongs to (`regionFor`). */
  region: string;
  /** Whether that region is a crafted one (CRAFTED_REGIONS) rather than generated. */
  crafted: boolean;
}

/**
 * Each road village's province and region, in the order the road reaches them (ANCHORS).
 *
 * `roadAnchors` is where the run seats the villages (#1905), and so where `provinces` were made
 * to seat them. With `'hexes'` (`hex-world` on) none of them is in the Reach: they sit out on the
 * hex map, in outer provinces (worldmap/road.ts) that no told history has a word of yet (telling
 * theirs is #1906). So there's no road village here to name, and the list is empty: what reads it
 * (remembered.ts, and through it play's facts and the run's rumours) gets nothing of the Reach's
 * history for the villages, rather than another province's read as theirs. When #1906 tells the
 * outer provinces' history, this is where their provinces come back in.
 */
export function roadRegions(provinces: Provinces, generated?: GeneratedRegions, roadAnchors: RoadAnchors = 'reach'): VillageRegion[] {
  if (roadAnchors === 'hexes') return [];
  return ANCHORS.map(village => {
    const p = provinces.list.find(q => q.anchor === village);
    // With 'reach', placeAnchors seats all three in every Reach (settlements.test.ts pins it), so this is only a guard.
    if (!p) throw new Error(`No province is seated at ${village}`);
    const r = regionFor(p, generated);
    return { village, province: { id: p.id, name: p.name }, region: r.id, crafted: r.crafted };
  });
}
