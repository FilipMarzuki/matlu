import { describe, it, expect } from 'vitest';
import {
  HEX_DIRS,
  cellOfTile,
  tileInCell,
  cellOrigin,
  hexCentre,
  hexOfCell,
  hexOfTile,
  hexDistance,
  cellsOfHex,
  packCell,
  unpackCell,
  type CellXY,
  type Hex,
} from './coords';

/** Every hex within `hexDistance <= radius` of the origin, by ring expansion over the six HEX_DIRS. */
function hexesWithin(radius: number): Hex[] {
  const seen = new Map<string, Hex>();
  seen.set('0,0', { q: 0, r: 0 });
  let frontier: Hex[] = [{ q: 0, r: 0 }];
  for (let ring = 0; ring < radius; ring++) {
    const next: Hex[] = [];
    for (const h of frontier)
      for (const d of Object.values(HEX_DIRS)) {
        const n = { q: h.q + d.q, r: h.r + d.r };
        const key = `${n.q},${n.r}`;
        if (!seen.has(key)) {
          seen.set(key, n);
          next.push(n);
        }
      }
    frontier = next;
  }
  return [...seen.values()];
}

describe('worldmap/coords (#1894)', () => {
  it('given tiles (0,0), (2047,2047), (2048,0), (-1,-1), cellOfTile and tileInCell round-trip through cellOrigin', () => {
    const tiles: Array<[number, number]> = [
      [0, 0],
      [2047, 2047],
      [2048, 0],
      [-1, -1],
    ];
    const expectedCells: CellXY[] = [
      { cx: 0, cy: 0 },
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
      { cx: -1, cy: -1 },
    ];
    const expectedLocals = [
      { lx: 0, ly: 0 },
      { lx: 2047, ly: 2047 },
      { lx: 0, ly: 0 },
      { lx: 2047, ly: 2047 },
    ];
    tiles.forEach(([tx, ty], i) => {
      const cell = cellOfTile(tx, ty);
      const local = tileInCell(tx, ty);
      expect(cell).toEqual(expectedCells[i]);
      expect(local).toEqual(expectedLocals[i]);
      const origin = cellOrigin(cell);
      expect({ tx: origin.tx + local.lx, ty: origin.ty + local.ly }).toEqual({ tx, ty });
    });
  });

  it('given every cell with -40 <= cx, cy < 40, unpackCell(packCell(c)) round-trips and matches hexOfTile at its origin', () => {
    for (let cx = -40; cx < 40; cx++)
      for (let cy = -40; cy < 40; cy++) {
        const c = { cx, cy };
        expect(unpackCell(packCell(c))).toEqual(c);
        const origin = cellOrigin(c);
        expect(hexOfTile(origin.tx, origin.ty)).toEqual(hexOfCell(c));
      }
  });

  it('given any hex within distance 4 of (0,0), its six HEX_DIRS neighbours are distance 1 and distinct', () => {
    for (const h of hexesWithin(4)) {
      const neighbours = Object.values(HEX_DIRS).map(d => ({ q: h.q + d.q, r: h.r + d.r }));
      for (const n of neighbours) expect(hexDistance(h, n)).toBe(1);
      const keys = new Set(neighbours.map(n => `${n.q},${n.r}`));
      expect(keys.size).toBe(6);
    }
  });

  it('given every hex within distance 4 of (0,0) (61 hexes), cellsOfHex partitions cells 204-216 per hex with no overlap', () => {
    const hexes = hexesWithin(4);
    expect(hexes.length).toBe(61);
    const owner = new Map<string, string>();
    for (const h of hexes) {
      const cells = cellsOfHex(h);
      expect(cells.length).toBeGreaterThanOrEqual(204);
      expect(cells.length).toBeLessThanOrEqual(216);
      for (const cell of cells) {
        expect(hexOfCell(cell)).toEqual(h);
        const key = `${cell.cx},${cell.cy}`;
        expect(owner.has(key)).toBe(false);
        owner.set(key, `${h.q},${h.r}`);
      }
    }
  });

  it('given the Reach cell (24, 19), hexOfCell is the origin hex and hexCentre is HEX_ORIGIN', () => {
    expect(hexOfCell({ cx: 24, cy: 19 })).toEqual({ q: 0, r: 0 });
    expect(hexCentre({ q: 0, r: 0 })).toEqual({ x: 24.5, y: 19.5 });
  });

  it('given the cells (47, 31) and (-1, -1), hexOfCell never returns -0 for q or r', () => {
    for (const c of [{ cx: 47, cy: 31 }, { cx: -1, cy: -1 }]) {
      const h = hexOfCell(c);
      expect(Object.is(h.q, -0)).toBe(false);
      expect(Object.is(h.r, -0)).toBe(false);
    }
    expect(hexOfCell({ cx: 47, cy: 31 })).toEqual({ q: 2, r: 0 });
  });

  it('given the Reach rectangle (0 <= cx < 48, 0 <= cy < 32), the footprint matches the pinned counts', () => {
    const counts = new Map<string, number>();
    for (let cx = 0; cx < 48; cx++)
      for (let cy = 0; cy < 32; cy++) {
        const h = hexOfCell({ cx, cy });
        const key = `${h.q},${h.r}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    expect(counts.get('0,0')).toBe(205);
    expect(counts.get('-1,0')).toBe(210);
    expect(counts.get('1,-1')).toBe(211);
    expect(counts.get('0,1')).toBe(57);
  });
});
