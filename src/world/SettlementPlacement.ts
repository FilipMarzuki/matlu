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

export interface PlacedBuilding {
  tx: number;
  ty: number;
  widthT: number;
  depthT: number;
  building: ResolvedBuilding;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** AABB overlap check for building placement. */
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

/** Mark a tile as road (0 = passable) on the grid. */
function stampRoad(grid: Uint8Array, cols: number, tx: number, ty: number): void {
  if (tx >= 0 && ty >= 0 && tx < cols && ty < cols) {
    grid[ty * cols + tx] = 0;
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
  const { buildings, radiusTiles, gridSize, tileSize, seed, zoneFracs,
          streetPattern = 'none' } = input;
  const mid = Math.floor(gridSize / 2);
  const roadRng = mulberry32(seed + 7);
  const rng = mulberry32(seed + 13);

  // ── Flat grid: 0 = passable, 1 = wall ──────────────────────────────────
  const grid = new Uint8Array(gridSize * gridSize); // all 0 = passable

  // ── Generate main roads ────────────────────────────────────────────────
  const mainRoads = generateRoads(streetPattern, mid, radiusTiles, gridSize, roadRng);

  // Mark road tiles as passable (they already are 0, but track them)
  const roadSet = new Set<string>();
  for (const r of mainRoads) {
    roadSet.add(`${r.tx},${r.ty}`);
  }

  // If no main roads, seed with centre tile
  if (mainRoads.length === 0) {
    roadSet.add(`${mid},${mid}`);
  }

  const placed: Array<{ tx: number; ty: number; size: number }> = [];
  const result: PlacedBuilding[] = [];
  const connectorPaths: RoadTile[] = [];

  // ── Place each building, then connect it ───────────────────────────────
  for (const building of buildings) {
    const frac = zoneFracs[building.zone] ?? zoneFracs['middle'] ?? { min: 0.38, max: 0.65 };
    const widthT = Math.max(1, Math.round(building.w / tileSize));
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

      // Don't overlap main roads
      let hitsRoad = false;
      for (let dx = -half; dx <= half && !hitsRoad; dx++) {
        for (let dy = -half; dy <= half && !hitsRoad; dy++) {
          if (roadSet.has(`${tx + dx},${ty + dy}`)) hitsRoad = true;
        }
      }
      if (hitsRoad) continue;

      // Don't overlap other buildings
      if (placed.some(p => rectsOverlap(tx, ty, widthT, p.tx, p.ty, p.size, 1.0))) continue;

      placedTx = tx; placedTy = ty; success = true;
      break;
    }

    if (!success) {
      // Spiral fallback
      const baseAngle = rng() * Math.PI * 2;
      const baseDist = radiusTiles * (frac.min + frac.max) / 2;
      for (let ring = 0; ring < 10 && !success; ring++) {
        for (let step = 0; step < 16; step++) {
          const a = baseAngle + (step / 16) * Math.PI * 2;
          const d = baseDist + ring * 1.5;
          const tx = Math.round(mid + Math.cos(a) * d);
          const ty = Math.round(mid + Math.sin(a) * d);
          if (tx - half < 0 || ty - half < 0 || tx + half >= gridSize || ty + half >= gridSize) continue;
          if (!placed.some(p => rectsOverlap(tx, ty, widthT, p.tx, p.ty, p.size, 1.0))) {
            placedTx = tx; placedTy = ty; success = true; wasFallback = true;
            break;
          }
        }
      }
    }

    // Stamp building as wall on the grid
    placed.push({ tx: placedTx, ty: placedTy, size: widthT });
    result.push({ tx: placedTx, ty: placedTy, widthT, depthT, building, fallback: wasFallback });
    stampBuilding(grid, gridSize, placedTx, placedTy, half);

    // ── Connect: walk from entrance to nearest road ───────────────────────
    // Pick entrance: try each cardinal side, pick the one closest to a road
    const entrances = [
      { tx: placedTx, ty: placedTy - half - 1 }, // North
      { tx: placedTx, ty: placedTy + half + 1 }, // South
      { tx: placedTx - half - 1, ty: placedTy }, // West
      { tx: placedTx + half + 1, ty: placedTy }, // East
    ].filter(e => e.tx >= 0 && e.ty >= 0 && e.tx < gridSize && e.ty < gridSize);

    // Find entrance closest to any road/path tile
    let bestEntrance = entrances[0];
    let bestDist = Infinity;
    for (const e of entrances) {
      if (grid[e.ty * gridSize + e.tx] === 1) continue; // blocked by another building
      for (const rk of roadSet) {
        const [rx, ry] = rk.split(',').map(Number);
        const d = Math.abs(e.tx - rx) + Math.abs(e.ty - ry);
        if (d < bestDist) { bestDist = d; bestEntrance = e; }
      }
    }

    if (!bestEntrance) continue;

    // Entrance tile must be passable
    grid[bestEntrance.ty * gridSize + bestEntrance.tx] = 0;

    // Find nearest road tile as A* target
    let goalTx = mid;
    let goalTy = mid;
    let goalDist = Infinity;
    for (const rk of roadSet) {
      const [rx, ry] = rk.split(',').map(Number);
      const d = Math.abs(bestEntrance.tx - rx) + Math.abs(bestEntrance.ty - ry);
      if (d < goalDist) { goalDist = d; goalTx = rx; goalTy = ry; }
    }

    // Already on a road
    if (goalDist === 0) {
      roadSet.add(`${bestEntrance.tx},${bestEntrance.ty}`);
      connectorPaths.push({ tx: bestEntrance.tx, ty: bestEntrance.ty, main: false });
      continue;
    }

    // A* from entrance to nearest road tile
    const path = aStarPath(grid, gridSize, gridSize, bestEntrance.tx, bestEntrance.ty, goalTx, goalTy);

    if (path) {
      // Emit entrance tile
      connectorPaths.push({ tx: bestEntrance.tx, ty: bestEntrance.ty, main: false });
      roadSet.add(`${bestEntrance.tx},${bestEntrance.ty}`);

      // Emit each path tile, mark as road so future buildings can connect to it
      for (const wp of path) {
        connectorPaths.push({ tx: wp.x, ty: wp.y, main: false });
        roadSet.add(`${wp.x},${wp.y}`);
        // Keep path passable on grid
        stampRoad(grid, gridSize, wp.x, wp.y);
      }
    } else {
      // A* failed (fully blocked) — force straight line
      let cx = bestEntrance.tx;
      let cy = bestEntrance.ty;
      for (let step = 0; step < 60; step++) {
        if (roadSet.has(`${cx},${cy}`)) break;
        connectorPaths.push({ tx: cx, ty: cy, main: false });
        roadSet.add(`${cx},${cy}`);
        stampRoad(grid, gridSize, cx, cy);
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
