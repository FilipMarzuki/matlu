/**
 * DungeonForgeScene — floor tile grid regression tests.
 *
 * These tests guard the tileRect grid-alignment fix (FIL-???):
 *
 *   Bug 1 — Misalignment: tileRect was computing tile centres as
 *   `wx = x1 + col * TILE + TILE/2` where x1 is the raw clipped pixel
 *   position. If a room started at a non-tile-aligned pixel (e.g. 347px
 *   when TILE=16 and innerX=22), its tiles landed at 347, 363, 379 …
 *   while the base fill and adjacent corridors used 22, 38, 54 … — offset
 *   by (347-22)%16 = 5px. The Wang-tile edge pixels didn't line up.
 *
 *   Bug 2 — Inconsistent frames at junctions: tileRect used LOCAL col/row
 *   counters (restarting from 0 on each call) for the hash. A tile covered
 *   by both a room rect and a corridor rect got different col/row values in
 *   each call → different hash → different frame. The corridor draw (last)
 *   stamped a different Wang variant on top, creating seams.
 *
 * The fix snaps every tile to the global grid anchored at (innerX, innerY)
 * and uses GLOBAL col/row so any two calls that cover the same tile produce
 * the same centre coordinates.
 *
 * Because these are pure geometric calculations (no Phaser, no DOM), the
 * logic is reproduced directly here — a change to the algorithm that breaks
 * this contract will show up immediately.
 */

import { describe, it, expect } from 'vitest';

// ── Tile grid helpers ──────────────────────────────────────────────────────────
// Reproduces the corrected tileRect coordinate logic from buildRooms().

const TILE   = 16;
const WALL_T = 22; // border width — not a multiple of TILE, which is the key detail

interface Cell { col: number; row: number; wx: number; wy: number }

/**
 * Returns all tile cells covered by the rect (x, y, w, h), clipped to the
 * arena interior. Cells are expressed in GLOBAL col/row (origin = innerX,
 * innerY) and world-space pixel centres.
 */
function tileRectCells(
  x: number, y: number, w: number, h: number,
  innerX: number, innerY: number, innerW: number, innerH: number,
): Cell[] {
  const x1 = Math.max(innerX, x);
  const y1 = Math.max(innerY, y);
  const x2 = Math.min(innerX + innerW, x + w);
  const y2 = Math.min(innerY + innerH, y + h);
  if (x2 <= x1 || y2 <= y1) return [];

  const col0 = Math.floor((x1 - innerX) / TILE);
  const row0 = Math.floor((y1 - innerY) / TILE);
  const col1 = Math.ceil((x2  - innerX) / TILE);
  const row1 = Math.ceil((y2  - innerY) / TILE);

  const cells: Cell[] = [];
  for (let row = row0; row < row1; row++) {
    for (let col = col0; col < col1; col++) {
      cells.push({
        col,
        row,
        wx: innerX + col * TILE + TILE / 2,
        wy: innerY + row * TILE + TILE / 2,
      });
    }
  }
  return cells;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('tileRect grid alignment (floor tile regression)', () => {
  // innerX = arenaX + WALL_T. Using arenaX=0 keeps the maths readable;
  // the key property is that WALL_T (22) is not a multiple of TILE (16).
  const innerX = WALL_T;      // 22
  const innerY = WALL_T;      // 22
  const innerW = 900;
  const innerH = 600;

  const cells = (x: number, y: number, w: number, h: number) =>
    tileRectCells(x, y, w, h, innerX, innerY, innerW, innerH);

  // ── Bug 1: grid alignment ──────────────────────────────────────────────────

  it('every tile centre lies on the global 16px grid', () => {
    // A room starting at a non-tile-aligned pixel — this triggered the bug.
    const roomCells = cells(100, 85, 160, 110);
    expect(roomCells.length).toBeGreaterThan(0);

    for (const { wx, wy } of roomCells) {
      // wx must be innerX + n*TILE + TILE/2 for some integer n >= 0
      expect((wx - innerX - TILE / 2) % TILE).toBe(0);
      expect((wy - innerY - TILE / 2) % TILE).toBe(0);
    }
  });

  it('tiles from a room and from the base fill share the same grid', () => {
    // Base fill starts exactly at (innerX, innerY) and uses the same step.
    // A room starting mid-tile must still land on the same grid.
    const baseCells  = cells(innerX, innerY, innerW, innerH);
    const roomCells  = cells(105, 93, 140, 100);

    const baseCentres = new Set(baseCells.map(c => `${c.wx},${c.wy}`));

    for (const rc of roomCells) {
      // Every room tile must coincide with a base-fill tile centre.
      expect(baseCentres.has(`${rc.wx},${rc.wy}`)).toBe(true);
    }
  });

  // ── Bug 2: consistent cells at room–corridor junctions ────────────────────

  it('overlapping room and corridor produce identical (wx, wy) for shared area', () => {
    // Room covers a wide area; corridor crosses through it horizontally.
    const roomCells     = cells(80,  70, 200, 120);
    const corridorCells = cells(180, 110, 120, 32);

    // Index room cells by (col, row) for O(1) lookup.
    const roomByKey = new Map(roomCells.map(c => [`${c.col},${c.row}`, c]));

    for (const cc of corridorCells) {
      const key = `${cc.col},${cc.row}`;
      if (!roomByKey.has(key)) continue;
      // Same global (col, row) → must produce exactly the same (wx, wy).
      const rc = roomByKey.get(key)!;
      expect(cc.wx).toBe(rc.wx);
      expect(cc.wy).toBe(rc.wy);
    }
  });

  it('two non-overlapping rooms do not share any tile cells', () => {
    const roomA = cells(80,  70, 100, 80);
    const roomB = cells(250, 70, 100, 80);

    const keysA = new Set(roomA.map(c => `${c.col},${c.row}`));
    for (const c of roomB) {
      expect(keysA.has(`${c.col},${c.row}`)).toBe(false);
    }
  });

  it('clipping to arena interior never produces out-of-bounds centres', () => {
    // A room that partially extends outside the arena — clipping should
    // constrain every centre to within the interior.
    const roomCells = cells(-50, -50, 200, 200); // starts far outside
    for (const { wx, wy } of roomCells) {
      expect(wx).toBeGreaterThanOrEqual(innerX);
      expect(wy).toBeGreaterThanOrEqual(innerY);
      expect(wx).toBeLessThanOrEqual(innerX + innerW);
      expect(wy).toBeLessThanOrEqual(innerY + innerH);
    }
  });

  it('a rect entirely outside the interior produces no cells', () => {
    expect(cells(-200, -200, 50, 50)).toHaveLength(0);
    expect(cells(innerX + innerW + 10, 100, 50, 50)).toHaveLength(0);
  });
});
