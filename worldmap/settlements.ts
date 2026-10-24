/**
 * Settlements from the shared world (#1910, plan: docs/spikes/artificer-hex-world.md §7
 * "Villages"). Step 17 of 17 of the hex world (#1873).
 *
 * One mapgen settlement sits at each outer province's seat, built the same way
 * `src/artificer/world/settlements.ts` builds the Reach's own: `mapgen/SettlementGenerator.ts`'s
 * `generateSettlement` picks a purpose, tier and building programme from the site, and
 * `mapgen/SettlementPlacement.ts`'s `placeBuildings` lays them out on a grid. `mapgen/` sits at the
 * repo root (not under src/), so worldmap/ may import it without reaching into either game.
 *
 * Core Warden draws that grid on tiles at `MAPGEN_TILE` tiles per grid square, so a 3 × 3 hut is
 * 6 m and a 20–60-square village is 40–120 m (the issue's numbers). Nothing else reads the grid in
 * world units: the Artificer, if it ever draws outer settlements as text, would read the same
 * `ProvinceSettlement.buildings` in grid squares, untouched.
 *
 * Pure and seeded from `seedOf(\`${seed}|hexworld|settlement:${province.id}\`)`, so the same seed
 * always builds the same village, generated lazily the first time a caller asks for it.
 */

import { generateSettlement, type BuildingRegistryEntry, type CultureDef, type MapgenData } from '../mapgen/SettlementGenerator';
import { placeBuildings, type PlacedBuilding, type RoadTile, type StreetPattern } from '../mapgen/SettlementPlacement';
import type { AdjacentResource, Geography, SettlementPurpose, SettlementSite, SettlementTier, SiteFeature } from '../mapgen/SettlementSpec';
import buildingRegistry from '../public/macro-world/building-registry.json';
import culturesData from '../macro-world/cultures.json';
import { CELL_TILES, cellOrigin, type Tile } from './coords';
import { worldCell } from './cells';
import type { Biome } from './reach';
import { hexName } from './hex-names';
import { generator, seedOf } from './rng';
import type { OuterProvince } from './provinces';

/** `provinces.ts`'s three road seats (`h0`, `h1`, `h2`), always first by its own doc comment: a copy of its unexported `ROAD_SEAT_HEXES`'s ids, not its hexes, so this needs no new export there. */
const ROAD_SEAT_IDS: ReadonlySet<string> = new Set(['h0', 'h1', 'h2']);

/** Tiles (≈1 m) per mapgen grid square: a 3 × 3 hut is 6 m, a 20–60-square village 40–120 m. */
export const MAPGEN_TILE = 2;

/** The forge's data, as mapgen takes it: cultures' layout styles and the building registry. */
const DATA: MapgenData = {
  cultures: culturesData.cultures as CultureDef[],
  buildings: (buildingRegistry.buildings as unknown[]).filter((b): b is BuildingRegistryEntry => typeof b === 'object' && b !== null && 'id' in b),
};

/** The engine's placement tile size (world pixels): a copy of `src/artificer/world/settlements.ts`'s `TILE`, used only to turn `spec.radius` into grid squares. Unrelated to `MAPGEN_TILE`. */
const TILE = 32;
/** Where each zone of buildings sits, as fractions of the settlement's radius: `src/artificer/world/settlements.ts`'s `ZONE_FRAC`. */
const ZONE_FRAC = { inner: { min: 0.1, max: 0.38 }, middle: { min: 0.38, max: 0.65 }, outer: { min: 0.65, max: 0.9 } };

/** A biome's geography, for `generateSettlement`'s site: a copy of `src/artificer/world/settlements.ts`'s `GEOGRAPHY` (worldmap/ may not import src/). */
const GEOGRAPHY: Readonly<Record<Biome, Geography>> = {
  meadow: 'plains', heath: 'plains', birch: 'forest', pine: 'forest', marsh: 'wetland', river: 'plains', lake: 'coastal', scree: 'mountain', fell: 'tundra', snow: 'tundra',
};

/** What each kind of land beside a seat gives a settlement: a copy of `src/artificer/world/settlements.ts`'s `RESOURCES`. */
const RESOURCES: Readonly<Record<Biome, readonly AdjacentResource[]>> = {
  meadow: ['fertile-soil'], heath: ['game'], birch: ['timber', 'game'], pine: ['timber'], marsh: ['peat'], river: [], lake: ['fish'], scree: ['stone'], fell: ['stone', 'ore'], snow: [],
};

const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** An outer province's seat as a mapgen site: the same reading `src/artificer/world/settlements.ts`'s `siteOf` does for the Reach, with no anchors or economy (outer provinces have neither yet). */
function siteOf(seed: number, p: OuterProvince): SettlementSite {
  const { seatCell } = p;
  const seatBiome = worldCell(seed, seatCell).biome;
  const around: Biome[] = [];
  for (const [dx, dy] of STEPS) around.push(worldCell(seed, { cx: seatCell.cx + dx, cy: seatCell.cy + dy }).biome);
  const beside = (b: Biome) => around.includes(b);
  const isRoadSeat = ROAD_SEAT_IDS.has(p.id);
  const features: SiteFeature[] = [];
  if (beside('river')) features.push('river-crossing');
  if (isRoadSeat) features.push('trade-route');
  const gives = (r: AdjacentResource) => around.filter(b => RESOURCES[b].includes(r)).length >= (r === 'fish' ? 1 : 2);
  const resources = (['fish', 'fertile-soil', 'timber', 'game', 'peat', 'stone', 'ore'] as const).filter(gives);
  return {
    x: seatCell.cx,
    y: seatCell.cy,
    geography: beside('lake') ? 'coastal' : GEOGRAPHY[seatBiome],
    features,
    adjacentResources: [...resources].sort(),
    nearCorruption: false,
    tradeRouteCount: isRoadSeat ? 1 : 0,
    nearbySettlements: p.neighbors.length,
    cultureId: p.culture,
  };
}

export interface ProvinceSettlement {
  /** The hex's own name (`hex-names.ts`), the same one the Artificer gives it. */
  name: string;
  culture: OuterProvince['culture'];
  tier: SettlementTier;
  purpose: SettlementPurpose;
  /** The placement grid's side, in `MAPGEN_TILE`-tile squares. */
  gridSize: number;
  buildings: readonly PlacedBuilding[];
  roads: readonly RoadTile[];
}

/** The last few provinces' settlements, by `${seed}|${province.id}`: pure in (seed, province), so keeping them changes no answer, only how fast a second ask for the same village comes back. */
const MEMO_SIZE = 8;
const memo = new Map<string, ProvinceSettlement>();

/** Build one outer province's settlement: generate, lay it out, done when — see the module doc. */
export function settlementForProvince(seed: number, province: OuterProvince): ProvinceSettlement {
  const key = `${seed}|${province.id}`;
  const hit = memo.get(key);
  if (hit) return hit;

  const name = hexName(seed, province.seat, 'en');
  const settlementSeed = seedOf(`${seed}|hexworld|settlement:${province.id}`);
  const rnd = generator(settlementSeed);
  const site = siteOf(seed, province);
  const { spec, buildings } = generateSettlement(site, name, rnd, DATA);
  const culture = DATA.cultures.find(c => c.id === province.culture);
  const radiusTiles = spec.radius / TILE;
  const gridSize = Math.ceil(radiusTiles) * 3 + 8;
  const placed = placeBuildings({
    buildings, radiusTiles, gridSize, tileSize: TILE, seed: settlementSeed, zoneFracs: ZONE_FRAC,
    streetPattern: (culture?.streetPattern ?? 'organic') as StreetPattern,
  });

  const result: ProvinceSettlement = {
    name, culture: province.culture, tier: spec.tier, purpose: spec.purpose,
    gridSize, buildings: placed.buildings, roads: placed.roads,
  };
  const oldest = memo.keys().next();
  if (memo.size >= MEMO_SIZE && !oldest.done) memo.delete(oldest.value);
  memo.set(key, result);
  return result;
}

/**
 * Where grid square (0, 0) of `settlement` sits in world tiles: the seat cell's centre tile minus
 * half the grid's side (in `MAPGEN_TILE` tiles) — the same `mid = floor(gridSize / 2)`
 * `placeBuildings` centres its own grid on, so a building's grid (tx, ty) maps to world tile
 * `origin.tx + tx * MAPGEN_TILE, origin.ty + ty * MAPGEN_TILE`.
 */
export function settlementTileOrigin(province: OuterProvince, settlement: ProvinceSettlement): Tile {
  const seatOrigin = cellOrigin(province.seatCell);
  const mid = Math.floor(settlement.gridSize / 2);
  return {
    tx: seatOrigin.tx + CELL_TILES / 2 - mid * MAPGEN_TILE,
    ty: seatOrigin.ty + CELL_TILES / 2 - mid * MAPGEN_TILE,
  };
}

// Re-exported so a caller never needs a separate import just to type a building or road it reads
// off `ProvinceSettlement`.
export type { PlacedBuilding, RoadTile };
