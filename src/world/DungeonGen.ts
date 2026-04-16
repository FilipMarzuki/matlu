/**
 * DungeonGen — procedural dungeon and underground map generator.
 *
 * ## Algorithm overview
 *
 * 1. Room Placement: scatter non-overlapping rooms across the dungeon bounds.
 * 2. Delaunay Triangulation (Bowyer-Watson): triangulate all room centres to
 *    discover the rich set of potential corridor connections.
 * 3. MST (Kruskal's + union-find): the minimum set of corridors that connects
 *    every room — no isolated rooms, no redundant links.
 * 4. Loop Edges: re-add ~15% of non-MST Delaunay edges to create shortcuts
 *    and dead-end alternatives that make exploration interesting.
 * 5. Corridor Carving: L-shaped corridors, 2 tiles wide (2-pixel brush).
 * 6. Cellular Automata: 3 passes of noise-driven wall roughening.
 * 7. Game System Layering: corruption, mana, spawn / entry / exit points.
 *
 * ## Tile values
 *   0 = floor (passable)
 *   1 = wall  (solid)
 *
 * The grid is initialised as all walls; rooms and corridors are carved to
 * floor. The CA pass then roughens wall *edges* — it only ever flips wall
 * tiles to floor, never the other way around, so rooms stay clean.
 *
 * ## Design principle
 * The generator is pure TypeScript with no Phaser dependency. It operates on
 * plain arrays and can be unit-tested without a running scene. The output
 * IntGridLayer slots directly into the existing tile-rendering pipeline.
 */

import { IntGridLayer } from './MapData';
import { mulberry32 } from '../lib/rng';
import { FbmNoise } from '../lib/noise';

// ─── Public types ──────────────────────────────────────────────────────────────

/**
 * A simple 2D point (tile coordinates or world-pixel coordinates).
 * Structurally compatible with Phaser.Math.Vector2, but carries no Phaser dep.
 */
export interface Vec2 {
  x: number;
  y: number;
}

/** A placed room and its generated metadata. */
export interface Room {
  /** Top-left column in tile coords. */
  col: number;
  /** Top-left row in tile coords. */
  row: number;
  /** Room width in tiles. */
  w: number;
  /** Room height in tiles. */
  h: number;
  /** Horizontal centre in tile coords (col + w / 2). */
  cx: number;
  /** Vertical centre in tile coords (row + h / 2). */
  cy: number;
  /**
   * Corruption intensity in [0, 1], assigned at generation time.
   * High in 'corrupted' dungeons, low in 'ruins'.
   */
  corruptionLevel: number;
  /**
   * Mana field intensity in [0, 1].
   * Ruins rooms accumulate arcane residue (high mana); corrupted rooms deplete
   * it (low mana). Cave rooms are moderate.
   *
   * TODO: wire up to ManaField API once FIL-179 is implemented.
   * For now this is a plain scalar on the Room struct.
   */
  manaLevel: number;
}

/** Parameters that control dungeon generation. */
export interface DungeonConfig {
  /** Total dungeon width in tiles. */
  cols: number;
  /** Total dungeon height in tiles. */
  rows: number;
  /** Pixel size of each tile, passed through to IntGridLayer. */
  cellSize: number;
  /** Minimum rooms to place. */
  minRooms: number;
  /** Maximum rooms to place. */
  maxRooms: number;
  /** Minimum room width in tiles. */
  minRoomW: number;
  /** Maximum room width in tiles. */
  maxRoomW: number;
  /** Minimum room height in tiles. */
  minRoomH: number;
  /** Maximum room height in tiles. */
  maxRoomH: number;
  /**
   * Minimum empty-tile gap between any two room rectangles.
   * Prevents corridors from merging adjacent rooms into one large space.
   * Default: 2.
   */
  minRoomGap: number;
  /**
   * How many tiles wide each carved corridor is.
   * 2 is the recommended minimum for combat viability.
   */
  corridorWidth: number;
  /**
   * Fraction of non-MST Delaunay edges to re-add as loop corridors.
   * 0.15 adds useful shortcuts without trivialising navigation.
   */
  loopFactor: number;
  /**
   * Dungeon archetype — influences thematic corruption / mana distribution.
   * 'cave'      — organic tunnels, moderate corruption and mana
   * 'ruins'     — structured rooms, high arcane mana, low corruption
   * 'corrupted' — irregular, high corruption, suppressed mana
   */
  type: 'cave' | 'ruins' | 'corrupted';
}

/** The complete output of generateDungeon(). */
export interface DungeonLayout {
  /**
   * Tile grid: 0 = floor, 1 = wall.
   * Matches IntGridLayer — pass directly to the tile-rendering pipeline.
   */
  tiles: IntGridLayer;
  /** All placed rooms with their thematic metadata. */
  rooms: Room[];
  /** One world-pixel spawn point per room, at each room's centre. */
  spawnPoints: Vec2[];
  /** World-pixel entry point — centre of the first placed room. */
  entryPoint: Vec2;
  /** World-pixel exit point — centre of the room farthest from entry. */
  exitPoint: Vec2;
}

// ─── Preset configurations ────────────────────────────────────────────────────

/**
 * Cave dungeon: organic tunnels, moderate size.
 * Good default for underground exploration without strong thematic flavour.
 */
export const CAVE_CONFIG: DungeonConfig = {
  cols: 64, rows: 64, cellSize: 16,
  minRooms: 8,  maxRooms: 14,
  minRoomW: 5,  maxRoomW: 12,
  minRoomH: 5,  maxRoomH: 10,
  minRoomGap: 2, corridorWidth: 2, loopFactor: 0.15,
  type: 'cave',
};

/**
 * Ruins dungeon: larger structured rooms, rich arcane mana, light corruption.
 * More loops create the feel of a complex explored by many before the player.
 */
export const RUINS_CONFIG: DungeonConfig = {
  cols: 80, rows: 80, cellSize: 16,
  minRooms: 10, maxRooms: 18,
  minRoomW: 6,  maxRoomW: 16,
  minRoomH: 6,  maxRoomH: 14,
  minRoomGap: 2, corridorWidth: 2, loopFactor: 0.20,
  type: 'ruins',
};

/**
 * Corrupted dungeon: smaller irregular rooms, heavy corruption, depleted mana.
 * Fewer loops keep the layout claustrophobic and oppressive.
 */
export const CORRUPTED_CONFIG: DungeonConfig = {
  cols: 72, rows: 72, cellSize: 16,
  minRooms: 6,  maxRooms: 12,
  minRoomW: 4,  maxRoomW: 10,
  minRoomH: 4,  maxRoomH: 9,
  minRoomGap: 2, corridorWidth: 2, loopFactor: 0.10,
  type: 'corrupted',
};

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** Write a tile value; silently ignores out-of-bounds coordinates. */
function setTile(
  values: number[],
  cols: number,
  rows: number,
  col: number,
  row: number,
  value: number,
): void {
  if (col < 0 || row < 0 || col >= cols || row >= rows) return;
  values[row * cols + col] = value;
}

/** Read a tile value; returns 1 (wall) for out-of-bounds. */
function getTile(values: number[], cols: number, rows: number, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= cols || row >= rows) return 1;
  return values[row * cols + col] ?? 1;
}

/**
 * True if rooms A and B are closer than `gap` tiles apart on any axis.
 * Uses an AABB test with the gap inflated into the check, so a gap of 2
 * requires at least 2 empty tiles between any two room walls.
 */
function roomsConflict(a: Room, b: Room, gap: number): boolean {
  return (
    a.col + a.w + gap > b.col &&
    b.col + b.w + gap > a.col &&
    a.row + a.h + gap > b.row &&
    b.row + b.h + gap > a.row
  );
}

/** Squared Euclidean distance between two room tile-centres. */
function roomDist2(a: Room, b: Room): number {
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  return dx * dx + dy * dy;
}

// ─── Step 1: Room placement ────────────────────────────────────────────────────

/**
 * Scatter rooms across the dungeon, retrying up to MAX_ATTEMPTS times per slot.
 * Rooms that cannot be placed after all attempts are silently skipped — this can
 * happen in very small configs or when maxRooms is high relative to dungeon size.
 */
function placeRooms(rng: () => number, config: DungeonConfig): Room[] {
  const {
    cols, rows,
    minRooms, maxRooms,
    minRoomW, maxRoomW,
    minRoomH, maxRoomH,
    minRoomGap,
  } = config;

  const target = minRooms + Math.floor(rng() * (maxRooms - minRooms + 1));
  const rooms: Room[] = [];
  const MAX_ATTEMPTS = 200;

  for (let i = 0; i < target; i++) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const w   = minRoomW + Math.floor(rng() * (maxRoomW - minRoomW + 1));
      const h   = minRoomH + Math.floor(rng() * (maxRoomH - minRoomH + 1));
      // Keep rooms at least 1 tile inside the dungeon border.
      const col = 1 + Math.floor(rng() * Math.max(1, cols - w - 2));
      const row = 1 + Math.floor(rng() * Math.max(1, rows - h - 2));

      const candidate: Room = {
        col, row, w, h,
        cx: col + w / 2,
        cy: row + h / 2,
        corruptionLevel: 0,
        manaLevel: 0,
      };

      if (!rooms.some(r => roomsConflict(r, candidate, minRoomGap))) {
        rooms.push(candidate);
        break;
      }
    }
  }

  return rooms;
}

// ─── Step 2: Delaunay triangulation (Bowyer-Watson) ────────────────────────────

/** Undirected edge between two room indices (a ≤ b). */
interface DungeonEdge {
  a: number;
  b: number;
}

/** Triangle used internally during Bowyer-Watson. */
interface DelaunayTriangle {
  a: number;
  b: number;
  c: number;
}

/**
 * Returns true if point (px, py) lies strictly inside the circumcircle of the
 * triangle whose vertices are pts[tri.a], pts[tri.b], pts[tri.c].
 *
 * Uses the standard 3×3 determinant test. det > 0 when the triangle vertices
 * are in CCW order — the super-triangle in delaunayEdges() is constructed CCW,
 * so triangulations derived from it maintain consistent orientation.
 */
function inCircumcircle(
  pts: Array<{ cx: number; cy: number }>,
  tri: DelaunayTriangle,
  px: number,
  py: number,
): boolean {
  const ax = pts[tri.a].cx - px;
  const ay = pts[tri.a].cy - py;
  const bx = pts[tri.b].cx - px;
  const by = pts[tri.b].cy - py;
  const cx = pts[tri.c].cx - px;
  const cy = pts[tri.c].cy - py;

  // Expand the 3×3 determinant along the third column.
  const det =
    ax * (by * (cx * cx + cy * cy) - cy * (bx * bx + by * by)) -
    ay * (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) +
    (ax * ax + ay * ay) * (bx * cy - by * cx);

  return det > 0;
}

/** True if triangle tri shares the edge (ea, eb). */
function triHasEdge(tri: DelaunayTriangle, ea: number, eb: number): boolean {
  const v = [tri.a, tri.b, tri.c];
  return v.includes(ea) && v.includes(eb);
}

/**
 * Bowyer-Watson Delaunay triangulation of room centres.
 *
 * Returns all unique undirected Delaunay edges (as room-index pairs, a ≤ b).
 * The triangulation guarantees that for any triangle, no other room centre
 * lies inside its circumcircle — this maximises minimum angles, giving us
 * connections to "nearby" rooms rather than distant ones.
 *
 * Implementation: we maintain a super-triangle that encloses all points, then
 * incrementally insert each room centre, remove bad triangles (whose circumcircle
 * contains the new point), and re-fill the hole. At the end we discard any
 * triangle that shares a vertex with the super-triangle.
 *
 * The algorithm is ~O(n²) in the worst case for n ≤ 18 rooms, which is fast
 * enough in practice. A no-extra-npm-dependency decision was made deliberately.
 */
function delaunayEdges(rooms: Room[]): DungeonEdge[] {
  const n = rooms.length;
  if (n < 2) return [];
  if (n === 2) return [{ a: 0, b: 1 }];

  // Working point list: room centres + super-triangle vertices.
  type Pt = { cx: number; cy: number };
  const pts: Pt[] = rooms.map(r => ({ cx: r.cx, cy: r.cy }));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rooms) {
    if (r.cx < minX) minX = r.cx;
    if (r.cy < minY) minY = r.cy;
    if (r.cx > maxX) maxX = r.cx;
    if (r.cy > maxY) maxY = r.cy;
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  // Super-triangle: large enough to contain all room centres; vertices in CCW order
  // so the circumcircle determinant sign is consistent throughout the algorithm.
  const sA = n;
  const sB = n + 1;
  const sC = n + 2;
  pts.push(
    { cx: midX - 20 * span, cy: midY - span },      // far left
    { cx: midX,             cy: midY + 20 * span },  // far top
    { cx: midX + 20 * span, cy: midY - span },       // far right
  );

  let triangles: DelaunayTriangle[] = [{ a: sA, b: sB, c: sC }];

  for (let pi = 0; pi < n; pi++) {
    const px = pts[pi].cx;
    const py = pts[pi].cy;

    // Partition triangles into bad (circumcircle contains the new point) and good.
    const bad: DelaunayTriangle[] = [];
    const good: DelaunayTriangle[] = [];
    for (const tri of triangles) {
      if (inCircumcircle(pts, tri, px, py)) bad.push(tri);
      else good.push(tri);
    }

    // Boundary edges of the polygonal hole left by removing bad triangles.
    // An edge belongs to the boundary if it appears in exactly one bad triangle
    // (shared edges are interior and must be removed entirely).
    const boundary: Array<[number, number]> = [];
    for (const tri of bad) {
      const triEdgeList: Array<[number, number]> = [
        [tri.a, tri.b], [tri.b, tri.c], [tri.c, tri.a],
      ];
      for (const [ea, eb] of triEdgeList) {
        const isShared = bad.some(other => other !== tri && triHasEdge(other, ea, eb));
        if (!isShared) boundary.push([ea, eb]);
      }
    }

    // Re-fill the hole by connecting each boundary edge to the new point.
    for (const [ea, eb] of boundary) {
      good.push({ a: ea, b: eb, c: pi });
    }

    triangles = good;
  }

  // Collect unique edges, discarding any triangle connected to the super-triangle.
  const seen = new Set<string>();
  const result: DungeonEdge[] = [];

  for (const tri of triangles) {
    if (tri.a >= n || tri.b >= n || tri.c >= n) continue; // discard super-triangle connected

    const triEdgeList: Array<[number, number]> = [
      [tri.a, tri.b], [tri.b, tri.c], [tri.c, tri.a],
    ];
    for (const [ea, eb] of triEdgeList) {
      const key = `${Math.min(ea, eb)},${Math.max(ea, eb)}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ a: Math.min(ea, eb), b: Math.max(ea, eb) });
      }
    }
  }

  return result;
}

// ─── Steps 3 & 4: MST + loop edges ────────────────────────────────────────────

/**
 * Kruskal's MST with path-compressed union-find.
 *
 * Sorts the Delaunay edges by distance and greedily adds the shortest edges
 * that don't create a cycle. This produces the minimum corridor network needed
 * to connect all rooms — no isolated rooms, minimum total tunnel length.
 */
function buildMST(n: number, edges: DungeonEdge[], rooms: Room[]): DungeonEdge[] {
  const sorted = [...edges].sort(
    (a, b) => roomDist2(rooms[a.a], rooms[a.b]) - roomDist2(rooms[b.a], rooms[b.b]),
  );

  const parent = Array.from({ length: n }, (_, i) => i);
  const rank   = new Array<number>(n).fill(0);

  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(x: number, y: number): boolean {
    const px = find(x);
    const py = find(y);
    if (px === py) return false;
    if      (rank[px] < rank[py]) parent[px] = py;
    else if (rank[px] > rank[py]) parent[py] = px;
    else { parent[py] = px; rank[px]++; }
    return true;
  }

  const mst: DungeonEdge[] = [];
  for (const e of sorted) {
    if (union(e.a, e.b)) {
      mst.push(e);
      if (mst.length === n - 1) break;
    }
  }
  return mst;
}

/**
 * Re-add a fraction of the non-MST Delaunay edges to create loops and shortcuts.
 *
 * Pure MST dungeons have exactly one path between any two rooms — every corridor
 * is a critical path. Re-adding ~15% of discarded Delaunay edges gives the player
 * alternate routes and prevents dead-end tunnels from feeling mandatory.
 */
function addLoopEdges(
  rng: () => number,
  mst: DungeonEdge[],
  all: DungeonEdge[],
  loopFactor: number,
): DungeonEdge[] {
  const mstKeys = new Set(mst.map(e => `${e.a},${e.b}`));
  const nonMst  = all.filter(e => !mstKeys.has(`${Math.min(e.a, e.b)},${Math.max(e.a, e.b)}`));

  // Fisher-Yates shuffle, then take the first `count` edges.
  for (let i = nonMst.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    // Swap without extra variable — safe because the array is number objects.
    const tmp = nonMst[i];
    nonMst[i] = nonMst[j];
    nonMst[j] = tmp;
  }

  const count = Math.round(nonMst.length * loopFactor);
  return [...mst, ...nonMst.slice(0, count)];
}

// ─── Step 5: Corridor carving ──────────────────────────────────────────────────

/**
 * Carve a horizontal strip from column x0 to x1 at base row y.
 * The strip is `width` tiles tall (rows y through y+width-1).
 */
function carveH(
  values: number[], cols: number, rows: number,
  x0: number, x1: number, y: number, width: number,
): void {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  for (let col = lo; col <= hi; col++) {
    for (let w = 0; w < width; w++) {
      setTile(values, cols, rows, col, y + w, 0);
    }
  }
}

/**
 * Carve a vertical strip from row y0 to y1 at base column x.
 * The strip is `width` tiles wide (columns x through x+width-1).
 */
function carveV(
  values: number[], cols: number, rows: number,
  x: number, y0: number, y1: number, width: number,
): void {
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  for (let row = lo; row <= hi; row++) {
    for (let w = 0; w < width; w++) {
      setTile(values, cols, rows, x + w, row, 0);
    }
  }
}

/**
 * Carve L-shaped or straight corridors between all connected room pairs.
 *
 * Each corridor is `corridorWidth` tiles wide (carved with a 2-pixel brush).
 * Randomly choosing horizontal-first vs. vertical-first gives layout variety —
 * both rooms' centres are always connected regardless of the chosen direction.
 */
function carveCorridors(
  rng: () => number,
  values: number[],
  cols: number,
  rows: number,
  rooms: Room[],
  connections: DungeonEdge[],
  corridorWidth: number,
): void {
  for (const edge of connections) {
    const ra = rooms[edge.a];
    const rb = rooms[edge.b];

    // Integer tile-centres keep the carved path clean.
    const ax = Math.floor(ra.cx);
    const ay = Math.floor(ra.cy);
    const bx = Math.floor(rb.cx);
    const by = Math.floor(rb.cy);

    if (rng() < 0.5) {
      // Horizontal first, then turn vertical.
      carveH(values, cols, rows, ax, bx, ay, corridorWidth);
      carveV(values, cols, rows, bx, ay, by, corridorWidth);
    } else {
      // Vertical first, then turn horizontal.
      carveV(values, cols, rows, ax, ay, by, corridorWidth);
      carveH(values, cols, rows, ax, bx, by, corridorWidth);
    }
  }
}

// ─── Step 6: Cellular automata ─────────────────────────────────────────────────

/**
 * One cellular-automata smoothing pass.
 *
 * We iterate over every wall tile (value 1). If the tile is on the boundary
 * between wall and floor (at least one of its 8 neighbours is floor) we sample
 * FbmNoise at that position. If the noise value exceeds `threshold`, the wall
 * tile is converted to floor, roughening the edge organically.
 *
 * ## Why operate only on wall tiles?
 * If we also considered flipping floor tiles to wall, we would gradually create
 * isolated wall islands inside rooms — the CA would eat the rooms from the inside
 * out. By only ever converting wall → floor, rooms stay open and only their
 * perimeter becomes irregular.
 *
 * Returns a new array (the input is not mutated) so we can chain passes cleanly.
 */
function caPass(
  grid: number[],
  cols: number,
  rows: number,
  noise: FbmNoise,
  scale: number,
  threshold: number,
): number[] {
  const next = grid.slice();
  for (let row = 1; row < rows - 1; row++) {
    for (let col = 1; col < cols - 1; col++) {
      if (getTile(grid, cols, rows, col, row) !== 1) continue; // skip floor tiles

      // Count floor neighbours (8-connected).
      let floorNeighbours = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (getTile(grid, cols, rows, col + dc, row + dr) === 0) floorNeighbours++;
        }
      }

      // Only process boundary walls — interior walls are left untouched.
      if (floorNeighbours === 0) continue;

      if (noise.sample(col * scale, row * scale) > threshold) {
        next[row * cols + col] = 0; // flip wall → floor
      }
    }
  }
  return next;
}

// ─── Step 7: Game system layering ─────────────────────────────────────────────

/**
 * Assign corruptionLevel and manaLevel to each room based on dungeon type.
 *
 * The assignments are driven by the seeded RNG so they are fully deterministic.
 * Thematic logic:
 *   cave      — moderate both; organic zones with natural mana and light corruption
 *   ruins     — ancient places rich in residual mana but not actively corrupted
 *   corrupted — heavy corruption actively suppresses the local mana field
 */
function assignRoomLevels(rng: () => number, rooms: Room[], type: DungeonConfig['type']): void {
  for (const room of rooms) {
    const r1 = rng();
    const r2 = rng();
    switch (type) {
      case 'cave':
        room.corruptionLevel = 0.20 + r1 * 0.40;  // 0.20 – 0.60
        room.manaLevel       = 0.30 + r2 * 0.40;  // 0.30 – 0.70
        break;
      case 'ruins':
        room.corruptionLevel = 0.00 + r1 * 0.30;  // 0.00 – 0.30
        room.manaLevel       = 0.60 + r2 * 0.40;  // 0.60 – 1.00
        break;
      case 'corrupted':
        room.corruptionLevel = 0.60 + r1 * 0.40;  // 0.60 – 1.00
        room.manaLevel       = 0.00 + r2 * 0.30;  // 0.00 – 0.30
        break;
    }
  }
}

// ─── BFS connectivity check ────────────────────────────────────────────────────

/**
 * BFS from room 0 across the carved connections.
 * Returns true if all rooms are reachable — validates that the MST was complete.
 * A disconnected dungeon (isolated rooms) would be a bug in the Delaunay/MST
 * pipeline and is checked here so callers get a deterministic, valid layout.
 */
export function allRoomsConnected(n: number, connections: DungeonEdge[]): boolean {
  if (n <= 1) return true;

  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const e of connections) {
    adj[e.a].push(e.b);
    adj[e.b].push(e.a);
  }

  const visited = new Set<number>([0]);
  const queue   = [0];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const nb of adj[cur]) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }

  return visited.size === n;
}

// ─── Main entry point ──────────────────────────────────────────────────────────

/**
 * Generate a complete procedural dungeon layout.
 *
 * ## Determinism
 * Given identical `seed` and `config`, generateDungeon() always returns the same
 * layout. All randomness flows from a single mulberry32 PRNG seeded at the start;
 * no Math.random() calls, no Date.now() side-channel.
 *
 * ## Tile encoding
 *   0 = floor (passable), 1 = wall (solid)
 *
 * ## Usage
 * ```ts
 * const layout = generateDungeon(12345, CAVE_CONFIG);
 * // layout.tiles slots directly into the existing IntGridLayer pipeline.
 * // layout.entryPoint is world-pixel coords of where to spawn the player.
 * ```
 *
 * @param seed    Integer seed. Same seed + config → same dungeon.
 * @param config  Dungeon parameters. Use a preset (CAVE_CONFIG, RUINS_CONFIG,
 *                CORRUPTED_CONFIG) or a custom DungeonConfig.
 */
export function generateDungeon(seed: number, config: DungeonConfig): DungeonLayout {
  const rng = mulberry32(seed);
  const { cols, rows, cellSize, corridorWidth, loopFactor } = config;

  // ── 1. Initialise grid — everything starts as wall ───────────────────────────
  const values = new Array<number>(cols * rows).fill(1);

  // ── 2. Place rooms and carve their interiors to floor ────────────────────────
  const rooms = placeRooms(rng, config);
  for (const room of rooms) {
    for (let r = room.row; r < room.row + room.h; r++) {
      for (let c = room.col; c < room.col + room.w; c++) {
        setTile(values, cols, rows, c, r, 0);
      }
    }
  }

  // ── 3. Delaunay triangulation of room centres ─────────────────────────────────
  const allEdges = delaunayEdges(rooms);

  // ── 4. MST + loop edges ───────────────────────────────────────────────────────
  const mst         = rooms.length >= 2 ? buildMST(rooms.length, allEdges, rooms) : [];
  const connections = addLoopEdges(rng, mst, allEdges, loopFactor);

  // ── 5. Carve corridors ────────────────────────────────────────────────────────
  carveCorridors(rng, values, cols, rows, rooms, connections, corridorWidth);

  // ── 6. Cellular automata — roughen wall edges ─────────────────────────────────
  // XOR the seed with a constant so the CA noise layer is independent of any
  // other noise (terrain, corruption) that may share the same base seed.
  // Pattern taken from CorruptionField.ts:36-38.
  const caNoise = new FbmNoise(seed ^ 0xca11dead);
  const CA_SCALE     = 0.18; // spatial frequency — tuned so roughening looks organic
  const CA_THRESHOLD = 0.74; // start conservative; lower each pass to widen slightly
  let grid = values;
  for (let pass = 0; pass < 3; pass++) {
    grid = caPass(grid, cols, rows, caNoise, CA_SCALE, CA_THRESHOLD - pass * 0.03);
  }

  // ── 7. Assign room-level game values ─────────────────────────────────────────
  assignRoomLevels(rng, rooms, config.type);

  // ── 8. Derive spawn / entry / exit points in world-pixel coordinates ──────────
  // One spawn point per room, at the room's pixel centre.
  const spawnPoints: Vec2[] = rooms.map(r => ({
    x: r.cx * cellSize,
    y: r.cy * cellSize,
  }));

  // Handle the degenerate case where no rooms could be placed.
  if (rooms.length === 0) {
    const centre: Vec2 = { x: (cols / 2) * cellSize, y: (rows / 2) * cellSize };
    const tiles: IntGridLayer = { identifier: 'DungeonCollision', cellSize, cols, rows, values: grid };
    return { tiles, rooms: [], spawnPoints: [], entryPoint: centre, exitPoint: centre };
  }

  // Entry: first placed room (index 0).
  const entryRoom  = rooms[0];
  const entryPoint: Vec2 = { x: entryRoom.cx * cellSize, y: entryRoom.cy * cellSize };

  // Exit: room farthest from the entry room.
  let exitRoom = rooms[rooms.length - 1];
  let maxDist2 = 0;
  for (const r of rooms) {
    const d = roomDist2(entryRoom, r);
    if (d > maxDist2) { maxDist2 = d; exitRoom = r; }
  }
  const exitPoint: Vec2 = { x: exitRoom.cx * cellSize, y: exitRoom.cy * cellSize };

  // ── 9. Pack the IntGridLayer ──────────────────────────────────────────────────
  const tiles: IntGridLayer = {
    identifier: 'DungeonCollision',
    cellSize,
    cols,
    rows,
    values: grid,
  };

  return { tiles, rooms, spawnPoints, entryPoint, exitPoint };
}
