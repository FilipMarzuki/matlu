/**
 * Diagonal river definitions and path-generation algorithm (FIL-166).
 *
 * Rivers now flow diagonally from NW (mountains) to SE (ocean) via gradient
 * descent over the terrain elevation grid. The old horizontal RiverBand approach
 * produced two stark straight lines that contradicted the map's NW→SE elevation
 * gradient. Diagonal paths look geographically credible by construction.
 *
 * ## How the new system works
 *
 * 1. Each river is described by a DiagonalRiver config: a source tile in the NW
 *    mountain zone, a half-width in pixels, and crossing widths for the bridge
 *    and wading ford.
 * 2. `traceRiverPath()` runs gradient descent over the elevation grid — at each
 *    step it moves to the lowest-elevation 8-directional neighbour until the tile
 *    reaches Sea biome (elev < 0.25) or the map edge.
 * 3. A Catmull-Rom spline smooths the raw staircase path into a flowing curve.
 * 4. The bridge crossing is placed at the smoothed path point closest to the
 *    SW→NE gameplay corridor. The ford is placed ~10 raw steps upstream.
 *
 * Downstream consumers use the returned TracedRiverPath for:
 *  - FIL-167: precompute `isRiverTile[]` lookup grid from path + halfWidth
 *  - FIL-168: replace horizontal band checks in terrain bake + animated water
 *  - FIL-169: stair-step navigation barriers that follow the diagonal path
 *  - FIL-170: repositioned bridge/ford crossing visuals
 *  - FIL-171: waterfall sprite placement at detected steep drops
 *
 * ## Why gradient descent?
 * Hardcoded offsets require manual re-tuning whenever terrain noise changes.
 * Gradient descent guarantees every river segment flows downhill — physically
 * plausible by construction, and automatically adapts to any noise seed.
 */

/** Must stay in sync with TILE_SIZE in GameScene.ts. */
const TILE_SIZE = 32;

// ─── DEPRECATED: legacy horizontal band system ────────────────────────────────
//
// The RiverBand / RIVER_BANDS / RIVER_BRIDGE_POSITIONS exports below are kept
// only while the remaining GameScene consumers migrate to the new system:
//   • drawProceduralTerrain   → FIL-168
//   • drawBiomeColorWash      → FIL-168
//   • createRiverCrossingVisuals → FIL-170
//   • createNavigationBarriers   → FIL-169
//
// All four will be updated in their respective issues; these exports are removed
// in FIL-168 when the last consumer switches over.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use DiagonalRiver + traceRiverPath (FIL-166).
 * A horizontal river strip 3 rows (96 px) tall spanning the full map width.
 */
export interface RiverBand {
  /** Centre tile row (ty). World y = tyCentre × TILE_SIZE. */
  tyCentre: number;
  /** Half-width in tile rows. Band spans tyCentre ± halfTiles. */
  halfTiles: number;
  /** World-pixel x where the bridge crossing gap begins. */
  bridgeX: number;
  /** Bridge gap width in pixels. */
  bridgeW: number;
  /** World-pixel x where the wading crossing gap begins. */
  wadingX: number;
  /** Wading gap width in pixels. */
  wadingW: number;
}

/** @deprecated Use DIAGONAL_RIVERS (FIL-166). */
export const RIVER_BANDS: ReadonlyArray<RiverBand> = [
  {
    // River A — "Southern River", centre at y ≈ 2080 (tyCentre 65).
    tyCentre: 65, halfTiles: 1,
    bridgeX: 540, bridgeW: 128,
    wadingX: 350, wadingW: 128,
  },
  {
    // River B — mid-corridor river, centre at y ≈ 1504 (tyCentre 47).
    tyCentre: 47, halfTiles: 1,
    bridgeX: 1500, bridgeW: 96,
    wadingX: 1700, wadingW: 128,
  },
] as const;

/**
 * @deprecated Derived from RIVER_BANDS; replaced by TracedRiverPath bridge
 * positions after FIL-170.
 */
export const RIVER_BRIDGE_POSITIONS: ReadonlyArray<{ x: number; y: number }> =
  RIVER_BANDS.map(r => ({ x: r.bridgeX + r.bridgeW / 2, y: r.tyCentre * TILE_SIZE }));

// ─── Diagonal river system (FIL-166) ─────────────────────────────────────────

/**
 * Elevation drop over a single gradient-descent step that qualifies as a waterfall.
 * The elevation scale is [0, 1.2]; a drop of 0.12 represents a very steep cliff.
 * FIL-171 uses this to place waterfall sprites and navigation barriers.
 */
export const WATERFALL_THRESHOLD = 0.12;

/**
 * Configuration for a single diagonal river.
 *
 * `bridge.pathIndex` and `ford.pathIndex` are placeholder 0s in the
 * DIAGONAL_RIVERS constant — they are filled in at runtime by `traceRiverPath()`.
 * Always read pathIndex from `TracedRiverPath.river`, not from DIAGONAL_RIVERS.
 */
export interface DiagonalRiver {
  id: string;
  /** Source tile in the NW mountain zone (high elevation). */
  sourceTile: { tx: number; ty: number };
  /** River half-width in pixels — river occupies ±halfWidth from the centreline. */
  halfWidth: number;
  /**
   * Bridge crossing. `pathIndex` is an index into `TracedRiverPath.points[]` for
   * the crossing location, computed by `traceRiverPath()` — not hardcoded here.
   */
  bridge: { pathIndex: number; width: number };
  /** Wading ford crossing — placed ~10 raw gradient steps upstream from the bridge. */
  ford:   { pathIndex: number; width: number };
}

/** One raw tile step recorded during gradient descent. */
export interface RiverTileStep {
  tx: number;
  ty: number;
  /** Elevation at this tile from the elevation grid [0, 1.2]. */
  elev: number;
}

/**
 * Full result of tracing one river path — returned by `traceRiverPath()`.
 * Consumers in FIL-167/168/169/170 use this instead of the old RiverBand.
 */
export interface TracedRiverPath {
  /**
   * River definition with bridge/ford pathIndices filled in from crossing
   * discovery. This is a NEW object — the original DiagonalRiver in
   * DIAGONAL_RIVERS is never mutated.
   */
  river: DiagonalRiver;
  /**
   * Raw gradient-descent path — one entry per tile step, from the NW source
   * tile to the SE shore/sea. Needed by FIL-171 for waterfall positions.
   */
  rawPath: ReadonlyArray<RiverTileStep>;
  /**
   * Catmull-Rom smoothed path in world pixels, derived from rawPath.
   * Removes the 45°/90° staircase artefact of pure 8-directional gradient
   * descent. `bridge.pathIndex` and `ford.pathIndex` index into this array.
   */
  points: ReadonlyArray<{ x: number; y: number }>;
  /**
   * Indices into `rawPath` where the elevation dropped by more than
   * WATERFALL_THRESHOLD in a single step.
   * FIL-171 uses these to place waterfall sprites and navigation barriers.
   */
  waterfalls: ReadonlyArray<{ pathIndex: number }>;
}

/**
 * Static river configurations for Level 1.
 *
 * Source tiles are in the NW mountain zone (perpDiag < −0.10) so gradient
 * descent naturally flows SE toward the ocean.
 *
 * Target crossings (approximate — exact positions depend on noise seed):
 *  - River A: crosses the corridor near old (600, 2100)
 *  - River B: crosses the corridor near old (1548, 1520)
 *
 * `bridge.pathIndex` and `ford.pathIndex` are placeholder 0s — call
 * `traceRiverPath()` with the runtime elevation grid to resolve them.
 */
export const DIAGONAL_RIVERS: ReadonlyArray<DiagonalRiver> = [
  {
    id: 'river-a',
    // Left edge, mid-south in the mountain zone — descends SE to cross the
    // corridor near the old Southern River position ~(600, 2100).
    sourceTile: { tx: 5, ty: 50 },
    // 48 px half-width → 96 px total band, matching the old halfTiles:1 (3 rows × 32).
    halfWidth: 48,
    bridge: { pathIndex: 0, width: 128 }, // pathIndex resolved by traceRiverPath
    ford:   { pathIndex: 0, width: 128 },
  },
  {
    id: 'river-b',
    // Left edge, near north — longer path, crosses corridor near old River B ~(1548, 1520).
    sourceTile: { tx: 5, ty: 15 },
    halfWidth: 48,
    bridge: { pathIndex: 0, width: 96  },
    ford:   { pathIndex: 0, width: 128 },
  },
] as const;

// ─── Internal smoothing helper ────────────────────────────────────────────────

/**
 * Number of interpolated world-pixel points inserted between each pair of raw
 * tile-centre control points. Higher values produce smoother curves at the cost
 * of more entries in TracedRiverPath.points. 3 is visually smooth without
 * excessive memory use (~3× the raw tile count).
 */
const SMOOTH_STEPS = 3;

/**
 * Smooth a sequence of world-pixel control points using a standard Catmull-Rom
 * spline (uniform parameterisation, tension = 0.5).
 *
 * Catmull-Rom guarantees the curve passes through every control point, so the
 * smoothed path never drifts far from the raw tile centres. At endpoints the
 * algorithm clamps the "phantom" control points to the first/last segment to
 * avoid overshoot.
 *
 * Between each adjacent pair (p1, p2) this inserts SMOOTH_STEPS − 1 extra
 * points, eliminating the 45°/90° staircase of 8-directional gradient descent.
 *
 * Reference: https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline
 */
function catmullRomSmooth(
  ctrl: ReadonlyArray<{ x: number; y: number }>,
): Array<{ x: number; y: number }> {
  if (ctrl.length < 2) return [...ctrl];

  const out: Array<{ x: number; y: number }> = [];

  for (let i = 0; i < ctrl.length - 1; i++) {
    // Clamp phantom neighbours at the two ends to avoid boundary overshoot.
    const p0 = ctrl[Math.max(0, i - 1)];
    const p1 = ctrl[i];
    const p2 = ctrl[i + 1];
    const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];

    for (let s = 0; s < SMOOTH_STEPS; s++) {
      const t  = s / SMOOTH_STEPS;
      const t2 = t * t;
      const t3 = t2 * t;

      // Standard Catmull-Rom formula.  Each axis is computed independently.
      // The 0.5 factor is the Catmull-Rom tension (half the chord length used
      // as tangent magnitude — standard choice that gives smooth, natural curves).
      out.push({
        x: 0.5 * (
          2 * p1.x
          + (-p0.x + p2.x) * t
          + ( 2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
          + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        ),
        y: 0.5 * (
          2 * p1.y
          + (-p0.y + p2.y) * t
          + ( 2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
          + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
        ),
      });
    }
  }

  // Always include the final control point exactly (the loop above stops one short).
  const last = ctrl[ctrl.length - 1];
  out.push({ x: last.x, y: last.y });

  return out;
}

// ─── Crossing discovery helper ────────────────────────────────────────────────

// SW→NE gameplay corridor endpoints — kept in sync with SPAWN_X/Y and PORTAL_X/Y
// in GameScene.ts.  These are only used inside corridorDist() below.
const CORRIDOR_AX = 300;   // spawn x
const CORRIDOR_AY = 2650;  // spawn y
const CORRIDOR_DX = 3800;  // portal (4100,350) minus spawn
const CORRIDOR_DY = -2300;
const CORRIDOR_LEN_SQ = CORRIDOR_DX * CORRIDOR_DX + CORRIDOR_DY * CORRIDOR_DY;

/**
 * Perpendicular distance from world-pixel point (px, py) to the SW→NE corridor
 * centreline.  Minimised at the natural river crossing — where gradient-descent
 * path intersects the main gameplay route.
 *
 * Uses the 2-D cross-product form: |A→P × A→B| / |AB|.
 */
function corridorDist(px: number, py: number): number {
  const dx    = px - CORRIDOR_AX;
  const dy    = py - CORRIDOR_AY;
  const cross = dx * CORRIDOR_DY - dy * CORRIDOR_DX;
  return Math.abs(cross) / Math.sqrt(CORRIDOR_LEN_SQ);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Trace the path of one river across the terrain using gradient descent, smooth
 * it with a Catmull-Rom spline, and discover the bridge/ford crossing positions.
 *
 * ## Gradient descent
 *
 * Starting from `river.sourceTile`, at each step we move to the neighbour with
 * the lowest elevation among the 8 surrounding tiles. We stop when:
 *  - The current tile reaches Sea biome (elev < 0.25), or
 *  - We reach the map edge, or
 *  - All neighbours are higher (local minimum — plateau/depression).
 *
 * A visited-set prevents infinite loops on perfectly flat terrain.
 *
 * ## Waterfall detection
 *
 * During descent, any step where `elev_prev − elev_next > WATERFALL_THRESHOLD`
 * is recorded in `TracedRiverPath.waterfalls` (as a raw-path index).
 * FIL-171 uses these positions for waterfall sprite placement.
 *
 * ## Catmull-Rom smoothing
 *
 * The raw 8-directional path has a staircase artefact (tiles step at 45° or 90°).
 * A Catmull-Rom spline pass converts tile-centre control points into a smooth
 * world-pixel curve while passing through every original tile centre.
 *
 * ## Crossing discovery
 *
 * The bridge is placed at the smoothed-path point closest to the SW→NE corridor
 * centreline (minimising perpendicular distance). The ford is placed ~10 raw
 * gradient steps upstream (= 10 × SMOOTH_STEPS entries earlier in the smoothed
 * array), giving the player an alternative shallow crossing slightly west of the bridge.
 *
 * ## ⚠️  Pass a clean elevation grid
 *
 * `elevGrid` must contain the *natural* terrain elevation values — before any
 * river-tile forcing applied during terrain baking (the FIL-100 RIVER_BANDS
 * override sets forced rows to ~0.15, which would trap gradient descent in the
 * wrong horizontal rows). FIL-167 refactors `drawProceduralTerrain` to compute
 * elevation before river overrides and pass that clean grid here.
 *
 * @param river    - River configuration (bridge/ford pathIndex may be placeholder 0).
 * @param elevGrid - Flat [ty * tilesX + tx] elevation array, values [0, 1.2].
 * @param tilesX   - Tile columns (= ceil(WORLD_W / TILE_SIZE)).
 * @param tilesY   - Tile rows    (= ceil(WORLD_H / TILE_SIZE)).
 */
export function traceRiverPath(
  river: DiagonalRiver,
  elevGrid: Float32Array,
  tilesX: number,
  tilesY: number,
): TracedRiverPath {
  const rawPath: RiverTileStep[] = [];
  const waterfalls: Array<{ pathIndex: number }> = [];

  let tx = river.sourceTile.tx;
  let ty = river.sourceTile.ty;

  // Track visited tiles to prevent the algorithm from looping on flat terrain.
  const visited = new Set<number>();

  while (true) {
    const idx = ty * tilesX + tx;

    // Safety guard: never revisit a tile.
    if (visited.has(idx)) break;
    visited.add(idx);

    const elev = elevGrid[idx] ?? 1.0; // default to high elevation for OOB reads
    rawPath.push({ tx, ty, elev });

    // Stop conditions — reached sea biome or hit the map boundary.
    if (elev < 0.25) break;
    if (tx <= 0 || tx >= tilesX - 1 || ty <= 0 || ty >= tilesY - 1) break;

    // Find the lowest-elevation 8-directional neighbour.
    let bestTx  = tx;
    let bestTy  = ty;
    let bestElev = elev; // we must descend — only accept strictly lower values

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || nx >= tilesX || ny < 0 || ny >= tilesY) continue;
        const nIdx = ny * tilesX + nx;
        if (visited.has(nIdx)) continue;
        const nElev = elevGrid[nIdx] ?? 1.0;
        if (nElev < bestElev) {
          bestElev = nElev;
          bestTx   = nx;
          bestTy   = ny;
        }
      }
    }

    // Waterfall: a drop larger than WATERFALL_THRESHOLD in a single step.
    // Record the index of the tile we are descending FROM (rawPath already
    // contains it as the last entry).
    const willMove = bestTx !== tx || bestTy !== ty;
    if (willMove && elev - bestElev > WATERFALL_THRESHOLD) {
      waterfalls.push({ pathIndex: rawPath.length - 1 });
    }

    // No strictly lower neighbour → local minimum / plateau.  Stop here.
    if (!willMove) break;

    tx = bestTx;
    ty = bestTy;
  }

  // ── Catmull-Rom smoothing ────────────────────────────────────────────────
  // Convert raw tile-centre coordinates to world pixels, then smooth.
  const tileCtrl = rawPath.map(p => ({
    x: p.tx * TILE_SIZE + TILE_SIZE / 2,
    y: p.ty * TILE_SIZE + TILE_SIZE / 2,
  }));
  const points = catmullRomSmooth(tileCtrl);

  // ── Bridge / ford crossing discovery ────────────────────────────────────
  // Walk the smoothed path and find the point with the smallest perpendicular
  // distance from the SW→NE corridor.  That is where the river intersects the
  // main gameplay route — the natural bridge location.
  let bridgeIdx = 0;
  let bridgeDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = corridorDist(points[i].x, points[i].y);
    if (d < bridgeDist) {
      bridgeDist = d;
      bridgeIdx  = i;
    }
  }

  // Ford: ~10 raw gradient steps upstream from the bridge.
  // Each raw step contributes SMOOTH_STEPS entries in the smoothed array, so
  // we subtract 10 × SMOOTH_STEPS to go back the right distance.
  const fordIdx = Math.max(0, bridgeIdx - 10 * SMOOTH_STEPS);

  return {
    river: {
      ...river,
      bridge: { pathIndex: bridgeIdx, width: river.bridge.width },
      ford:   { pathIndex: fordIdx,   width: river.ford.width   },
    },
    rawPath,
    points,
    waterfalls,
  };
}

// ─── FIL-167: isRiverTile / isWaterfallTile lookup grids ─────────────────────

/**
 * Shortest distance from point P=(px, py) to line segment A=(ax,ay)→B=(bx,by).
 * Used to determine which tiles fall within river.halfWidth of the smoothed path.
 */
function distPointToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Degenerate (zero-length) segment — treat as single point.
    return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  }
  // Project P onto the segment, clamped so t∈[0,1] stays on the segment.
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/**
 * Build flat `Uint8Array` lookup grids from a set of traced river paths.
 *
 * ## isRiverTile
 * A tile is marked 1 if its centre is within `river.halfWidth` pixels of *any*
 * segment in the smoothed path.  Tiles at bridge or ford crossing centres
 * (within `crossing.width / 2` pixels of the path point at `bridge.pathIndex`
 * or `ford.pathIndex`) are excluded — they remain passable ground.
 *
 * ## isWaterfallTile
 * Tiles within `halfWidth` of a waterfall point (rawPath index recorded during
 * FIL-166 gradient descent) are also marked 1 in a *separate* grid.  They are
 * still rendered as river tiles but receive distinct collision treatment in FIL-171.
 *
 * ## Performance
 * For each path segment the algorithm only inspects tiles inside the segment's
 * axis-aligned bounding box expanded by `halfWidth`.  This avoids the naïve
 * O(tiles × segments) scan and keeps the one-time init cost low.
 *
 * ## Why segment-based rather than point-based?
 * After Catmull-Rom smoothing the consecutive path points can be up to ~10 px
 * apart.  Testing only points would leave thin "gaps" of unmarked tiles between
 * them.  Testing the full segment guarantees a continuous band.
 *
 * @param traced  - Results from traceRiverPath() — one per river.
 * @param tilesX  - Tile columns (= ceil(WORLD_W / TILE_SIZE)).
 * @param tilesY  - Tile rows    (= ceil(WORLD_H / TILE_SIZE)).
 */
export function buildRiverTileGrids(
  traced: ReadonlyArray<TracedRiverPath>,
  tilesX: number,
  tilesY: number,
): { isRiverTile: Uint8Array; isWaterfallTile: Uint8Array } {
  const isRiverTile    = new Uint8Array(tilesX * tilesY);
  const isWaterfallTile = new Uint8Array(tilesX * tilesY);

  for (const { river, rawPath, points, waterfalls } of traced) {
    const { halfWidth } = river;
    const halfWidthSq = halfWidth * halfWidth;

    // ── Mark river-tile band ────────────────────────────────────────────────
    // Iterate over consecutive pairs in the smoothed path (segments, not points)
    // so there are no unmarked gaps between samples.
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      // Tight bounding box for this segment, expanded by halfWidth.
      // Only tiles whose centres can possibly be within halfWidth of the segment
      // fall inside this box — skip everything outside.
      const minTx = Math.max(0,          Math.floor((Math.min(p1.x, p2.x) - halfWidth) / TILE_SIZE));
      const maxTx = Math.min(tilesX - 1, Math.ceil( (Math.max(p1.x, p2.x) + halfWidth) / TILE_SIZE));
      const minTy = Math.max(0,          Math.floor((Math.min(p1.y, p2.y) - halfWidth) / TILE_SIZE));
      const maxTy = Math.min(tilesY - 1, Math.ceil( (Math.max(p1.y, p2.y) + halfWidth) / TILE_SIZE));

      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          const idx = ty * tilesX + tx;
          if (isRiverTile[idx]) continue; // already marked — skip distance check
          const cx = tx * TILE_SIZE + TILE_SIZE / 2;
          const cy = ty * TILE_SIZE + TILE_SIZE / 2;
          if (distPointToSegment(cx, cy, p1.x, p1.y, p2.x, p2.y) <= halfWidth) {
            isRiverTile[idx] = 1;
          }
        }
      }
    }

    // ── Crossing gap exclusion ──────────────────────────────────────────────
    // Bridge and ford crossing centres must remain passable ground — clear any
    // river-tile marks within half the crossing width of each centre point.
    for (const crossing of [river.bridge, river.ford]) {
      if (crossing.pathIndex >= points.length) continue;
      const centre  = points[crossing.pathIndex];
      const halfGap = crossing.width / 2;
      const halfGapSq = halfGap * halfGap;

      const minTx = Math.max(0,          Math.floor((centre.x - halfGap) / TILE_SIZE));
      const maxTx = Math.min(tilesX - 1, Math.ceil( (centre.x + halfGap) / TILE_SIZE));
      const minTy = Math.max(0,          Math.floor((centre.y - halfGap) / TILE_SIZE));
      const maxTy = Math.min(tilesY - 1, Math.ceil( (centre.y + halfGap) / TILE_SIZE));

      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          const cx = tx * TILE_SIZE + TILE_SIZE / 2;
          const cy = ty * TILE_SIZE + TILE_SIZE / 2;
          if ((cx - centre.x) ** 2 + (cy - centre.y) ** 2 <= halfGapSq) {
            isRiverTile[ty * tilesX + tx] = 0;
          }
        }
      }
    }

    // ── Waterfall tiles ─────────────────────────────────────────────────────
    // Mark tiles within halfWidth of each waterfall point.  The waterfall index
    // is into rawPath (recorded during gradient descent in FIL-166); we convert
    // to world pixels from the raw tile coordinates.
    for (const { pathIndex } of waterfalls) {
      if (pathIndex >= rawPath.length) continue;
      const step = rawPath[pathIndex];
      const wx = step.tx * TILE_SIZE + TILE_SIZE / 2;
      const wy = step.ty * TILE_SIZE + TILE_SIZE / 2;

      const minTx = Math.max(0,          Math.floor((wx - halfWidth) / TILE_SIZE));
      const maxTx = Math.min(tilesX - 1, Math.ceil( (wx + halfWidth) / TILE_SIZE));
      const minTy = Math.max(0,          Math.floor((wy - halfWidth) / TILE_SIZE));
      const maxTy = Math.min(tilesY - 1, Math.ceil( (wy + halfWidth) / TILE_SIZE));

      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          const cx = tx * TILE_SIZE + TILE_SIZE / 2;
          const cy = ty * TILE_SIZE + TILE_SIZE / 2;
          if ((cx - wx) ** 2 + (cy - wy) ** 2 <= halfWidthSq) {
            isWaterfallTile[ty * tilesX + tx] = 1;
          }
        }
      }
    }
  }

  return { isRiverTile, isWaterfallTile };
}
