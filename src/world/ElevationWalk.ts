/**
 * ElevationWalk — pure helpers for walking on elevated terrain in
 * HomesteadScene. No Phaser or browser globals required (#936).
 *
 * The cliff-face geometry mirrors HomesteadScene's render pass: a tile's
 * south/east/west "drop" toward a neighbour is only positive when this tile
 * is the higher one, so the forbidden half-tile strip is always anchored on
 * the high side of the boundary — which is also where the cliff-wall sprite
 * is drawn. That single rule blocks crossing from either direction without
 * needing separate north/south/east/west cases.
 */
import { intGridGet, type IntGridLayer } from './MapData';

export interface CliffDrops {
  south: number;
  east: number;
  west: number;
}

/**
 * Elevation drop from tile (tx, ty) toward each neighbour. Zero (not
 * negative) whenever the neighbour is the same height or higher — only a
 * tile that stands higher than a neighbour has a cliff face on that edge.
 *
 * `westSeamCol`, if given, skips the west comparison at that column — matches
 * HomesteadScene's render pass, which never diffs across the homestead/
 * WorldForge map seam (tx === 30) since the two halves use unrelated height
 * formulas there.
 */
export function cliffDrops(
  heightGrid: IntGridLayer,
  tx: number,
  ty: number,
  westSeamCol = -1,
): CliffDrops {
  const elev = intGridGet(heightGrid, tx, ty);
  if (elev === 0) return { south: 0, east: 0, west: 0 };
  const southElev = ty + 1 < heightGrid.rows ? intGridGet(heightGrid, tx, ty + 1) : elev;
  const eastElev  = tx + 1 < heightGrid.cols ? intGridGet(heightGrid, tx + 1, ty) : elev;
  const westElev  = (tx > 0 && tx !== westSeamCol) ? intGridGet(heightGrid, tx - 1, ty) : elev;
  return {
    south: Math.max(0, elev - southElev),
    east: Math.max(0, elev - eastElev),
    west: Math.max(0, elev - westElev),
  };
}

/** Key identifying a tile in a ramp set/map — `"tx,ty"`. */
export function rampKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

export function buildRampSet(tiles: ReadonlyArray<{ tx: number; ty: number }>): Set<string> {
  return new Set(tiles.map(t => rampKey(t.tx, t.ty)));
}

/**
 * Whether a point at local offsets (localX, localY) — 0..tileSize, origin at
 * the tile's NW corner — inside tile (tx, ty) sits in an impassable
 * cliff-face strip. Ramp tiles bypass this entirely, so the player can climb
 * between elevation levels at the designated spots.
 */
export function isCliffBlocked(
  heightGrid: IntGridLayer,
  rampTiles: ReadonlySet<string>,
  tx: number,
  ty: number,
  localX: number,
  localY: number,
  tileSize: number,
  westSeamCol = -1,
): boolean {
  if (rampTiles.has(rampKey(tx, ty))) return false;
  const { south, east, west } = cliffDrops(heightGrid, tx, ty, westSeamCol);
  const half = tileSize / 2;
  if (south > 0 && localY >= half) return true;
  if (east > 0 && localX >= half) return true;
  if (west > 0 && localX < half) return true;
  return false;
}

/** A single ramp tile — climbs from `fromElev` (its south edge) to `toElev` (its north edge). */
export interface RampDef {
  tx: number;
  ty: number;
  fromElev: number;
  toElev: number;
}

export function buildRampMap(ramps: ReadonlyArray<RampDef>): Map<string, RampDef> {
  return new Map(ramps.map(r => [rampKey(r.tx, r.ty), r]));
}

/**
 * Elevation to render at local Y offset `localY` (0..tileSize, 0 = north
 * edge) inside a ramp tile — interpolates linearly between the ramp's two
 * levels so climbing it reads as a slope rather than a snap.
 */
export function rampElevation(ramp: RampDef, localY: number, tileSize: number): number {
  const t = 1 - localY / tileSize; // north edge (localY=0) -> 1, south edge (localY=tileSize) -> 0
  const clamped = Math.max(0, Math.min(1, t));
  return ramp.fromElev + (ramp.toElev - ramp.fromElev) * clamped;
}

/**
 * Effective elevation for rendering (iso sprite Y offset + depth) at world
 * position (wx, wy): the tile's flat elevation, or the interpolated ramp
 * elevation when standing on a ramp tile.
 */
export function effectiveElevation(
  heightGrid: IntGridLayer,
  rampMap: ReadonlyMap<string, RampDef>,
  wx: number,
  wy: number,
  tileSize: number,
): number {
  const tx = Math.floor(wx / tileSize);
  const ty = Math.floor(wy / tileSize);
  const ramp = rampMap.get(rampKey(tx, ty));
  if (ramp) {
    const localY = wy - ty * tileSize;
    return rampElevation(ramp, localY, tileSize);
  }
  return intGridGet(heightGrid, tx, ty);
}
