/**
 * IsoTransform — coordinate math for the isometric (3/4) projection.
 *
 * ## Coordinate spaces
 *
 *   World space:  (wx, wy) in pixels, 0..WORLD_W × 0..WORLD_H (4500×3000).
 *                 This is where physics bodies, entities, and noise sampling live.
 *                 One tile = WORLD_TILE_SIZE (32 px) in each axis.
 *
 *   Iso space:    (sx, sy) in screen pixels. The logical grid is projected as a
 *                 diamond using the standard 2:1 isometric formula. This is the
 *                 coordinate space rendered to screen; RenderTextures and camera
 *                 bounds use it.
 *
 * ## Tile geometry
 *
 *   Each diamond tile is ISO_TILE_W (32) px wide and ISO_TILE_H (16) px tall.
 *   Tiles in the isometric tileset pack are 32×32 px sprites — the 16px diamond
 *   face sits in the top half; the 16px front face fills the bottom half.
 *
 *   Anchor convention: top-centre of the sprite = north apex of the diamond.
 *   Use setOrigin(0.5, 0) when placing tile sprites.
 *
 * ## Isometric world bounds
 *
 *   Logical grid:   tilesX = 141, tilesY = 94  (WORLD_W/TILE_SIZE, WORLD_H/TILE_SIZE)
 *   Iso width:      (141 + 94) × 16 = 3760 px
 *   Iso height:     (141 + 94) × 8  = 1880 px  + 32 (front-face overhang) = 1912 px
 *   Left offset:    tilesY × 16 = 1504 px  — so the NW edge of the grid (tx=0,ty=94)
 *                   lands at x = 0, not at a large negative value.
 *
 * No Phaser imports — this module is pure math so it can be tested in isolation.
 */

// ── World tile size (matches GameScene constant) ──────────────────────────────
export const WORLD_TILE_SIZE = 32;

// ── Isometric tile dimensions ─────────────────────────────────────────────────
/** Diamond face width in px. Matches the isometric tileset sprite width. */
export const ISO_TILE_W = 32;
/** Diamond face height in px (= ISO_TILE_W / 2 for 2:1 isometric). */
export const ISO_TILE_H = 16;

// ── Isometric world bounds ────────────────────────────────────────────────────
/** Logical grid dimensions (WORLD_W / WORLD_TILE_SIZE, WORLD_H / WORLD_TILE_SIZE). */
export const TILES_X = 141;
export const TILES_Y = 94;

/**
 * X offset applied so the left edge of the isometric diamond (the NW corner of
 * the grid) sits at iso-x = 0. Without this, tiles at ty > 0 would have
 * negative screen x values.
 *
 * Value: TILES_Y × (ISO_TILE_W / 2) = 94 × 16 = 1504.
 */
export const ISO_ORIGIN_X = TILES_Y * (ISO_TILE_W / 2); // 1504

/** Y offset for the top apex of the grid (always 0 — the northernmost tip is the
 *  origin). Exposed as a constant so callers can reference it explicitly. */
export const ISO_ORIGIN_Y = 0;

/** Total isometric world width in px (bounding box of the projected diamond). */
export const ISO_WORLD_W = (TILES_X + TILES_Y) * (ISO_TILE_W / 2); // 3760

/**
 * Total isometric world height in px.
 * = (tilesX + tilesY) × (ISO_TILE_H / 2) + ISO_TILE_H
 * The extra ISO_TILE_H accounts for the front face of the southernmost tile row.
 */
export const ISO_WORLD_H = (TILES_X + TILES_Y) * (ISO_TILE_H / 2) + ISO_TILE_H; // 1892

// ── Core transform ────────────────────────────────────────────────────────────

/**
 * Convert a world-space pixel position to isometric screen coordinates.
 *
 * The returned (x, y) is the north apex of the tile diamond — use setOrigin(0.5, 0)
 * when placing the tile sprite so its top-centre aligns with this point.
 *
 * @param wx  World x in pixels (0..WORLD_W)
 * @param wy  World y in pixels (0..WORLD_H)
 */
export function worldToIso(wx: number, wy: number): { x: number; y: number } {
  const tx = wx / WORLD_TILE_SIZE;
  const ty = wy / WORLD_TILE_SIZE;
  return {
    x: ISO_ORIGIN_X + (tx - ty) * (ISO_TILE_W / 2),
    y: ISO_ORIGIN_Y + (tx + ty) * (ISO_TILE_H / 2),
  };
}

/**
 * Convert an isometric screen coordinate back to world-space pixels.
 *
 * Used to remap pointer/joystick screen-space directions into world-space
 * directions. Not guaranteed to be perfectly accurate at sub-pixel level,
 * but direction is exact.
 *
 * @param sx  Iso screen x
 * @param sy  Iso screen y
 */
export function isoToWorld(sx: number, sy: number): { x: number; y: number } {
  const relX = sx - ISO_ORIGIN_X;
  const relY = sy - ISO_ORIGIN_Y;
  // Inverse of the 2×2 iso matrix:
  //   [ISO_W/2   -ISO_W/2 ] [tx]   [relX]
  //   [ISO_H/2    ISO_H/2 ] [ty] = [relY]
  // → tx = (relX/(ISO_W/2) + relY/(ISO_H/2)) / 2
  // → ty = (relY/(ISO_H/2) - relX/(ISO_W/2)) / 2
  const hw = ISO_TILE_W / 2;
  const hh = ISO_TILE_H / 2;
  const tx = (relX / hw + relY / hh) / 2;
  const ty = (relY / hh - relX / hw) / 2;
  return { x: tx * WORLD_TILE_SIZE, y: ty * WORLD_TILE_SIZE };
}

/**
 * Painter-sort depth key for an entity at world position (wx, wy).
 *
 * Higher value = rendered later = appears closer to the camera (in front).
 * Entities with the same (wx + wy) sum are on the same iso "row" and draw
 * order between them doesn't matter visually.
 *
 * Use: `sprite.setDepth(isoDepth(body.x, body.y))`
 */
export function isoDepth(wx: number, wy: number): number {
  return (wx + wy) / WORLD_TILE_SIZE;
}

/**
 * Convert a joystick/keyboard screen-space angle to the corresponding world-space
 * movement angle. In isometric view the world axes are rotated 45° CCW from the
 * screen axes, so pressing "up" (screen angle = −π/2) should move northwest in
 * world space.
 *
 * @param screenAngle  Angle in radians measured in screen/iso space
 * @returns            Angle in radians in world space
 */
export function isoInputAngleToWorld(screenAngle: number): number {
  // The iso projection rotates world axes 45° CW relative to screen,
  // so to convert screen input → world direction we rotate 45° CCW.
  return screenAngle - Math.PI / 4;
}

// ── CombatArenaScene coordinate system ───────────────────────────────────────
//
// The arena uses a smaller grid (60×60 cells, 16 px per cell) than the main
// world. The iso tile sprites are the same size — one arena cell maps to one
// iso tile diamond on screen. These constants and transforms parallel the world
// ones above but use ARENA_CELL as the tile size.

/** Size of one arena grid cell in world pixels. */
export const ARENA_CELL = 16;
/** Number of arena columns (east–west axis). */
export const ARENA_COLS = 60;
/** Number of arena rows (north–south axis). */
export const ARENA_ROWS = 60;

/**
 * X offset so the NW edge of the arena grid (tx=0, ty=ARENA_ROWS) lands at
 * iso-x = 0.
 *
 * Value: ARENA_ROWS × (ISO_TILE_W / 2) = 60 × 16 = 960.
 */
export const ARENA_ISO_ORIGIN_X = ARENA_ROWS * (ISO_TILE_W / 2); // 960

/** Total isometric width of the arena bounding box in px. */
export const ARENA_ISO_W = (ARENA_COLS + ARENA_ROWS) * (ISO_TILE_W / 2); // 1920

/**
 * Total isometric height of the arena bounding box in px.
 * Includes the front-face overhang of the southernmost tile row (ISO_TILE_H).
 */
export const ARENA_ISO_H = (ARENA_COLS + ARENA_ROWS) * (ISO_TILE_H / 2) + ISO_TILE_H; // 976

/**
 * Convert an arena world-space pixel position to isometric screen coordinates.
 *
 * One arena cell (ARENA_CELL = 16 px world) maps to one iso tile diamond.
 * The returned (x, y) is the north apex of the tile — use setOrigin(0.5, 0)
 * when placing tile sprites.
 *
 * @param wx  Arena world x in pixels (0..ARENA_COLS * ARENA_CELL)
 * @param wy  Arena world y in pixels (0..ARENA_ROWS * ARENA_CELL)
 */
export function worldToArenaIso(wx: number, wy: number): { x: number; y: number } {
  const tx = wx / ARENA_CELL;
  const ty = wy / ARENA_CELL;
  return {
    x: ARENA_ISO_ORIGIN_X + (tx - ty) * (ISO_TILE_W / 2),
    y:                       (tx + ty) * (ISO_TILE_H / 2),
  };
}

/**
 * Painter-sort depth key for an entity at arena world position (wx, wy).
 *
 * Higher value = rendered later = appears closer to the camera (in front).
 * Mirrors {@link isoDepth} but uses ARENA_CELL as the tile unit.
 *
 * Use: `sprite.setDepth(arenaIsoDepth(body.x, body.y))`
 *
 * @param wx  Arena world x in pixels
 * @param wy  Arena world y in pixels
 */
export function arenaIsoDepth(wx: number, wy: number): number {
  return (wx + wy) / ARENA_CELL;
}
