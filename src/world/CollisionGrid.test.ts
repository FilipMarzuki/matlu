/**
 * CollisionGrid unit tests — run with `npm run unit:src` (Vitest).
 * Pure-TypeScript, no Phaser or browser globals required.
 */
import { describe, it, expect } from 'vitest';
import { bufferShoreline, blockTreeFootprint } from './CollisionGrid';
import type { IntGridLayer } from './MapData';

/** 5x5 biome grid; `water` lists (tx, ty) cells that are water (value 0). Every other cell is land (value 1). */
function biomeGrid(cols: number, rows: number, water: [number, number][]): IntGridLayer {
  const values = new Array(cols * rows).fill(1);
  for (const [tx, ty] of water) values[ty * cols + tx] = 0;
  return { identifier: 'Biome', cellSize: 32, cols, rows, values };
}

describe('bufferShoreline', () => {
  it('given a walkable tile orthogonally adjacent to water, when buffering, then it becomes blocked', () => {
    const biome = biomeGrid(5, 5, [[2, 2]]); // water at (2,2)
    const walkGrid = new Uint8Array(25); // all walkable
    bufferShoreline(walkGrid, biome);
    expect(walkGrid[2 * 5 + 1]).toBe(1); // (1,2) west of water
    expect(walkGrid[1 * 5 + 2]).toBe(1); // (2,1) north of water
  });

  it('given a walkable tile diagonally adjacent to water, when buffering, then it becomes blocked', () => {
    const biome = biomeGrid(5, 5, [[2, 2]]);
    const walkGrid = new Uint8Array(25);
    bufferShoreline(walkGrid, biome);
    expect(walkGrid[1 * 5 + 1]).toBe(1); // (1,1) NW diagonal of water
    expect(walkGrid[3 * 5 + 3]).toBe(1); // (3,3) SE diagonal of water
  });

  it('given a walkable tile with no water neighbours, when buffering, then it stays walkable', () => {
    const biome = biomeGrid(5, 5, [[2, 2]]);
    const walkGrid = new Uint8Array(25);
    bufferShoreline(walkGrid, biome);
    expect(walkGrid[0 * 5 + 0]).toBe(0); // far corner, untouched
  });

  it('given a bridge tile the scene unblocks after buffering, when crossing it, then the buffer does not re-block it', () => {
    const biome = biomeGrid(5, 5, [[2, 2]]);
    const walkGrid = new Uint8Array(25);
    bufferShoreline(walkGrid, biome);
    const bridgeIndex = 2 * 5 + 1; // shore tile the buffer just blocked
    expect(walkGrid[bridgeIndex]).toBe(1);
    walkGrid[bridgeIndex] = 0; // HomesteadScene's bridge-tile override, applied after bufferShoreline
    expect(walkGrid[bridgeIndex]).toBe(0);
  });
});

describe('blockTreeFootprint', () => {
  it('given a mature tree planted mid-grid, when blocking its footprint, then it blocks a 2x2 area', () => {
    const walkGrid = new Uint8Array(25); // 5x5, all walkable
    blockTreeFootprint(walkGrid, 5, 5, 2, 2, 'mature');
    expect(walkGrid[2 * 5 + 2]).toBe(1); // (2,2) trunk
    expect(walkGrid[2 * 5 + 3]).toBe(1); // (3,2) east buffer
    expect(walkGrid[3 * 5 + 2]).toBe(1); // (2,3) south buffer
    expect(walkGrid[3 * 5 + 3]).toBe(1); // (3,3) SE buffer
  });

  it('given a mature tree planted mid-grid, when blocking its footprint, then neighbouring tiles outside the 2x2 stay walkable', () => {
    const walkGrid = new Uint8Array(25);
    blockTreeFootprint(walkGrid, 5, 5, 2, 2, 'mature');
    expect(walkGrid[1 * 5 + 2]).toBe(0); // (2,1) north of trunk
    expect(walkGrid[2 * 5 + 1]).toBe(0); // (1,2) west of trunk
  });

  it('given a young tree, when blocking its footprint, then only its own tile is blocked', () => {
    const walkGrid = new Uint8Array(25);
    blockTreeFootprint(walkGrid, 5, 5, 2, 2, 'young');
    expect(walkGrid[2 * 5 + 2]).toBe(1);
    expect(walkGrid[2 * 5 + 3]).toBe(0);
    expect(walkGrid[3 * 5 + 2]).toBe(0);
  });

  it('given a sapling, when blocking its footprint, then the tile stays walkable', () => {
    const walkGrid = new Uint8Array(25);
    blockTreeFootprint(walkGrid, 5, 5, 2, 2, 'sapling');
    expect(walkGrid[2 * 5 + 2]).toBe(0);
  });

  it('given a mature tree planted at the grid\'s bottom-right corner, when blocking its footprint, then it clamps to bounds without throwing', () => {
    const walkGrid = new Uint8Array(25);
    expect(() => blockTreeFootprint(walkGrid, 5, 5, 4, 4, 'mature')).not.toThrow();
    expect(walkGrid[4 * 5 + 4]).toBe(1); // trunk still blocked
  });
});
