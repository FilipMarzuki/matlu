/**
 * CollisionGrid unit tests — run with `npm run unit:src` (Vitest).
 * Pure-TypeScript, no Phaser or browser globals required.
 */
import { describe, it, expect } from 'vitest';
import { bufferShoreline, blockTreeFootprint, roadOverlayVisible, blockDenseForestZones } from './CollisionGrid';
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

describe('roadOverlayVisible', () => {
  // Road runs along ty=2 from tx=0..4; the bridge sits at (2,2). Tiles
  // (1,2) and (3,2) are the banks immediately beside the bridge — the ones
  // #931 reports as a gap when the Biome layer marks them as water.
  const isRoad = (tx: number, ty: number) => ty === 2 && tx >= 0 && tx <= 4;
  const isBridgeTile = (tx: number, ty: number) => tx === 2 && ty === 2;

  it('given a bank tile beside the bridge classified as water, when checking overlay visibility, then it renders', () => {
    const isWater = (tx: number, ty: number) => tx === 1 && ty === 2;
    expect(roadOverlayVisible(1, 2, isRoad, isWater, isBridgeTile)).toBe(true);
  });

  it('given a water-classified road tile not adjacent to any bridge tile, when checking overlay visibility, then it stays hidden', () => {
    const isWater = (tx: number, ty: number) => tx === 0 && ty === 2;
    expect(roadOverlayVisible(0, 2, isRoad, isWater, isBridgeTile)).toBe(false);
  });

  it('given an ordinary land road tile, when checking overlay visibility, then it renders', () => {
    const isWater = () => false;
    expect(roadOverlayVisible(4, 2, isRoad, isWater, isBridgeTile)).toBe(true);
  });

  it('given the bridge tile itself, when checking overlay visibility, then it stays hidden (bridge renders separately)', () => {
    const isWater = (tx: number, ty: number) => tx === 2 && ty === 2;
    expect(roadOverlayVisible(2, 2, isRoad, isWater, isBridgeTile)).toBe(false);
  });

  it('given a tile that is not on the road at all, when checking overlay visibility, then it stays hidden', () => {
    const isWater = () => false;
    expect(roadOverlayVisible(1, 3, isRoad, isWater, isBridgeTile)).toBe(false);
  });
});

/** 10x10 candidate mask; `dense` lists (tx, ty) cells flagged as dense-canopy candidates. */
function canopyMask(cols: number, rows: number, dense: [number, number][]): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  for (const [tx, ty] of dense) mask[ty * cols + tx] = 1;
  return mask;
}

/** Fills every (tx, ty) in a rectangle [x0, x1] x [y0, y1] (inclusive). */
function rect(x0: number, x1: number, y0: number, y1: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) cells.push([tx, ty]);
  }
  return cells;
}

describe('blockDenseForestZones', () => {
  it('given a contiguous dense-canopy cluster at or above the size threshold, when flood-filling, then every tile in it becomes blocked', () => {
    const cluster = rect(2, 5, 2, 5); // 4x4 = 16 tiles
    const mask = canopyMask(10, 10, cluster);
    const walkGrid = new Uint8Array(100);
    blockDenseForestZones(walkGrid, mask, 10, 10, 12);
    for (const [tx, ty] of cluster) expect(walkGrid[ty * 10 + tx]).toBe(1);
  });

  it('given a dense-canopy cluster below the size threshold, when flood-filling, then it stays walkable', () => {
    const smallCluster = rect(2, 3, 2, 3); // 2x2 = 4 tiles
    const mask = canopyMask(10, 10, smallCluster);
    const walkGrid = new Uint8Array(100);
    blockDenseForestZones(walkGrid, mask, 10, 10, 12);
    for (const [tx, ty] of smallCluster) expect(walkGrid[ty * 10 + tx]).toBe(0);
  });

  it('given two dense clusters separated by a one-tile gap, when flood-filling, then the gap stays walkable as a clearing', () => {
    const west = rect(0, 3, 0, 3);  // 4x4 = 16 tiles
    const east = rect(5, 8, 0, 3);  // 4x4 = 16 tiles, gap at tx=4
    const mask = canopyMask(10, 10, [...west, ...east]);
    const walkGrid = new Uint8Array(100);
    blockDenseForestZones(walkGrid, mask, 10, 10, 12);
    for (const [tx, ty] of [...west, ...east]) expect(walkGrid[ty * 10 + tx]).toBe(1);
    for (let ty = 0; ty <= 3; ty++) expect(walkGrid[ty * 10 + 4]).toBe(0); // the clearing
  });

  it('given a tile outside the candidate mask, when flood-filling, then it is never blocked regardless of neighbours', () => {
    const cluster = rect(0, 9, 0, 3); // spans the full width
    const mask = canopyMask(10, 10, cluster);
    const walkGrid = new Uint8Array(100);
    blockDenseForestZones(walkGrid, mask, 10, 10, 12);
    for (let tx = 0; tx < 10; tx++) expect(walkGrid[4 * 10 + tx]).toBe(0); // row below the cluster, untouched
  });
});
