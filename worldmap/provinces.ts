/**
 * Provinces outside the Reach (#1904, plan: docs/spikes/artificer-hex-world.md §7 The world-builder
 * link). Step 11 of 17 of the hex world (#1873).
 *
 * Inside the Reach nothing changes: `provincesOf` (`src/artificer/world/provinces.ts`) still splits
 * it by cell. Outside, the hex itself is the unit: a province is a cluster of about three hexes,
 * seated on the hex graph and grown by hex walking cost, the same idea one level up. The hex
 * neighbour graph becomes the history engine's neighbour graph with no coordinates
 * (`storytelling/geography.ts`), so an `OuterProvince` carries no cells, only its hexes.
 *
 * `worldmap/` is the world both games read, so this stays self-contained: no import from either
 * game (src/). Culture is a plain id from `macro-world/cultures.json` (cultures are race-agnostic,
 * CLAUDE.md); only the four with land affinity so far (mountainhold, waterstead, fieldborn,
 * ridgefolk) are placed here. Pure and deterministic, like the rest of the world: the same seed
 * always gives the same provinces. Its own stream (`seed|hexworld|provinces`) keeps the Reach's
 * provinces (`seed|world|provinces`) and the rest of the hex world untouched.
 */

import { cellsOfHex, hexDistance, hexKey, HEX_DIRS, type CellXY, type Hex } from './coords';
import { worldCell } from './cells';
import { COST, type Biome } from './reach';
import { hexSummary, KNOWN_RADIUS, SETTLE } from './hex-summary';
import { generator, seedOf } from './rng';

/** The hand-written villages' hexes on the road south (#1905): always seats `h0`, `h1`, `h2`. */
const ROAD_SEAT_HEXES: readonly Hex[] = [{ q: 0, r: 2 }, { q: 0, r: 4 }, { q: 0, r: 6 }];

/**
 * Hexes beyond radius `KNOWN_RADIUS` that the road still needs (#1905): the road runs on to
 * Mistheim at hex (0, 8), so the known world must cover the hexes leading up to it. (0, 6) is also
 * a road seat, already listed above; it isn't repeated here.
 */
const ROAD_FAR_HEXES: readonly Hex[] = [{ q: 0, r: 5 }, { q: 0, r: 7 }];

/** Every hex of the known world: radius `KNOWN_RADIUS` of (0,0), plus the road's hexes beyond it. 64 hexes. */
export const KNOWN_HEXES: readonly Hex[] = (() => {
  const out: Hex[] = [];
  for (let q = -KNOWN_RADIUS; q <= KNOWN_RADIUS; q++)
    for (let r = -KNOWN_RADIUS; r <= KNOWN_RADIUS; r++) {
      const h = { q, r };
      if (hexDistance(h, { q: 0, r: 0 }) <= KNOWN_RADIUS) out.push(h);
    }
  return [...out, ROAD_SEAT_HEXES[2], ...ROAD_FAR_HEXES];
})();

/**
 * The hexes with at least half their cells inside the Reach rectangle (per #1894's counts). Their
 * provinces are the Reach's own (`provincesOf`); this module never touches them.
 */
export const REACH_HEXES: readonly Hex[] = [
  { q: 0, r: 0 }, { q: -1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 }, { q: -1, r: 1 }, { q: 1, r: 0 },
];

/** Every known-world hex outside the Reach: 64 − 6 = 58. These are what `outerProvinces` splits up. */
export const OUTER_HEXES: readonly Hex[] = (() => {
  const reach = new Set(REACH_HEXES.map(hexKey));
  return KNOWN_HEXES.filter(h => !reach.has(hexKey(h)));
})();

/** The cultures.json ids with land affinity data today (`src/artificer/world/peoples.ts`'s `REACH_CULTURES`, minus `wallborn`, seated only at the Gate). */
export type OuterCulture = 'mountainhold' | 'waterstead' | 'fieldborn' | 'ridgefolk';

export interface OuterProvince {
  /** `h0`, `h1`… in the order the seats were picked: the three road seats first, then the rest, best first. */
  id: string;
  seat: Hex;
  /** The seat hex's best cell to settle (`hexSummary`'s), where its village sits. */
  seatCell: CellXY;
  /** The province's hexes, in (q, r) order. */
  hexes: Hex[];
  /** Other provinces' ids sharing a hex border, in id order. */
  neighbors: string[];
  culture: OuterCulture;
}

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** A lake or river beside the cell makes it a better seat: a copy of hex-summary.ts's unexported WATER_BONUS. */
const WATER_BONUS = 0.5;

/**
 * The score `hexSummary`'s seat-picker gave this cell (it doesn't export the score, only the
 * winning cell), so a hex's seats can be ranked against each other.
 */
function seatScore(seed: number, seat: CellXY): number {
  // hexSummary only ever returns a seat whose biome has a SETTLE value: that's why it won.
  const base = SETTLE[worldCell(seed, seat).biome]!;
  const watered = STEPS.some(([dx, dy]) => {
    const b = worldCell(seed, { cx: seat.cx + dx, cy: seat.cy + dy }).biome;
    return b === 'lake' || b === 'river';
  });
  return base + (watered ? WATER_BONUS : 0);
}

/**
 * The best cell of the hex to settle, or the hex's first cell if none scores (all lake, river or
 * snow): every province needs somewhere to put its village.
 */
function seatCellOf(seed: number, h: Hex): CellXY {
  return hexSummary(seed, h).seat ?? cellsOfHex(h)[0];
}

/**
 * Seats for the outer provinces: the three road seats first (`h0`, `h1`, `h2`), then the rest of
 * the target taken best first by score, each at least two hexes from every seat already chosen.
 * Noise is drawn once per outer hex in `OUTER_HEXES` order, before any of this filtering, so the
 * stream never depends on which hexes turn out to qualify.
 */
function pickSeats(seed: number): Hex[] {
  const rnd = generator(seedOf(`${seed}|hexworld|provinces`));
  const roadKeys = new Set(ROAD_SEAT_HEXES.map(hexKey));
  const posOf = new Map(OUTER_HEXES.map((h, i) => [hexKey(h), i]));

  const candidates: { h: Hex; score: number }[] = [];
  for (const h of OUTER_HEXES) {
    const noise = rnd();
    if (roadKeys.has(hexKey(h))) continue;
    const seat = hexSummary(seed, h).seat;
    if (!seat) continue; // a hex whose summary has no seat can't be one
    candidates.push({ h, score: seatScore(seed, seat) + 0.3 * noise });
  }
  candidates.sort((a, b) => b.score - a.score || posOf.get(hexKey(a.h))! - posOf.get(hexKey(b.h))!);

  const seats = [...ROAD_SEAT_HEXES];
  const target = Math.round(OUTER_HEXES.length / 3);
  for (const { h } of candidates) {
    if (seats.length >= target) break;
    if (seats.some(s => hexDistance(s, h) < 2)) continue;
    seats.push(h);
  }
  return seats;
}

/** Over the biomes of all the province's cells, first match wins. */
function cultureOf(biomes: readonly Biome[]): OuterCulture {
  const share = (...bs: Biome[]) => biomes.filter(b => bs.includes(b)).length / biomes.length;
  if (share('fell', 'snow') >= 0.3) return 'mountainhold';
  if (share('lake', 'marsh') >= 0.25) return 'waterstead';
  if (share('meadow', 'heath') >= 0.4) return 'fieldborn';
  return 'ridgefolk';
}

/**
 * Split the 58 outer hexes into provinces seated and grown as `pickSeats` and the module doc
 * describe. A multi-source Dijkstra over the outer-hex graph (6-neighbour adjacency, step cost the
 * mean `COST` of a hex's non-lake cells) claims every hex that has any non-lake land; an all-lake
 * hex is left for a breadth-first flood from the claimed hexes afterwards, same as `provincesOf`
 * does with lake cells. Both stages break a tie by the lower province index.
 */
export function outerProvinces(seed: number): OuterProvince[] {
  const seats = pickSeats(seed);
  const n = OUTER_HEXES.length;
  const idxOf = new Map(OUTER_HEXES.map((h, i) => [hexKey(h), i]));
  const neighborIdxs = (i: number): number[] => {
    const h = OUTER_HEXES[i];
    const out: number[] = [];
    for (const d of Object.values(HEX_DIRS)) {
      const j = idxOf.get(hexKey({ q: h.q + d.q, r: h.r + d.r }));
      if (j !== undefined) out.push(j);
    }
    return out;
  };

  // Each outer hex's cells' biomes, read once: hexCost (below) and a province's culture both need them.
  const cellBiomes: Biome[][] = OUTER_HEXES.map(h => cellsOfHex(h).map(c => worldCell(seed, c).biome));
  const hexCost = cellBiomes.map(biomes => {
    const land = biomes.filter(b => b !== 'lake');
    return land.length ? land.reduce((sum, b) => sum + COST[b], 0) / land.length : Infinity;
  });

  const dist = new Array<number>(n).fill(Infinity);
  const at = new Array<number>(n).fill(-1);
  seats.forEach((s, p) => {
    const i = idxOf.get(hexKey(s))!;
    dist[i] = 0;
    at[i] = p;
  });
  const done = new Uint8Array(n);
  for (;;) {
    let i = -1;
    for (let j = 0; j < n; j++) if (!done[j] && dist[j] < Infinity && (i === -1 || dist[j] < dist[i])) i = j;
    if (i === -1) break;
    done[i] = 1;
    for (const j of neighborIdxs(i)) {
      if (!Number.isFinite(hexCost[j])) continue; // an all-lake hex: not crossed, assigned afterwards
      const d = dist[i] + hexCost[j];
      if (d < dist[j] || (d === dist[j] && at[i] < at[j])) {
        dist[j] = d;
        at[j] = at[i];
      }
    }
  }

  // All-lake hexes: each goes to the province of its first claimed neighbour, a breadth-first
  // flood out from the hexes the Dijkstra above claimed. A tie within a round goes to the lower
  // province index, same as the Dijkstra.
  let frontier = at.map((p, i) => (p >= 0 ? i : -1)).filter(i => i >= 0);
  while (frontier.length) {
    const claims = new Map<number, number>();
    for (const i of frontier) {
      for (const j of neighborIdxs(i)) {
        if (at[j] >= 0) continue;
        const p = at[i];
        const cur = claims.get(j);
        if (cur === undefined || p < cur) claims.set(j, p);
      }
    }
    for (const [j, p] of claims) at[j] = p;
    frontier = [...claims.keys()];
  }

  const hexesOf: Hex[][] = seats.map(() => []);
  at.forEach((p, i) => { if (p >= 0) hexesOf[p].push(OUTER_HEXES[i]); });

  const touching: Set<number>[] = seats.map(() => new Set());
  for (let i = 0; i < n; i++) {
    for (const j of neighborIdxs(i)) if (at[i] !== at[j]) { touching[at[i]].add(at[j]); touching[at[j]].add(at[i]); }
  }

  return seats.map((seat, p): OuterProvince => ({
    id: `h${p}`,
    seat,
    seatCell: seatCellOf(seed, seat),
    hexes: [...hexesOf[p]].sort((a, b) => a.q - b.q || a.r - b.r),
    neighbors: [...touching[p]].sort((a, b) => a - b).map(k => `h${k}`),
    culture: cultureOf(hexesOf[p].flatMap(h => cellBiomes[idxOf.get(hexKey(h))!])),
  }));
}
