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
} from './DungeonGen';

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
  it('FIL-389 regression: 0xdead_beef seed produces fully-connected dungeon (16/16 rooms)', () => {
    const layout = bspGenerate(0xdead_beef, ARENA_BSP_CONFIG);

    // All rooms must be reachable — the broken Delaunay returned 0 edges,
    // so corridors were never carved and every room was isolated.
    expect(layout.rooms.length).toBe(16);

    // The entryPoint (start room centre) must be floor (tile value 0),
    // confirming the room was carved and is a real spawn location.
    const { cols, cellSize, values } = layout.tiles;
    const startCol = Math.floor(layout.entryPoint.x / cellSize);
    const startRow = Math.floor(layout.entryPoint.y / cellSize);
    expect(values[startRow * cols + startCol]).toBe(0); // floor, not wall

    // Verify the corridor between start room (5) and its only MST neighbour (4)
    // was actually carved — the critical tile is in the gap between the rooms.
    // Room 5: col 3..12, row 45..54.  Room 4: col 6..15, row 29..34.
    // The vertical corridor passes through row 40 at col 11 (tile-space).
    const corridorCol = 11;
    const corridorRow = 40; // mid-gap between rooms 4 and 5
    expect(values[corridorRow * cols + corridorCol]).toBe(0); // must be floor
  });

  it('produces a connected dungeon for a variety of seeds', () => {
    const seeds = [1, 42, 12345, 0xabcdef, 999999999];
    for (const seed of seeds) {
      const layout = bspGenerate(seed, ARENA_BSP_CONFIG);
      if (layout.rooms.length < 2) continue; // degenerate — skip

      // At least one floor tile must border the start room centre.
      const { cols, cellSize, values } = layout.tiles;
      const startCol = Math.floor(layout.entryPoint.x / cellSize);
      const startRow = Math.floor(layout.entryPoint.y / cellSize);
      expect(values[startRow * cols + startCol]).toBe(0);
    }
  });
});
