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

  // If no roads at all, seed with the settlement centre tile.
  // This gives A* a reachable target for every building.
  if (connected.size === 0) {
    const mid = Math.floor(gridSize / 2);
    connected.add(tileKey(mid, mid));
    paths.push({ tx: mid, ty: mid, main: false });
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

    // Already adjacent to connected network — just mark the edge tile
    if (bestDist <= 1) {
      const k = tileKey(bestStart.tx, bestStart.ty);
      if (!connected.has(k)) {
        connected.add(k);
        paths.push({ tx: bestStart.tx, ty: bestStart.ty, main: false });
      }
      continue;
    }

    // A* from bestStart to nearest connected tile, then add wobble
    let rawPath = astarToConnected(bestStart.tx, bestStart.ty, connected, occupied, gridSize);

    // If A* failed (blocked by buildings), retry without obstacle avoidance
    if (rawPath.length === 0) {
      rawPath = astarToConnected(bestStart.tx, bestStart.ty, connected, new Set(), gridSize);
    }

    // Last resort: straight-line walk ignoring everything
    if (rawPath.length === 0) {
      rawPath = straightLineToConnected(bestStart.tx, bestStart.ty, connected, gridSize);
    }

    const wobbly = wobblePath(rawPath, occupied, connected, gridSize, rng);
    for (const p of wobbly) {
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
  for (let r = 1; r <= 40; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > r) continue;
        if (connected.has(tileKey(tx + dx, ty + dy))) return r;
      }
    }
  }
  return 999;
}

// ── A* pathfinding ───────────────────────────────────────────────────────────

interface AStarNode {
  tx: number;
  ty: number;
  g: number;       // cost from start
  f: number;       // g + heuristic
  parent: AStarNode | null;
}

/**
 * A* pathfinding from (sx,sy) to the nearest tile in the connected set.
 * Avoids occupied tiles (building footprints) unless they're in the
 * connected set (roads through buildings are OK).
 *
 * Returns the path as RoadTile[] or empty array if unreachable.
 */
function astarToConnected(
  sx: number, sy: number,
  connected: TileSet,
  occupied: Set<string>,
  gridSize: number,
): RoadTile[] {
  // Find the nearest connected tile as heuristic target
  let targetX = sx;
  let targetY = sy;
  let bestDist = Infinity;
  for (let r = 1; r <= 50; r++) {
    let found = false;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > r) continue;
        if (connected.has(tileKey(sx + dx, sy + dy))) {
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; targetX = sx + dx; targetY = sy + dy; found = true; }
        }
      }
    }
    if (found) break;
  }
  if (bestDist === Infinity) return []; // no connected tile reachable

  const heuristic = (tx: number, ty: number) =>
    Math.abs(tx - targetX) + Math.abs(ty - targetY);

  const start: AStarNode = { tx: sx, ty: sy, g: 0, f: heuristic(sx, sy), parent: null };

  // Open set as a simple sorted array (settlement grids are small, <50x50)
  const open: AStarNode[] = [start];
  const closed = new Set<string>();

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const MAX_ITER = 2000; // safety limit

  for (let iter = 0; iter < MAX_ITER && open.length > 0; iter++) {
    // Pop node with lowest f
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open[bestIdx];
    open.splice(bestIdx, 1);

    const ck = tileKey(current.tx, current.ty);
    if (closed.has(ck)) continue;
    closed.add(ck);

    // Goal: reached a connected tile
    if (connected.has(ck)) {
      // Reconstruct path
      const path: RoadTile[] = [];
      let node: AStarNode | null = current;
      while (node) {
        path.push({ tx: node.tx, ty: node.ty, main: false });
        node = node.parent;
      }
      path.reverse();
      return path;
    }

    // Expand neighbours
    for (const [ddx, ddy] of DIRS) {
      const nx = current.tx + ddx;
      const ny = current.ty + ddy;
      if (nx < 0 || ny < 0 || nx >= gridSize || ny >= gridSize) continue;

      const nk = tileKey(nx, ny);
      if (closed.has(nk)) continue;

      // Can traverse connected tiles (roads) even if "occupied"
      if (occupied.has(nk) && !connected.has(nk)) continue;

      const g = current.g + 1;
      const f = g + heuristic(nx, ny);
      open.push({ tx: nx, ty: ny, g, f, parent: current });
    }
  }

  return []; // no path found
}

/**
 * Straight-line walk from (sx,sy) toward the nearest connected tile.
 * Ignores all obstacles — used as last resort when A* can't find a path.
 */
function straightLineToConnected(
  sx: number, sy: number,
  connected: TileSet,
  gridSize: number,
): RoadTile[] {
  // Find target
  let targetX = sx;
  let targetY = sy;
  let bestDist = Infinity;
  for (let r = 1; r <= 50; r++) {
    let found = false;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) + Math.abs(dy) > r) continue;
        if (connected.has(tileKey(sx + dx, sy + dy))) {
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; targetX = sx + dx; targetY = sy + dy; found = true; }
        }
      }
    }
    if (found) break;
  }

  const path: RoadTile[] = [];
  let cx = sx;
  let cy = sy;
  for (let i = 0; i < 80; i++) {
    if (cx === targetX && cy === targetY) break;
    path.push({ tx: cx, ty: cy, main: false });
    const dx = targetX - cx;
    const dy = targetY - cy;
    if (Math.abs(dx) >= Math.abs(dy)) {
      cx += dx > 0 ? 1 : -1;
    } else {
      cy += dy > 0 ? 1 : -1;
    }
    if (cx < 0 || cy < 0 || cx >= gridSize || cy >= gridSize) break;
  }
  path.push({ tx: targetX, ty: targetY, main: false });
  return path;
}

/**
 * Add wobble to an A* path so it looks foot-worn rather than computed.
 * For each interior point, 20% chance to jitter 1 tile perpendicular
 * (if the jittered tile is passable).
 */
function wobblePath(
  path: RoadTile[],
  occupied: Set<string>,
  connected: TileSet,
  gridSize: number,
  rng: () => number,
): RoadTile[] {
  if (path.length <= 2) return path;

  const result: RoadTile[] = [path[0]];

  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    const next = path[i + 1];

    if (rng() < 0.2) {
      // Direction of travel
      const dx = next.tx - prev.tx;
      const dy = next.ty - prev.ty;

      // Perpendicular offset
      let wx: number, wy: number;
      if (Math.abs(dx) >= Math.abs(dy)) {
        wx = curr.tx;
        wy = curr.ty + (rng() > 0.5 ? 1 : -1);
      } else {
        wx = curr.tx + (rng() > 0.5 ? 1 : -1);
        wy = curr.ty;
      }

      const wk = tileKey(wx, wy);
      if (wx >= 0 && wy >= 0 && wx < gridSize && wy < gridSize &&
          !occupied.has(wk) || connected.has(wk)) {
        result.push({ tx: wx, ty: wy, main: false });
      }
    }

    result.push(curr);
  }

  result.push(path[path.length - 1]);
  return result;
}
