/**
 * SettlementLayout — generates the building placement for a settlement.
 *
 * ## Algorithm
 * Buildings are placed ring-by-ring using rejection sampling inside annular
 * zones. Each `BuildingDef` specifies a zone ('inner' | 'middle' | 'outer')
 * which maps to a radial fraction range. Within that range, candidate positions
 * are drawn from a uniform annular distribution (using the √r trick to avoid
 * centre-clustering) and tested for AABB overlap with already-placed buildings.
 *
 * Inner-zone buildings are placed first, giving economic centrepieces (market
 * halls, sawmills) priority before homes and storage fight for space.
 *
 * ## Why not Poisson disk?
 * The `poissonDisk` utility in rng.ts is great for open-world scatter where you
 * want even coverage of a large area. For small, zoned settlements we need
 * *controlled* density per ring — more freedom in the outer ring, tighter
 * packing in the inner — which rejection sampling expresses more cleanly.
 *
 * ## Determinism
 * The caller must pass a seeded RNG (mulberry32) so the layout is identical
 * on every page reload for a given settlement id and game seed.
 */

import type { Settlement } from './Level1';
import { buildingProgramme, SETTLEMENT_ECONOMY } from './BuildingCatalogue';
import type { BuildingZone } from './BuildingCatalogue';

/** A building that has been successfully placed in world space. */
export interface PlacedBuilding {
  /** World x of the building centre. */
  x: number;
  /** World y of the building centre. */
  y: number;
  /** Display width in world pixels (drives sprite scale). */
  w: number;
  /**
   * Approximate display height — derived from the frame's aspect ratio.
   * Used only for overlap rejection; the actual rendered height is computed
   * from the sprite's intrinsic dimensions after scaling.
   */
  h: number;
  /** Named frame key on the 'building-roofs' texture. */
  frameKey: string;
  /** Human-readable role — useful for future tooltip / lore systems. */
  role: string;
}

// Radial fractions [min, max] as a proportion of the settlement radius.
// Chosen so that:
//   inner  starts outside a natural "plaza" clearing (~15% r)
//   middle fills the main residential band
//   outer  stops short of the dashed boundary circle (~88% r)
const ZONE_RANGES: Record<BuildingZone, [number, number]> = {
  inner:  [0.15, 0.38],
  middle: [0.38, 0.65],
  outer:  [0.65, 0.88],
};

/** Minimum pixel gap between the AABBs of any two buildings. */
const MIN_GAP = 5;

/**
 * Generate the building layout for a settlement.
 *
 * @param s    Settlement definition from Level1.SETTLEMENTS
 * @param rng  Seeded PRNG (mulberry32) — must be dedicated to this settlement
 *             so drawing from it doesn't affect other placement systems
 */
export function layoutSettlement(s: Settlement, rng: () => number): PlacedBuilding[] {
  const economy = SETTLEMENT_ECONOMY[s.id];
  // Unknown settlement id — return empty so no buildings are rendered.
  if (!economy) return [];

  const programme = buildingProgramme(economy);
  const placed: PlacedBuilding[] = [];

  for (const def of programme) {
    const [rMin, rMax] = ZONE_RANGES[def.zone];

    for (let n = 0; n < def.count; n++) {
      // Width is randomised per instance within the def's [minW, maxW] range.
      const w = def.minW + rng() * (def.maxW - def.minW);
      // Approximate height: most Pixel Crawler roof frames are ~1.7:1 wide:tall,
      // so multiply width by 0.6 to get a safe bounding box height for overlap tests.
      const h = w * 0.6;

      // Try up to 40 candidate positions — if none fit, skip this instance.
      // A miss is preferable to forcing an overlap in a tight settlement.
      for (let attempt = 0; attempt < 40; attempt++) {
        // Uniform random point in the annulus [rMin·r, rMax·r].
        // √(rng()) maps a uniform [0,1] to a radial distribution that is
        // uniform in *area* within the annulus — without this correction the
        // inner part of the ring is over-sampled.
        const rFrac = rMin + Math.sqrt(rng()) * (rMax - rMin);
        const angle = rng() * Math.PI * 2;
        const bx    = s.x + Math.cos(angle) * rFrac * s.radius;
        const by    = s.y + Math.sin(angle) * rFrac * s.radius;

        // AABB overlap test against all already-placed buildings.
        // Two AABBs overlap when both axes overlap, so we test whether the
        // signed gap on each axis is positive — if both are negative, they overlap.
        let overlaps = false;
        for (const p of placed) {
          const gapX = Math.abs(bx - p.x) - (w + p.w) / 2 - MIN_GAP;
          const gapY = Math.abs(by - p.y) - (h + p.h) / 2 - MIN_GAP;
          if (gapX < 0 && gapY < 0) { overlaps = true; break; }
        }
        if (overlaps) continue;

        placed.push({ x: bx, y: by, w, h, frameKey: def.frameKey, role: def.role });
        break; // success — move on to next instance
      }
      // If attempt loop exhausted without a placement, this instance is simply
      // omitted. The settlement still renders with the buildings that did fit.
    }
  }

  return placed;
}
