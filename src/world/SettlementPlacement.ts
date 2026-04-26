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

  // Phase 4: connect buildings to road network with secondary paths
  const pathRng = mulberry32(seed + 31);
  const connectorPaths = connectBuildings(result, roads.set, placed, gridSize, pathRng);

  // Merge main roads + connector paths (connectors are marked main=false)
  const allRoads = [...roads.tiles, ...connectorPaths];

  return { buildings: result, roads: allRoads };
}

// ── Building-to-road connector paths ─────────────────────────────────────────

/**
 * Connect each building to the nearest road/path tile via grid-stepping.
 *
 * Algorithm:
 * 1. Start with the road network as "connected" tiles.
 * 2. Sort buildings by distance to nearest connected tile (closest first).
 * 3. For each building, trace a path from its edge to the nearest connected
 *    tile, stepping through the grid while avoiding building footprints.
 * 4. Add wobble so paths look foot-worn, not ruler-drawn.
 * 5. New path tiles become "connected" so subsequent buildings can reach them.
 *
 * For `none` pattern (no main roads), the first building's position seeds
 * the connected set, and all others connect to it — creating a natural
 * web of foot paths.
 */
function connectBuildings(
  buildings: PlacedBuilding[],
  roadSet: TileSet,
  placed: Array<{ tx: number; ty: number; size: number }>,
  gridSize: number,
  rng: () => number,
): RoadTile[] {
  if (buildings.length === 0) return [];

  // Working copy of connected tiles — starts as road network
  const connected = new Set(roadSet);
  const paths: RoadTile[] = [];

  // If no roads at all, seed with the centre-most building's adjacent tile
  if (connected.size === 0 && buildings.length > 0) {
    const mid = Math.floor(gridSize / 2);
    // Find building closest to centre
    let best = buildings[0];
    let bestDist = Infinity;
    for (const b of buildings) {
      const d = (b.tx - mid) ** 2 + (b.ty - mid) ** 2;
      if (d < bestDist) { bestDist = d; best = b; }
    }
    // Seed an adjacent tile
    const seedTx = best.tx + Math.ceil(best.widthT / 2) + 1;
    const seedTy = best.ty;
    connected.add(tileKey(seedTx, seedTy));
    paths.push({ tx: seedTx, ty: seedTy, main: false });
  }

  // Build a set of occupied tiles (building footprints) for avoidance
  const occupied = new Set<string>();
  for (const p of placed) {
    const half = Math.ceil(p.size / 2);
    for (let dx = -half; dx <= half; dx++) {
      for (let dy = -half; dy <= half; dy++) {
        occupied.add(tileKey(p.tx + dx, p.ty + dy));
      }
    }
  }

  // Sort buildings: closest to any connected tile first (greedy)
  const sorted = [...buildings];
  sorted.sort((a, b) => {
    const distA = nearestConnectedDist(a.tx, a.ty, connected);
    const distB = nearestConnectedDist(b.tx, b.ty, connected);
    return distA - distB;
  });

  for (const building of sorted) {
    // Find the building-edge tile closest to any connected tile
    const half = Math.ceil(building.widthT / 2);
    let bestStart = { tx: building.tx + half + 1, ty: building.ty };
    let bestDist = Infinity;

    // Check all edge tiles around the building
    for (let dx = -(half + 1); dx <= half + 1; dx++) {
      for (let dy = -(half + 1); dy <= half + 1; dy++) {
        // Only edge tiles (not inside the footprint)
        if (Math.abs(dx) <= half && Math.abs(dy) <= half) continue;
        const etx = building.tx + dx;
        const ety = building.ty + dy;
        if (etx < 0 || ety < 0 || etx >= gridSize || ety >= gridSize) continue;
        const d = nearestConnectedDist(etx, ety, connected);
        if (d < bestDist) { bestDist = d; bestStart = { tx: etx, ty: ety }; }
      }
    }

    // Already adjacent to connected network — no path needed
    if (bestDist <= 1) {
      connected.add(tileKey(bestStart.tx, bestStart.ty));
      continue;
    }

    // Trace a path from bestStart toward nearest connected tile
    const path = tracePath(bestStart.tx, bestStart.ty, connected, occupied, gridSize, rng);
    for (const p of path) {
      const k = tileKey(p.tx, p.ty);
      if (!connected.has(k)) {
        connected.add(k);
        paths.push(p);
      }
    }
  }

  return paths;
}

/** Manhattan distance to the nearest tile in the connected set. */
function nearestConnectedDist(tx: number, ty: number, connected: TileSet): number {
  if (connected.has(tileKey(tx, ty))) return 0;
  // Search outward in rings (fast for nearby connections)
  for (let r = 1; r <= 30; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > r) continue; // diamond search
        if (connected.has(tileKey(tx + dx, ty + dy))) return r;
      }
    }
  }
  return 999;
}

/**
 * Trace a grid path from (sx,sy) toward the nearest connected tile.
 * Steps toward the target with random wobble to avoid straight lines.
 * Avoids occupied tiles (building footprints).
 */
function tracePath(
  sx: number, sy: number,
  connected: TileSet,
  occupied: Set<string>,
  gridSize: number,
  rng: () => number,
): RoadTile[] {
  const path: RoadTile[] = [];
  let cx = sx;
  let cy = sy;
  const visited = new Set<string>();
  visited.add(tileKey(cx, cy));

  // Find target: nearest connected tile
  let targetX = cx;
  let targetY = cy;
  let bestDist = Infinity;
  for (let r = 1; r <= 40; r++) {
    let found = false;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > r) continue;
        if (connected.has(tileKey(cx + dx, cy + dy))) {
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; targetX = cx + dx; targetY = cy + dy; found = true; }
        }
      }
    }
    if (found) break;
  }

  // Step toward target with wobble
  for (let step = 0; step < 60; step++) {
    if (connected.has(tileKey(cx, cy))) break;

    path.push({ tx: cx, ty: cy, main: false });

    const dx = targetX - cx;
    const dy = targetY - cy;
    if (dx === 0 && dy === 0) break;

    // Pick primary direction toward target
    let nx = cx;
    let ny = cy;

    // 70% move toward target, 30% wobble perpendicular
    if (rng() < 0.7) {
      // Move along the longer axis
      if (Math.abs(dx) >= Math.abs(dy)) {
        nx += dx > 0 ? 1 : -1;
      } else {
        ny += dy > 0 ? 1 : -1;
      }
    } else {
      // Wobble perpendicular
      if (Math.abs(dx) >= Math.abs(dy)) {
        ny += rng() > 0.5 ? 1 : -1;
      } else {
        nx += rng() > 0.5 ? 1 : -1;
      }
    }

    // Bounds + collision check
    if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;
    const nk = tileKey(nx, ny);
    if (occupied.has(nk) && !connected.has(nk)) {
      // Try to step around the obstacle
      const alt1 = { tx: cx + (dy !== 0 ? 1 : 0), ty: cy + (dx !== 0 ? 1 : 0) };
      const alt2 = { tx: cx - (dy !== 0 ? 1 : 0), ty: cy - (dx !== 0 ? 1 : 0) };
      const ak1 = tileKey(alt1.tx, alt1.ty);
      const ak2 = tileKey(alt2.tx, alt2.ty);
      if (!occupied.has(ak1) && !visited.has(ak1)) {
        nx = alt1.tx; ny = alt1.ty;
      } else if (!occupied.has(ak2) && !visited.has(ak2)) {
        nx = alt2.tx; ny = alt2.ty;
      } else {
        continue; // stuck — skip this step
      }
    }

    if (visited.has(tileKey(nx, ny))) continue;
    visited.add(tileKey(nx, ny));
    cx = nx;
    cy = ny;
  }

  // Add final tile if we reached the connected network
  if (connected.has(tileKey(cx, cy))) {
    path.push({ tx: cx, ty: cy, main: false });
  }

  return path;
}
