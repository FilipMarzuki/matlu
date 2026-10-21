/**
 * World coordinates (#1894): one world coordinate in tiles (~1 m), with cells
 * (2048 tiles, ~2 km, = today's Reach cell) and flat-top hexes (~30 km, 9 cells
 * centre to corner) derived from it.
 *
 * Determinism: only `+ − × ÷`, `Math.floor/round/abs/sqrt` are used here, and
 * every one of them is exactly specified, so every browser and Node agree to
 * the bit. No `Math.sin/cos/atan2` goes into hex or cell ownership.
 */

/** World tile, integers (≈1 m). The one world coordinate. */
export interface Tile {
  tx: number;
  ty: number;
}

/** World cell, integers. Inside the Reach it IS the Reach's (x, y): world cell (0,0) = Reach cell (0,0). */
export interface CellXY {
  cx: number;
  cy: number;
}

/** Axial, flat-top. */
export interface Hex {
  q: number;
  r: number;
}

export const CELL_TILES = 2048;
export const HEX_SIZE = 9; // cells, centre to corner
export const HEX_ORIGIN = { x: 24.5, y: 19.5 }; // cell space: centre of Reach cell (24, 19)

const SQRT3 = Math.sqrt(3); // correctly rounded per ECMAScript: same in every engine

export const cellOfTile = (tx: number, ty: number): CellXY => ({
  cx: Math.floor(tx / CELL_TILES),
  cy: Math.floor(ty / CELL_TILES),
}); // floor: right for negatives

export const tileInCell = (tx: number, ty: number): { lx: number; ly: number } => ({
  lx: tx - Math.floor(tx / CELL_TILES) * CELL_TILES,
  ly: ty - Math.floor(ty / CELL_TILES) * CELL_TILES,
}); // 0..2047

export const cellOrigin = (c: CellXY): Tile => ({ tx: c.cx * CELL_TILES, ty: c.cy * CELL_TILES });

/** A hex's centre in cell space (continuous). */
export function hexCentre(h: Hex): { x: number; y: number } {
  return { x: HEX_ORIGIN.x + HEX_SIZE * 1.5 * h.q, y: HEX_ORIGIN.y + HEX_SIZE * SQRT3 * (h.r + h.q / 2) };
}

/** The hex a cell-space point lies in. */
export function hexOfPoint(x: number, y: number): Hex {
  const dx = (x - HEX_ORIGIN.x) / HEX_SIZE;
  const dy = (y - HEX_ORIGIN.y) / HEX_SIZE;
  return cubeRound((2 / 3) * dx, (-1 / 3) * dx + (SQRT3 / 3) * dy);
}

/** A cell belongs to the hex its centre lies in, so a cell is never split between hexes. */
export const hexOfCell = (c: CellXY): Hex => hexOfPoint(c.cx + 0.5, c.cy + 0.5);
export const hexOfTile = (tx: number, ty: number): Hex => hexOfCell(cellOfTile(tx, ty));

export function cubeRound(q: number, r: number): Hex {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // Normalise -0 (e.g. Math.round(-0.3) === -0, or -rr - rs landing on -0): callers
  // compare with toEqual, which treats -0 and 0 as different values.
  return { q: rq + 0, r: rr + 0 };
}

export const HEX_DIRS = {
  n: { q: 0, r: -1 },
  ne: { q: 1, r: -1 },
  se: { q: 1, r: 0 },
  s: { q: 0, r: 1 },
  sw: { q: -1, r: 1 },
  nw: { q: -1, r: 0 },
} as const;

export const hexDistance = (a: Hex, b: Hex): number =>
  (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;

export const hexKey = (h: Hex): string => `${h.q},${h.r}`;

/** The cells a hex owns, row by row: its bounding box filtered by `hexOfCell`. 204–216 cells. */
export function cellsOfHex(h: Hex): CellXY[] {
  const c = hexCentre(h);
  const half = (SQRT3 / 2) * HEX_SIZE;
  const out: CellXY[] = [];
  for (let cy = Math.floor(c.y - half) - 1; cy <= Math.ceil(c.y + half); cy++)
    for (let cx = Math.floor(c.x - HEX_SIZE) - 1; cx <= Math.ceil(c.x + HEX_SIZE); cx++) {
      const o = hexOfCell({ cx, cy });
      if (o.q === h.q && o.r === h.r) out.push({ cx, cy });
    }
  return out;
}

/** A world cell as one save-friendly integer (±32,768 cells ≈ ±65,000 km is plenty). */
export const packCell = (c: CellXY): number => (c.cx + 32768) * 65536 + (c.cy + 32768);
export const unpackCell = (n: number): CellXY => ({ cx: Math.floor(n / 65536) - 32768, cy: (n % 65536) - 32768 });
