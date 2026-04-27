/**
 * SettlementPlacement — place buildings one at a time on a tile grid,
 * connecting each to the road network immediately via AStarGrid.
 *
 * Uses the same pathfinding as CombatArenaScene (AStarGrid): build a flat
 * grid of 0=floor/1=wall, then A* from building entrance to nearest road.
 */

import type { ResolvedBuilding } from './SettlementGenerator';
import { aStarPath } from '../ai/AStarGrid';

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
  main: boolean;
}

/** Cardinal side the entrance is on, relative to the building centre. */
export type EntranceSide = 'n' | 's' | 'e' | 'w';

export interface PlacedBuilding {
  tx: number;
  ty: number;
  widthT: number;
  depthT: number;
  building: ResolvedBuilding;
  fallback: boolean;
  /** Tile coordinate of the chosen entrance (just outside the footprint). */
  entranceTx?: number;
  entranceTy?: number;
  /** Which face the entrance is on. */
  entranceSide?: EntranceSide;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** AABB overlap check for building placement. */
export function rectsOverlap(
  ax: number, ay: number, aw: number,
  bx: number, by: number, bw: number,
  gap: number,
): boolean {
  // Use ceil to match the actual stamp footprint (centre ± ceil(w/2))
  const halfA = Math.ceil(aw / 2) + gap;
  const halfB = Math.ceil(bw / 2);
  return Math.abs(ax - bx) <= (halfA + halfB) &&
         Math.abs(ay - by) <= (halfA + halfB);
}

/** Mark a rectangular area on the grid as wall (1). */
function stampBuilding(grid: Uint8Array, cols: number, cx: number, cy: number, half: number): void {
  for (let dx = -half; dx <= half; dx++) {
    for (let dy = -half; dy <= half; dy++) {
      const gx = cx + dx;
      const gy = cy + dy;
      if (gx >= 0 && gy >= 0 && gx < cols && gy < cols) {
        grid[gy * cols + gx] = 1;
      }
    }
  }
}

/** Mark a tile as road (0 = passable) — but never clear a building wall. */
function stampRoad(grid: Uint8Array, cols: number, tx: number, ty: number, buildingWalls: Set<string>): void {
  if (tx >= 0 && ty >= 0 && tx < cols && ty < cols) {
    if (!buildingWalls.has(`${tx},${ty}`)) {
      grid[ty * cols + tx] = 0;
    }
  }
}

// ── Road generation ──────────────────────────────────────────────────────────

function generateRoads(
  pattern: StreetPattern,
  mid: number,
  radiusTiles: number,
  gridSize: number,
  rng: () => number,
): RoadTile[] {
  const tiles: RoadTile[] = [];
  const seen = new Set<string>();

  const add = (tx: number, ty: number, main: boolean) => {
    const k = `${tx},${ty}`;
    if (seen.has(k) || tx < 0 || ty < 0 || tx >= gridSize || ty >= gridSize) return;
    seen.add(k);
    tiles.push({ tx, ty, main });
  };

  const r = Math.floor(radiusTiles);

  switch (pattern) {
    case 'grid':
      for (let i = -r; i <= r; i++) {
        add(mid + i, mid, true);
        add(mid, mid + i, true);
      }
      break;

    case 'radial': {
      const spokes = 3 + Math.floor(rng() * 2);
      for (let s = 0; s < spokes; s++) {
        const angle = (s / spokes) * Math.PI * 2 + rng() * 0.3;
        for (let d = 0; d <= r; d++) {
          add(Math.round(mid + Math.cos(angle) * d), Math.round(mid + Math.sin(angle) * d), true);
        }
      }
      break;
    }

    case 'linear':
      for (let i = -r; i <= r; i++) add(mid + i, mid, true);
      for (let i = -Math.floor(r * 0.4); i <= Math.floor(r * 0.4); i++) add(mid, mid + i, false);
      break;

    case 'branching': {
      for (let i = -r; i <= r; i++) add(mid + i, mid, true);
      const branches = 2 + Math.floor(rng() * 2);
      for (let b = 0; b < branches; b++) {
        const startX = mid + Math.floor((rng() - 0.5) * r * 1.4);
        const angle = (rng() > 0.5 ? 1 : -1) * (0.3 + rng() * 0.7);
        const len = Math.floor(r * (0.3 + rng() * 0.4));
        for (let d = 0; d < len; d++) {
          add(Math.round(startX + Math.cos(angle) * d), Math.round(mid + Math.sin(angle) * d), false);
        }
      }
      break;
    }

    case 'organic': {
      const paths = 2 + Math.floor(rng() * 2);
      for (let p = 0; p < paths; p++) {
        const startAngle = (p / paths) * Math.PI * 2 + rng() * 0.5;
        let cx = Math.round(mid + Math.cos(startAngle) * r);
        let cy = Math.round(mid + Math.sin(startAngle) * r);
        for (let step = 0; step < r * 3; step++) {
          add(cx, cy, p === 0);
          const dx = mid - cx;
          const dy = mid - cy;
          if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break;
          const wobble = (rng() - 0.5) * 1.5;
          if (Math.abs(dx) > Math.abs(dy) + wobble) cx += dx > 0 ? 1 : -1;
          else cy += dy > 0 ? 1 : -1;
        }
      }
      break;
    }

    case 'none':
    default:
      break;
  }

  return tiles;
}

// ── Main: place + connect one building at a time ─────────────────────────────

export function placeBuildings(input: PlacementInput): PlacementResult {
  const { buildings, radiusTiles, gridSize, tileSize: _tileSize, seed, zoneFracs,
          streetPattern = 'none' } = input;
  const mid = Math.floor(gridSize / 2);
  const roadRng = mulberry32(seed + 7);
  const rng = mulberry32(seed + 13);

  // ── Flat grid: 0 = passable, 1 = wall ──────────────────────────────────
  const grid = new Uint8Array(gridSize * gridSize); // all 0 = passable

  // Permanent building walls — stampRoad will never clear these
  const buildingWalls = new Set<string>();

  // ── Generate main roads ────────────────────────────────────────────────
  const mainRoads = generateRoads(streetPattern, mid, radiusTiles, gridSize, roadRng);

  // Main road set — only main tiles are valid A* targets (prevents disconnected networks)
  const mainRoadSet = new Set<string>();
  for (const r of mainRoads) {
    if (r.main) mainRoadSet.add(`${r.tx},${r.ty}`);
  }
  if (mainRoadSet.size === 0) {
    mainRoadSet.add(`${mid},${mid}`);
  }

  // Full path set — ALL road tiles (main + secondary) used for placement avoidance
  const allPathSet = new Set<string>();
  for (const r of mainRoads) {
    allPathSet.add(`${r.tx},${r.ty}`);
  }
  for (const k of mainRoadSet) allPathSet.add(k);

  const placed: Array<{ tx: number; ty: number; size: number }> = [];
  const result: PlacedBuilding[] = [];
  const connectorPaths: RoadTile[] = [];

  // PHASE 1: Place ALL buildings first (no path connections yet) ───────────────────────────────
  for (const building of buildings) {
    const frac = zoneFracs[building.zone] ?? zoneFracs['middle'] ?? { min: 0.38, max: 0.65 };
    // building.w is already in iso block units (from the registry)
    const widthT = Math.max(1, building.w);
    const depthT = widthT;
    const half = Math.ceil(widthT / 2);

    // ── Place ─────────────────────────────────────────────────────────────
    let placedTx = mid;
    let placedTy = mid;
    let success = false;
    let wasFallback = false;

    for (let attempt = 0; attempt < 120; attempt++) {
      const angle = rng() * Math.PI * 2;
      const zonePad = attempt > 60 ? 0.15 : 0;
      const minR = Math.max(0, frac.min - zonePad);
      const maxR = Math.min(1.0, frac.max + zonePad);
      const dist = radiusTiles * (minR + rng() * (maxR - minR));
      const tx = Math.round(mid + Math.cos(angle) * dist);
      const ty = Math.round(mid + Math.sin(angle) * dist);

      if (tx - half < 0 || ty - half < 0 || tx + half >= gridSize || ty + half >= gridSize) continue;

      // Don't overlap any road or path tile
      let hitsPath = false;
      for (let dx = -half; dx <= half && !hitsPath; dx++) {
        for (let dy = -half; dy <= half && !hitsPath; dy++) {
          if (allPathSet.has(`${tx + dx},${ty + dy}`)) hitsPath = true;
        }
      }
      if (hitsPath) continue;

      // Don't overlap other buildings
      if (placed.some(p => rectsOverlap(tx, ty, widthT, p.tx, p.ty, p.size, 1.0))) continue;

      placedTx = tx; placedTy = ty; success = true;
      break;
    }

    if (!success) {
      // Spiral fallback — same checks as primary placement
      const baseAngle = rng() * Math.PI * 2;
      const baseDist = radiusTiles * (frac.min + frac.max) / 2;
      for (let ring = 0; ring < 20 && !success; ring++) {
        for (let step = 0; step < 24; step++) {
          const a = baseAngle + (step / 16) * Math.PI * 2;
          const d = baseDist + ring * 1.5;
          const tx = Math.round(mid + Math.cos(a) * d);
          const ty = Math.round(mid + Math.sin(a) * d);
          if (tx - half < 0 || ty - half < 0 || tx + half >= gridSize || ty + half >= gridSize) continue;
          // Check roads/paths
          let hitsPath = false;
          for (let ddx = -half; ddx <= half && !hitsPath; ddx++) {
            for (let ddy = -half; ddy <= half && !hitsPath; ddy++) {
              if (allPathSet.has(`${tx + ddx},${ty + ddy}`)) hitsPath = true;
            }
          }
          if (hitsPath) continue;
          // Check other buildings
          if (placed.some(p => rectsOverlap(tx, ty, widthT, p.tx, p.ty, p.size, 1.0))) continue;
          placedTx = tx; placedTy = ty; success = true; wasFallback = true;
          break;
        }
      }
    }

    // Skip building if placement completely failed
    if (!success) {
      console.warn(`[place] DROPPED ${building.id} w=${widthT} — no valid position found`);
      continue;
    }

    // Verify: does this building overlap any road tile?
    let roadOverlap = false;
    for (let dx = -half; dx <= half; dx++) {
      for (let dy = -half; dy <= half; dy++) {
        if (allPathSet.has(`${placedTx + dx},${placedTy + dy}`)) {
          roadOverlap = true;
        }
      }
    }
    if (roadOverlap) {
      console.error(`[place] BUG: ${building.id} #${result.length + 1} at (${placedTx},${placedTy}) w=${widthT} OVERLAPS road tiles! fallback=${wasFallback}`);
    }

    // Stamp building as wall on the grid
    placed.push({ tx: placedTx, ty: placedTy, size: widthT });
    const placedEntry: PlacedBuilding = { tx: placedTx, ty: placedTy, widthT, depthT, building, fallback: wasFallback };
    result.push(placedEntry);
    stampBuilding(grid, gridSize, placedTx, placedTy, half);
    for (let dx = -half; dx <= half; dx++) {
      for (let dy = -half; dy <= half; dy++) {
        buildingWalls.add(`${placedTx + dx},${placedTy + dy}`);
      }
    }
  }

  // PHASE 2: Connect each building to the nearest main road via A*.
  // All buildings are stamped as walls, so paths route around them.
  for (const placedEntry of result) {
    const half = Math.ceil(placedEntry.widthT / 2);
    const placedTx = placedEntry.tx;
    const placedTy = placedEntry.ty;

    // Tag each entrance with its outward cardinal direction
    const entrances: Array<{ tx: number; ty: number; odx: number; ody: number }> = [];
    for (let dx = -half; dx <= half; dx++)
      entrances.push({ tx: placedTx + dx, ty: placedTy - half - 1, odx: 0, ody: -1 }); // North
    for (let dx = -half; dx <= half; dx++)
      entrances.push({ tx: placedTx + dx, ty: placedTy + half + 1, odx: 0, ody: 1 });  // South
    for (let dy = -half; dy <= half; dy++)
      entrances.push({ tx: placedTx - half - 1, ty: placedTy + dy, odx: -1, ody: 0 }); // West
    for (let dy = -half; dy <= half; dy++)
      entrances.push({ tx: placedTx + half + 1, ty: placedTy + dy, odx: 1, ody: 0 });  // East

    // Filter: in-bounds, passable, and 3 tiles ahead (outward) are clear of
    // building walls — so the entrance doesn't face into another building.
    const validEntrances = entrances.filter(e => {
      if (e.tx < 0 || e.ty < 0 || e.tx >= gridSize || e.ty >= gridSize) return false;
      if (grid[e.ty * gridSize + e.tx] !== 0) return false;

      for (let step = 1; step <= 3; step++) {
        const cx = e.tx + e.odx * step;
        const cy = e.ty + e.ody * step;
        if (cx < 0 || cy < 0 || cx >= gridSize || cy >= gridSize) break;
        if (buildingWalls.has(`${cx},${cy}`)) return false;
      }
      return true;
    });

    // Find entrance closest to any MAIN road tile
    let bestEntrance: { tx: number; ty: number } | null = null;
    let bestDist = Infinity;
    for (const e of validEntrances) {
      for (const rk of mainRoadSet) {
        const [rx, ry] = rk.split(',').map(Number);
        const d = Math.abs(e.tx - rx) + Math.abs(e.ty - ry);
        if (d < bestDist) { bestDist = d; bestEntrance = e; }
      }
    }

    // If no clear entrance, fall back to any passable in-bounds entrance
    if (!bestEntrance) {
      const anyPassable = entrances.find(e =>
        e.tx >= 0 && e.ty >= 0 && e.tx < gridSize && e.ty < gridSize &&
        grid[e.ty * gridSize + e.tx] === 0);
      if (anyPassable) {
        bestEntrance = anyPassable;
      } else {
        // Force one open
        const anyInBounds = entrances.find(e =>
          e.tx >= 0 && e.ty >= 0 && e.tx < gridSize && e.ty < gridSize);
        if (anyInBounds) {
          grid[anyInBounds.ty * gridSize + anyInBounds.tx] = 0;
          bestEntrance = anyInBounds;
        }
      }
    }

    if (!bestEntrance) continue;

    // Tag the building with its entrance position and side
    placedEntry.entranceTx = bestEntrance.tx;
    placedEntry.entranceTy = bestEntrance.ty;
    const edx = bestEntrance.tx - placedTx;
    const edy = bestEntrance.ty - placedTy;
    if (Math.abs(edy) > Math.abs(edx)) {
      placedEntry.entranceSide = edy < 0 ? 'n' : 's';
    } else {
      placedEntry.entranceSide = edx < 0 ? 'w' : 'e';
    }

    // Find nearest MAIN road tile as A* goal
    let goalTx = mid;
    let goalTy = mid;
    let goalDist = Infinity;
    for (const rk of mainRoadSet) {
      const [rx, ry] = rk.split(',').map(Number);
      const d = Math.abs(bestEntrance.tx - rx) + Math.abs(bestEntrance.ty - ry);
      if (d < goalDist) { goalDist = d; goalTx = rx; goalTy = ry; }
    }

    // Already on a main road
    if (goalDist === 0) {
      allPathSet.add(`${bestEntrance.tx},${bestEntrance.ty}`);
      connectorPaths.push({ tx: bestEntrance.tx, ty: bestEntrance.ty, main: false });
      continue;
    }

    // A* from entrance to nearest main road tile
    const path = aStarPath(grid, gridSize, gridSize, bestEntrance.tx, bestEntrance.ty, goalTx, goalTy);

    if (path) {
      // Emit entrance tile
      connectorPaths.push({ tx: bestEntrance.tx, ty: bestEntrance.ty, main: false });
      allPathSet.add(`${bestEntrance.tx},${bestEntrance.ty}`);

      for (const wp of path) {
        connectorPaths.push({ tx: wp.x, ty: wp.y, main: false });
        allPathSet.add(`${wp.x},${wp.y}`);
        stampRoad(grid, gridSize, wp.x, wp.y, buildingWalls);
      }
    } else {
      // A* failed — straight line, skipping building walls
      let cx = bestEntrance.tx;
      let cy = bestEntrance.ty;
      for (let step = 0; step < 80; step++) {
        if (mainRoadSet.has(`${cx},${cy}`)) break;
        if (!buildingWalls.has(`${cx},${cy}`)) {
          connectorPaths.push({ tx: cx, ty: cy, main: false });
          allPathSet.add(`${cx},${cy}`);
          stampRoad(grid, gridSize, cx, cy, buildingWalls);
        }
        const dx = goalTx - cx;
        const dy = goalTy - cy;
        if (dx === 0 && dy === 0) break;
        if (Math.abs(dx) >= Math.abs(dy)) cx += dx > 0 ? 1 : -1;
        else cy += dy > 0 ? 1 : -1;
      }
    }
  }

  return {
    buildings: result,
    roads: [
      ...mainRoads,
      ...(mainRoads.length === 0 ? [{ tx: mid, ty: mid, main: false as const }] : []),
      ...connectorPaths,
    ],
  };
}
