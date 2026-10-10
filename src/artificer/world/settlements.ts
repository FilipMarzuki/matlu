/**
 * The Reach's settlements (#1541, plan: docs/spikes/artificer-generated-world.md).
 *
 * One settlement at each province's seat, made by the settlement generator the Homestead's
 * Settlement Forge uses (`mapgen/`): `generateSettlement` picks a purpose, a size and a programme
 * of buildings from the site, and `placeBuildings` lays them out with roads on a tile grid. The
 * Artificer draws that grid as text, a letter per building.
 *
 * The site is read off the Reach grid: the land at the seat, a river or lake beside it, what the
 * cells around it yield, the province's culture. The three hand-written villages (provinces.ts
 * seats them) are settlements too, with their own people placed in the buildings that suit them.
 *
 * The buildings and each culture's way of laying out a town come from the forge's own files
 * (`public/macro-world/building-registry.json`, `macro-world/cultures.json`), so a building edited
 * in the Building Forge shows up here: the owner's call (2026-10-10). Pure and seeded, so the same
 * seed always builds the same towns.
 */

import { generateSettlement, type BuildingRegistryEntry, type CultureDef, type MapgenData, type ResolvedBuilding } from '../../../mapgen/SettlementGenerator';
import { placeBuildings, footprintTiles, type StreetPattern } from '../../../mapgen/SettlementPlacement';
import type { AdjacentResource, Geography, SettlementSite, SettlementTier, SiteFeature, SettlementPurpose } from '../../../mapgen/SettlementSpec';
import buildingRegistry from '../../../public/macro-world/building-registry.json';
import culturesData from '../../../macro-world/cultures.json';
import { generator, seedOf } from '../rng';
import { VILLAGES, type Person, type Role } from '../villages';
import type { Biome, Reach } from './reach';
import type { Province } from './provinces';
import type { ReachCulture } from './peoples';

/** The forge's data, as mapgen takes it: cultures' layout styles and the building registry. */
const DATA: MapgenData = {
  cultures: culturesData.cultures as CultureDef[],
  buildings: (buildingRegistry.buildings as unknown[]).filter((b): b is BuildingRegistryEntry => typeof b === 'object' && b !== null && 'id' in b),
};

export interface SettlementBuilding {
  /** The letter it's drawn with on the settlement's grid. */
  letter: string;
  id: string;
  name: string;
  role: string;
  /** The registry's line about it, for the tap. */
  lore: string;
  /** Hand-written villagers who live or work here (anchors only). */
  people: string[];
}

export interface Settlement {
  provinceId: string;
  name: string;
  anchor?: Province['anchor'];
  tier: SettlementTier;
  purpose: SettlementPurpose;
  culture: ReachCulture;
  /** Rows of text: '.' open ground, '=' a main road, '-' a lane, a letter for each building. */
  rows: string[];
  buildings: SettlementBuilding[];
  /** Hand-written villagers with no building that suits them: they're about the place. */
  about: string[];
}

/** What each tier is called. */
export const TIER_NAME: Readonly<Record<SettlementTier, string>> = { 1: 'outpost', 2: 'hamlet', 3: 'village', 4: 'town', 5: 'city' };

/** The engine's tile size: radii come in world pixels, 32 to a tile. */
const TILE = 32;
/** Where each zone of buildings sits, as fractions of the settlement's radius (the forge's values). */
const ZONE_FRAC = { inner: { min: 0.1, max: 0.38 }, middle: { min: 0.38, max: 0.65 }, outer: { min: 0.65, max: 0.9 } };

const GEOGRAPHY: Readonly<Record<Biome, Geography>> = {
  meadow: 'plains', heath: 'plains', birch: 'forest', pine: 'forest', marsh: 'wetland', river: 'plains', lake: 'coastal', scree: 'mountain', fell: 'tundra', snow: 'tundra',
};

/**
 * What each kind of land beside a seat gives a settlement, in mapgen's terms. Rivers give a ford
 * (a feature), not fish: mapgen founds a fishing village on any fish, and most seats are by a river.
 */
const RESOURCES: Readonly<Record<Biome, readonly AdjacentResource[]>> = {
  meadow: ['fertile-soil'], heath: ['game'], birch: ['timber', 'game'], pine: ['timber'], marsh: ['peat'], river: [], lake: ['fish'], scree: ['stone'], fell: ['stone', 'ore'], snow: [],
};

/** The hand-written villages' living, as villages.ts describes them, in place of what the land suggests. */
const ANCHOR_RESOURCES: Readonly<Record<NonNullable<Province['anchor']>, readonly AdjacentResource[]>> = {
  hollowford: ['fertile-soil', 'game', 'stone'], // terraced barley, sheepfolds, stone walls
  saltmere: ['fish', 'salt', 'game'], // the salt lake, fish racks, the steppe beyond
  'kestrel-gate': ['stone', 'ore', 'timber'], // the wall, iron off the passes
};

/** The buildings each villager's work belongs in, best first (villages.ts roles). */
const WORKS_IN: Readonly<Record<Role, readonly string[]>> = {
  elder: ['longhouse', 'town-hall', 'manor', 'dwelling'],
  trader: ['merchant-stall', 'market-hall', 'warehouse'],
  healer: ['shrine', 'sacred-grove', 'temple'],
  smith: ['smithy', 'workshop', 'smelter'],
  teacher: ['longhouse', 'workshop'],
  hunter: ['smokehouse', 'shelter-hut'],
  caravaneer: ['stables', 'caravansary'],
  tinker: ['workshop'],
};

/** Each province's seat as a mapgen site, read off the grid. */
export function siteOf(reach: Reach, p: Province): SettlementSite {
  const { w, h, cells } = reach;
  const seatBiome = cells[p.seat.y * w + p.seat.x].biome;
  // The seat and the squares around it: what the settlement lives off.
  const around: Biome[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = p.seat.x + dx, y = p.seat.y + dy;
    if (x >= 0 && y >= 0 && x < w && y < h) around.push(cells[y * w + x].biome);
  }
  const beside = (b: Biome) => around.includes(b);
  const features: SiteFeature[] = [];
  if (beside('river')) features.push('river-crossing');
  // The road out of the Reach runs through the hand-written villages; the Gate holds a pass.
  if (p.anchor) features.push('trade-route');
  if (p.anchor === 'kestrel-gate') features.push('mountain-pass');
  // A resource counts when a third of the squares give it (the valley is all wood, and mapgen
  // ranks timber over farmland, so a single birch square would make every village a logging camp);
  // a lake counts from one square of shore.
  const gives = (r: AdjacentResource) => around.filter(b => RESOURCES[b].includes(r)).length >= (r === 'fish' ? 1 : 3);
  const found = (['fish', 'fertile-soil', 'timber', 'game', 'peat', 'stone', 'ore'] as const).filter(gives);
  const resources = new Set<AdjacentResource>(p.anchor ? ANCHOR_RESOURCES[p.anchor] : found);
  return {
    x: p.seat.x,
    y: p.seat.y,
    geography: beside('lake') ? 'coastal' : GEOGRAPHY[seatBiome],
    features,
    adjacentResources: [...resources].sort(),
    nearCorruption: false,
    tradeRouteCount: p.anchor ? 1 : 0,
    nearbySettlements: p.neighbors.length,
    cultureId: p.culture,
  };
}

/** How big a seat's settlement is: by its province's people, the hand-written villages as written. */
function tierOf(p: Province): SettlementTier {
  if (p.anchor === 'kestrel-gate') return 3; // a market crowded against the inside of the wall
  if (p.anchor) return 2;
  return p.population >= 450 ? 3 : p.population >= 200 ? 2 : 1;
}

/** A registry building as mapgen's placer wants it, for a villager's workplace the generator didn't pick. */
function resolved(entry: BuildingRegistryEntry): ResolvedBuilding {
  return {
    id: entry.id, role: entry.role, category: entry.category, zone: entry.zone,
    w: entry.baseSizeRange[0], d: entry.baseDepthRange?.[0] ?? entry.baseSizeRange[0],
    heightHint: entry.heightHint, placementHints: entry.placementHints, loreHook: entry.loreHook,
  };
}

/** Build one province's settlement: generate, make room for the villagers' work, lay it out, draw it. */
export function settlementOf(reach: Reach, p: Province): Settlement {
  const seed = seedOf(`${reach.seed}|world|settlement|${p.id}`);
  const rnd = generator(seed);
  const site = siteOf(reach, p);
  const { spec, buildings } = generateSettlement(site, p.name, rnd, DATA, tierOf(p));
  const people: readonly Person[] = p.anchor ? VILLAGES[p.anchor].people : [];
  // A hand-written smith needs a smithy: add the first workplace a villager's role calls for when
  // the generator didn't pick any of them.
  for (const person of people) {
    const options = WORKS_IN[person.role];
    if (buildings.some(b => options.includes(b.id))) continue;
    const entry = DATA.buildings.find(b => b.id === options[0]);
    if (entry) buildings.push(resolved(entry));
  }

  const culture = DATA.cultures.find(c => c.id === p.culture);
  const gridSize = Math.ceil(spec.radius / TILE) * 3 + 8;
  const placed = placeBuildings({
    buildings, radiusTiles: spec.radius / TILE, gridSize, tileSize: TILE, seed, zoneFracs: ZONE_FRAC,
    streetPattern: (culture?.streetPattern ?? 'organic') as StreetPattern,
  });

  // Draw it: roads first, then buildings over them, each footprint as its letter.
  const grid = Array.from({ length: gridSize }, () => Array<string>(gridSize).fill('.'));
  for (const r of placed.roads) if (grid[r.ty]?.[r.tx] !== undefined) grid[r.ty][r.tx] = r.main ? '=' : '-';
  // A letter per building: capitals, then lower case for a town with more than 26 (Kestrel Gate has about 40).
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const out: SettlementBuilding[] = placed.buildings.map((b, i) => {
    const letter = letters[i % letters.length];
    for (const [tx, ty] of footprintTiles(b.tx, b.ty, b.widthT, b.depthT)) if (grid[ty]?.[tx] !== undefined) grid[ty][tx] = letter;
    const entry = DATA.buildings.find(e => e.id === b.building.id);
    return { letter, id: b.building.id, name: entry?.name ?? b.building.id, role: b.building.role, lore: b.building.loreHook, people: [] };
  });
  // Villagers go to the first building of theirs that was placed; the rest are about the place.
  const about: string[] = [];
  for (const person of people) {
    const home = WORKS_IN[person.role].map(id => out.find(b => b.id === id)).find(b => b);
    const label = `${person.name} (${person.role})`;
    if (home) home.people.push(label); else about.push(label);
  }
  return { provinceId: p.id, name: p.name, anchor: p.anchor, tier: spec.tier, purpose: spec.purpose, culture: p.culture, rows: crop(grid), buildings: out, about };
}

/** The grid cropped to what's drawn on it, with a square of open ground around. */
function crop(grid: string[][]): string[] {
  const used = (row: string[]) => row.some(c => c !== '.');
  const ys = grid.map((row, y) => (used(row) ? y : -1)).filter(y => y >= 0);
  if (!ys.length) return ['.'];
  const xs = grid.flatMap(row => row.map((c, x) => (c !== '.' ? x : -1)).filter(x => x >= 0));
  const x0 = Math.max(0, Math.min(...xs) - 1), x1 = Math.min(grid[0].length - 1, Math.max(...xs) + 1);
  const y0 = Math.max(0, ys[0] - 1), y1 = Math.min(grid.length - 1, ys[ys.length - 1] + 1);
  return grid.slice(y0, y1 + 1).map(row => row.slice(x0, x1 + 1).join(''));
}
