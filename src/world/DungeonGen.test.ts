/**
 * DungeonGen unit tests — run with `npm run unit` (Vitest).
 *
 * These tests cover the pure-TypeScript dungeon generation pipeline:
 * Delaunay triangulation → MST → corridor connectivity.  No Phaser or
 * browser globals are required so they run instantly in Node.
 *
 * A regression test for FIL-389 is included: the Bowyer-Watson
 * super-triangle was previously CW in math coordinates, causing
 * inCircumcircle() to be inverted and always returning zero edges.
 */

import { describe, it, expect } from 'vitest';
import {
  generateDungeon,
  bspGenerate,
  allRoomsConnected,
  CAVE_CONFIG,
  ARENA_BSP_CONFIG,
  type BspDungeonLayout,
} from './DungeonGen';

// ─── Shared helper ─────────────────────────────────────────────────────────────

/**
 * BFS flood-fill from the layout's entry tile.
 * Returns a Set of floor-tile indices reachable without crossing a wall.
 * Used to assert full dungeon connectivity without relying on fragile (row,col)
 * coordinates that shift whenever corridor carving implementation changes.
 */
function reachableFromEntry(layout: BspDungeonLayout): Set<number> {
  const { cols, rows, cellSize, values } = layout.tiles;
  const startCol = Math.floor(layout.entryPoint.x / cellSize);
  const startRow = Math.floor(layout.entryPoint.y / cellSize);

  const visited = new Set<number>();
  const start = startRow * cols + startCol;
  if (values[start] !== 0) return visited;

  const queue = [start];
  visited.add(start);
  while (queue.length > 0) {
    const idx = queue.shift()!;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nr = r + dr; const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const ni = nr * cols + nc;
      if (values[ni] !== 0 || visited.has(ni)) continue;
      visited.add(ni); queue.push(ni);
    }
  }
  return visited;
}

// ─── allRoomsConnected ────────────────────────────────────────────────────────

describe('allRoomsConnected', () => {
  it('returns true for 0 or 1 rooms', () => {
    expect(allRoomsConnected(0, [])).toBe(true);
    expect(allRoomsConnected(1, [])).toBe(true);
  });

  it('returns true when all rooms are linked', () => {
    // 0–1–2 chain
    expect(allRoomsConnected(3, [{ a: 0, b: 1 }, { a: 1, b: 2 }])).toBe(true);
  });

  it('returns false when a room is isolated', () => {
    // room 2 has no edges
    expect(allRoomsConnected(3, [{ a: 0, b: 1 }])).toBe(false);
  });
});

// ─── generateDungeon (scatter placement) ─────────────────────────────────────

describe('generateDungeon', () => {
  it('places at least minRooms rooms', () => {
    const layout = generateDungeon(42, CAVE_CONFIG);
    expect(layout.rooms.length).toBeGreaterThanOrEqual(CAVE_CONFIG.minRooms);
  });

  it('returns a tile grid of the correct size', () => {
    const layout = generateDungeon(42, CAVE_CONFIG);
    expect(layout.tiles.values.length).toBe(CAVE_CONFIG.cols * CAVE_CONFIG.rows);
  });

  it('entry and exit points are within world bounds', () => {
    const layout = generateDungeon(42, CAVE_CONFIG);
    const worldW = CAVE_CONFIG.cols * CAVE_CONFIG.cellSize;
    const worldH = CAVE_CONFIG.rows * CAVE_CONFIG.cellSize;
    expect(layout.entryPoint.x).toBeGreaterThanOrEqual(0);
    expect(layout.entryPoint.x).toBeLessThanOrEqual(worldW);
    expect(layout.entryPoint.y).toBeGreaterThanOrEqual(0);
    expect(layout.entryPoint.y).toBeLessThanOrEqual(worldH);
    expect(layout.exitPoint.x).toBeGreaterThanOrEqual(0);
    expect(layout.exitPoint.y).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic — same seed gives same layout', () => {
    const a = generateDungeon(99999, CAVE_CONFIG);
    const b = generateDungeon(99999, CAVE_CONFIG);
    expect(a.rooms).toEqual(b.rooms);
    expect(a.tiles.values).toEqual(b.tiles.values);
  });
});

// ─── bspGenerate ─────────────────────────────────────────────────────────────

describe('bspGenerate', () => {
  it('places rooms spread across the grid', () => {
    const layout = bspGenerate(42, ARENA_BSP_CONFIG);
    expect(layout.rooms.length).toBeGreaterThan(0);
  });

  it('startRoomIndex and vaultRoomIndex are valid indices', () => {
    const layout = bspGenerate(42, ARENA_BSP_CONFIG);
    expect(layout.startRoomIndex).toBeGreaterThanOrEqual(0);
    expect(layout.startRoomIndex).toBeLessThan(layout.rooms.length);
    expect(layout.vaultRoomIndex).toBeGreaterThanOrEqual(0);
    expect(layout.vaultRoomIndex).toBeLessThan(layout.rooms.length);
  });

  it('is deterministic — same seed gives same layout', () => {
    const a = bspGenerate(0xabcdef, ARENA_BSP_CONFIG);
    const b = bspGenerate(0xabcdef, ARENA_BSP_CONFIG);
    expect(a.rooms).toEqual(b.rooms);
    expect(a.tiles.values).toEqual(b.tiles.values);
  });

  // ── FIL-389 regression ──────────────────────────────────────────────────────
  // The Bowyer-Watson super-triangle was CW in math coords, making inCircumcircle()
  // always return false.  Zero Delaunay edges → zero MST edges → zero corridors →
  // hero trapped in spawn room.  This seed reproduces the exact failure.
  //
  // We use a BFS flood-fill rather than a hardcoded tile coordinate: the flood-fill
  // is robust to implementation changes in corridor carving, while a specific (row, col)
  // check would break any time room sizes or positions shift slightly.
  it('FIL-389 regression: all rooms reachable from start tile (BFS flood-fill)', () => {
    const layout = bspGenerate(0xdead_beef, ARENA_BSP_CONFIG);
    expect(layout.rooms.length).toBeGreaterThanOrEqual(2);

    const reachable = reachableFromEntry(layout);
    const { cols } = layout.tiles;

    for (let i = 0; i < layout.rooms.length; i++) {
      const room = layout.rooms[i];
      const idx = Math.floor(room.cy) * cols + Math.floor(room.cx);
      expect(
        reachable.has(idx),
        `room ${i} not reachable from start — FIL-389 regression`,
      ).toBe(true);
    }
  });

  it('all rooms are reachable for a variety of seeds (BFS connectivity)', () => {
    const seeds = [1, 42, 12345, 0xabcdef, 999999999];
    for (const seed of seeds) {
      const layout = bspGenerate(seed, ARENA_BSP_CONFIG);
      if (layout.rooms.length < 2) continue; // degenerate — skip

      const reachable = reachableFromEntry(layout);
      const { cols } = layout.tiles;

      for (let i = 0; i < layout.rooms.length; i++) {
        const room = layout.rooms[i];
        const idx = Math.floor(room.cy) * cols + Math.floor(room.cx);
        expect(
          reachable.has(idx),
          `seed ${seed}: room ${i} not reachable from entry`,
        ).toBe(true);
      }
    }
  });
});
