/**
 * MapOverview — a map file as a flat top-down grid of coloured cells (#1177).
 *
 * The iso scenes draw a level in perspective; a minimap, a menu thumbnail or
 * the crafter's "where you live" panel want the same level as a plain 2D
 * picture. `overviewCells()` classifies every cell from the level's layers
 * and entities; the Phaser helpers below paint that grid. One renderer,
 * every map, no projection maths.
 *
 * `overviewCells` is pure (no Phaser) so it's unit-tested; the two Phaser
 * helpers are thin wrappers around a Graphics object.
 */

import type * as Phaser from 'phaser';
import { entitiesOfType, intGridGet, type LdtkLevel, type LdtkEntity } from './MapData';

export type OverviewCell = 'ground' | 'blocked' | 'road' | 'building' | 'entrance' | 'spawn';

export interface MapOverview {
  cols: number;
  rows: number;
  /** Row-major, `rows * cols` entries. */
  cells: OverviewCell[];
}

/** One palette for every consumer, so a minimap and a menu agree on what a road looks like. */
export const OVERVIEW_COLORS: Readonly<Record<OverviewCell, number>> = {
  ground:   0x3f5a2e,
  blocked:  0x2a2a33,
  road:     0x8a7a5a,
  building: 0xc8922a,
  entrance: 0x4dd4f0,
  spawn:    0xffffff,
};

/**
 * Priority when a cell matches several things: a spawn marker must stay
 * visible on top of the building it sits by, an entrance on top of the
 * road it opens onto, and so on. Lower index wins.
 */
const PRIORITY: readonly OverviewCell[] = ['spawn', 'entrance', 'building', 'road', 'blocked', 'ground'];
const rank = (c: OverviewCell) => PRIORITY.indexOf(c);

/** Cells covered by an entity's pixel bounds, clamped to the grid. */
function entityCells(e: LdtkEntity, cellSize: number, cols: number, rows: number): Array<[number, number]> {
  const x0 = Math.max(0, Math.floor(e.x / cellSize));
  const y0 = Math.max(0, Math.floor(e.y / cellSize));
  // Bounds are [x, x+width): a 64-px wide entity on a 32-px grid covers two cells, not three.
  const x1 = Math.min(cols - 1, Math.ceil((e.x + e.width) / cellSize) - 1);
  const y1 = Math.min(rows - 1, Math.ceil((e.y + e.height) / cellSize) - 1);
  const out: Array<[number, number]> = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y]);
  return out;
}

export function overviewCells(level: LdtkLevel): MapOverview {
  // Any IntGrid layer defines the grid; Collision is the one every map has.
  const grid = level.intGrids.Collision ?? Object.values(level.intGrids)[0];
  if (!grid) return { cols: 0, rows: 0, cells: [] };
  const { cols, rows, cellSize } = grid;
  const cells: OverviewCell[] = new Array(cols * rows).fill('ground');
  const paint = (x: number, y: number, kind: OverviewCell) => {
    const i = y * cols + x;
    if (rank(kind) < rank(cells[i])) cells[i] = kind;
  };

  const collision = level.intGrids.Collision;
  const paths = level.intGrids.PathSegments;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (collision && intGridGet(collision, x, y) !== 0) paint(x, y, 'blocked');
      if (paths && intGridGet(paths, x, y) !== 0) paint(x, y, 'road');
    }
  }

  const byKind: Array<[string, OverviewCell]> = [['Building', 'building'], ['Entrance', 'entrance'], ['SpawnPoint', 'spawn']];
  for (const layer of Object.values(level.entityLayers)) {
    for (const [identifier, kind] of byKind) {
      for (const e of entitiesOfType(layer, identifier)) {
        for (const [x, y] of entityCells(e, cellSize, cols, rows)) paint(x, y, kind);
      }
    }
  }

  return { cols, rows, cells };
}

// ── Phaser helpers ──────────────────────────────────────────────────────────

export interface DrawOverviewOptions {
  x: number;
  y: number;
  /** Pixels per cell. 3–4 makes a 26-cell settlement a ~100 px minimap. */
  cellPx: number;
}

/** Paint an overview with a Graphics object (top-left at x, y). */
export function drawOverview(gfx: Phaser.GameObjects.Graphics, overview: MapOverview, opts: DrawOverviewOptions): void {
  const { x, y, cellPx } = opts;
  for (let r = 0; r < overview.rows; r++) {
    for (let c = 0; c < overview.cols; c++) {
      gfx.fillStyle(OVERVIEW_COLORS[overview.cells[r * overview.cols + c]], 1);
      gfx.fillRect(x + c * cellPx, y + r * cellPx, cellPx, cellPx);
    }
  }
}

/**
 * Render a level to a texture once, so a minimap is an ordinary Image that
 * can be positioned, scaled and tinted like any sprite. Re-generating on
 * each frame would redraw hundreds of rects; a texture is drawn once.
 */
export function overviewTexture(scene: Phaser.Scene, key: string, level: LdtkLevel, cellPx: number): MapOverview {
  const overview = overviewCells(level);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const gfx = scene.make.graphics({ x: 0, y: 0 }, false);
  drawOverview(gfx, overview, { x: 0, y: 0, cellPx });
  gfx.generateTexture(key, Math.max(1, overview.cols * cellPx), Math.max(1, overview.rows * cellPx));
  gfx.destroy();
  return overview;
}
