/**
 * SettlementPlacement — pure placement algorithm for positioning roads
 * and buildings on an iso tile grid without overlaps.
 *
 * Extracted from SettlementForgeScene so the logic is testable without Phaser.
 */

import type { ResolvedBuilding } from './SettlementGenerator';

// ── Types ────────────────────────────────────────────────────────────────────

export type StreetPattern = 'grid' | 'radial' | 'organic' | 'linear' | 'none' | 'branching';

export interface PlacementInput {
  buildings: ResolvedBuilding[];
  radiusTiles: number;
  gridSize: number;
  tileSize: number;
  seed: number;
  zoneFracs: Record<string, { min: number; max: number }>;
  streetPattern?: StreetPattern;
}

export interface RoadTile {
  tx: number;
  ty: number;
  /** True for main road tiles, false for secondary connectors. */
  main: boolean;
}

export interface PlacedBuilding {
  tx: number;
  ty: number;
  widthT: number;
  depthT: number;
  building: ResolvedBuilding;
  /** True if the building was placed via fallback (may be in a non-ideal spot). */
  fallback: boolean;
}

export interface PlacementResult {
  buildings: PlacedBuilding[];
  roads: RoadTile[];
}

// ── PRNG ─────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Overlap test ────────────────────────────────────────────────────��────────

/**
 * AABB overlap test — checks whether two axis-aligned tile rectangles
 * (with a gap buffer) would intersect on the grid.
 */
export function rectsOverlap(
  ax: number, ay: number, aw: number,
  bx: number, by: number, bw: number,
  gap: number,
): boolean {
  const halfA = aw / 2 + gap;
  const halfB = bw / 2;
  return Math.abs(ax - bx) < (halfA + halfB) &&
         Math.abs(ay - by) < (halfA + halfB);
}

// ── Road generation ──────────────────────────────────────────────────────────

/** Set of tile keys for fast lookup. */
type TileSet = Set<string>;
const tileKey = (tx: number, ty: number) => `${tx},${ty}`;

/**
 * Generate main road tiles based on street pattern.
 * Roads are 1 tile wide. Returns road tile positions + a set for fast lookup.
 */
function generateRoads(
  pattern: StreetPattern,
  mid: number,
  radiusTiles: number,
  gridSize: number,
  rng: () => number,
): { tiles: RoadTile[]; set: TileSet } {
  const tiles: RoadTile[] = [];
  const set: TileSet = new Set();

  const addRoad = (tx: number, ty: number, main: boolean) => {
    const k = tileKey(tx, ty);
    if (set.has(k)) return;
    if (tx < 0 || ty < 0 || tx >= gridSize || ty >= gridSize) return;
    set.add(k);
    tiles.push({ tx, ty, main });
  };

  const r = Math.floor(radiusTiles);

  switch (pattern) {
    case 'grid': {
      // Two perpendicular main roads through centre
      for (let i = -r; i <= r; i++) {
        addRoad(mid + i, mid, true);     // horizontal
        addRoad(mid, mid + i, true);     // vertical
      }
      break;
    }

    case 'radial': {
      // 3-4 spokes radiating from centre
      const spokeCount = 3 + Math.floor(rng() * 2); // 3 or 4
      for (let s = 0; s < spokeCount; s++) {
        const angle = (s / spokeCount) * Math.PI * 2 + rng() * 0.3;
        for (let d = 0; d <= r; d++) {
          const tx = Math.round(mid + Math.cos(angle) * d);
          const ty = Math.round(mid + Math.sin(angle) * d);
          addRoad(tx, ty, true);
        }
      }
      break;
    }

    case 'linear': {
      // One main road through centre + a short perpendicular at the plaza
      for (let i = -r; i <= r; i++) {
        addRoad(mid + i, mid, true);
      }
      // Short cross-street at centre
      const crossLen = Math.floor(r * 0.4);
      for (let i = -crossLen; i <= crossLen; i++) {
        addRoad(mid, mid + i, false);
      }
      break;
    }

    case 'branching': {
      // Main trunk + 2-3 branches at random angles
      for (let i = -r; i <= r; i++) {
        addRoad(mid + i, mid, true);
      }
      const branchCount = 2 + Math.floor(rng() * 2);
      for (let b = 0; b < branchCount; b++) {
        // Branch starts at a random point along the trunk
        const startX = mid + Math.floor((rng() - 0.5) * r * 1.4);
        const angle = (rng() > 0.5 ? 1 : -1) * (0.3 + rng() * 0.7); // angled off trunk
        const branchLen = Math.floor(r * (0.3 + rng() * 0.4));
        for (let d = 0; d < branchLen; d++) {
          const tx = Math.round(startX + Math.cos(angle) * d);
          const ty = Math.round(mid + Math.sin(angle) * d);
          addRoad(tx, ty, false);
        }
      }
      break;
    }

    case 'organic': {
      // Drunk-walk paths from edge toward centre, 2-3 paths
      const pathCount = 2 + Math.floor(rng() * 2);
      for (let p = 0; p < pathCount; p++) {
        const startAngle = (p / pathCount) * Math.PI * 2 + rng() * 0.5;
        let cx = Math.round(mid + Math.cos(startAngle) * r);
        let cy = Math.round(mid + Math.sin(startAngle) * r);
        // Walk toward centre with random wobble
        for (let step = 0; step < r * 3; step++) {
          addRoad(cx, cy, p === 0);
          const dx = mid - cx;
          const dy = mid - cy;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
          // Bias toward centre + wobble
          const wobble = (rng() - 0.5) * 1.5;
          if (Math.abs(dx) > Math.abs(dy) + wobble) {
            cx += dx > 0 ? 1 : -1;
          } else {
            cy += dy > 0 ? 1 : -1;
          }
        }
      }
      break;
    }

    case 'none':
    default:
      // No roads (Giant Steadings, Lövfolk Groves)
      break;
  }

  return { tiles, set };
}

// ── Main placement algorithm ─────────────────────────────────────────────────

/**
 * Generate roads then place buildings on a tile grid without overlaps.
 *
 * Buildings prefer road-adjacent positions (within 2 tiles of a road).
 * If no road-adjacent spot is found within the first 60 attempts, falls
 * back to pure zone-ring placement.
 */
export function placeBuildings(input: PlacementInput): PlacementResult {
  const { buildings, radiusTiles, gridSize, tileSize, seed, zoneFracs,
          streetPattern = 'none' } = input;
  const mid = Math.floor(gridSize / 2);
  const roadRng = mulberry32(seed + 7);
  const rng = mulberry32(seed + 13);
  const gap = 1.0;

  // Phase 0: generate road network
  const roads = generateRoads(streetPattern, mid, radiusTiles, gridSize, roadRng);

  const placed: Array<{ tx: number; ty: number; size: number }> = [];
  const result: PlacedBuilding[] = [];

  /** Check if a position is adjacent to a road tile (within dist tiles). */
  const nearRoad = (tx: number, ty: number, dist: number): boolean => {
    for (let dx = -dist; dx <= dist; dx++) {
      for (let dy = -dist; dy <= dist; dy++) {
        if (roads.set.has(tileKey(tx + dx, ty + dy))) return true;
      }
    }
    return false;
  };

  /** Check if a position overlaps a road tile (buildings shouldn't sit on roads). */
  const onRoad = (tx: number, ty: number, widthT: number): boolean => {
    const half = Math.ceil(widthT / 2);
    for (let dx = -half; dx <= half; dx++) {
      for (let dy = -half; dy <= half; dy++) {
        if (roads.set.has(tileKey(tx + dx, ty + dy))) return true;
      }
    }
    return false;
  };

  for (const building of buildings) {
    const frac = zoneFracs[building.zone] ?? zoneFracs['middle'] ?? { min: 0.38, max: 0.65 };
    const widthT = Math.max(1, Math.round(building.w / tileSize));
    const depthT = widthT;
    const hasRoads = roads.tiles.length > 0;

    // Phase 1: try road-adjacent placement first (60 attempts), then any zone (60 more)
    let success = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      const angle = rng() * Math.PI * 2;
      const zonePad = attempt > 60 ? 0.15 : 0;
      const minR = Math.max(0, frac.min - zonePad);
      const maxR = Math.min(1.0, frac.max + zonePad);
      const dist = radiusTiles * (minR + rng() * (maxR - minR));
      const tx = Math.round(mid + Math.cos(angle) * dist);
      const ty = Math.round(mid + Math.sin(angle) * dist);

      if (tx < 1 || ty < 1 || tx >= gridSize - 1 || ty >= gridSize - 1) continue;

      // Don't place on top of roads
      if (hasRoads && onRoad(tx, ty, widthT)) continue;

      // First 60 attempts: prefer road-adjacent positions
      if (hasRoads && attempt < 60 && !nearRoad(tx, ty, 2)) continue;

      const overlaps = placed.some(p =>
        rectsOverlap(tx, ty, widthT, p.tx, p.ty, p.size, gap));

      if (!overlaps) {
        placed.push({ tx, ty, size: widthT });
        result.push({ tx, ty, widthT, depthT, building, fallback: false });
        success = true;
        break;
      }
    }

    if (success) continue;

    // Phase 2: spiral outward from zone midpoint
    const baseAngle = rng() * Math.PI * 2;
    const baseDist = radiusTiles * (frac.min + frac.max) / 2;
    let foundFallback = false;
    for (let ring = 0; ring < 8 && !foundFallback; ring++) {
      for (let step = 0; step < 12; step++) {
        const a = baseAngle + (step / 12) * Math.PI * 2;
        const d = baseDist + ring * 1.5;
        const tx = Math.round(mid + Math.cos(a) * d);
        const ty = Math.round(mid + Math.sin(a) * d);
        if (tx < 1 || ty < 1 || tx >= gridSize - 1 || ty >= gridSize - 1) continue;
        if (hasRoads && onRoad(tx, ty, widthT)) continue;
        const overlaps = placed.some(p =>
          rectsOverlap(tx, ty, widthT, p.tx, p.ty, p.size, gap));
        if (!overlaps) {
          placed.push({ tx, ty, size: widthT });
          result.push({ tx, ty, widthT, depthT, building, fallback: true });
          foundFallback = true;
          break;
        }
      }
    }

    // Phase 3: last resort — force place
    if (!foundFallback) {
      const tx = Math.round(mid + Math.cos(baseAngle) * baseDist);
      const ty = Math.round(mid + Math.sin(baseAngle) * baseDist);
      placed.push({ tx, ty, size: widthT });
      result.push({ tx, ty, widthT, depthT, building, fallback: true });
    }
  }

  return { buildings: result, roads: roads.tiles };
}
