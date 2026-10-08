/**
 * SettlementMapEmitter — turn a placed settlement into a map file (#1170).
 *
 * `placeBuildings()` gives us a block grid in memory; scenes used to stamp it
 * straight into themselves. This emits the LDtk-shaped JSON that
 * `MapData.parseLdtkLevel()` reads instead, so a generated settlement is a
 * file on disk like a hand-authored one — the scene can't tell them apart.
 *
 * Pure: no Phaser, no I/O. The result is a plain object; callers JSON.stringify
 * it (the generate script) or hand it straight to parseLdtkLevel (tests).
 *
 * Layers written:
 *  - `Collision`    IntGrid — 1 on every building footprint cell, else 0
 *  - `PathSegments` IntGrid — PATH_SEGMENT.paved on main roads, .dirt on
 *                             connectors and building links, else 0
 *  - `Entities`     — a Building per placed building, an Entrance per
 *                     entrance, and one SpawnPoint at the grid centre for
 *                     the map transition to land on (#1174)
 */

import { footprintSpan, footprintTiles, type PlacementResult, type PlacedBuilding } from './SettlementPlacement';
import type { SettlementSite, Geography, AdjacentResource } from './SettlementSpec';

/** The slice of a site the emitter reads (#1178). */
export type EmitSite = Pick<SettlementSite, 'geography' | 'adjacentResources' | 'features'>;

export interface EmitOptions {
  /** Level identifier, also the file's basename (`public/assets/maps/<id>.json`). */
  identifier: string;
  /** Placement grid is square: this many cells per side. */
  gridSize: number;
  /** Pixels per cell in the emitted map (WORLD_TILE_SIZE for in-game maps). */
  cellSize: number;
  /** Per-map scale metadata (#1169). */
  metersPerTile: number;
  label: string;
  /**
   * Where the settlement sits (#1178). With a site the map gets a `Biome`
   * layer and `ResourceNode` entities; without one, neither — a bare layout.
   */
  site?: EmitSite;
  /** Seeded PRNG for node placement; required when `site` is given. */
  rng?: () => number;
}

/** Site geography → item-registry biome id (the vocabulary `item.biomes` uses). */
export const GEOGRAPHY_TO_BIOME: Readonly<Record<Geography, string>> = {
  coastal: 'coast',
  forest: 'forest',
  mountain: 'mountain',
  plains: 'plains',
  tundra: 'tundra',
  desert: 'salt-flat',
  wetland: 'swamp',
  volcanic: 'volcanic',
};

/** Adjacent resource → resource-nodes.json node type. `null` = no node yet. */
export const RESOURCE_TO_NODE: Readonly<Record<AdjacentResource, string | null>> = {
  timber: 'tree',
  stone: 'rock',
  ore: 'ore',
  'fertile-soil': 'herb',
  game: 'berry',
  fish: 'water',
  salt: null,
  clay: null,
  crystal: null,
  peat: null,
};

/** Node types that only make sense on a wet cell (riverbank / coast). */
const WET_NODES: ReadonlySet<string> = new Set(['water']);
const WET_BIOMES: ReadonlySet<string> = new Set(['riverbank', 'coast']);

/** How many nodes each adjacent resource places. A placeholder until balancing. */
export const NODES_PER_RESOURCE = 3;

/**
 * IntGrid values for the PathSegments layer. MapData's layer table documents
 * `1 = animal`; the rest follow PathSystem's PathType order so a future
 * loader can map value → PathType by name.
 */
export const PATH_SEGMENT = { none: 0, animal: 1, dirt: 2, forest: 3, paved: 4, wading: 5 } as const;

// ── Emitted JSON shape ──────────────────────────────────────────────────────
// Mirrors the subset of LDtk's level export that parseLdtkLevel understands.
// Entity `fieldInstances` is the plain-object form the parser reads directly.

export interface EmittedEntity {
  __identifier: string;
  iid: string;
  __worldX: number;
  __worldY: number;
  width: number;
  height: number;
  fieldInstances: Record<string, unknown>;
}

export interface EmittedIntGridLayer {
  __identifier: string;
  __type: 'IntGrid';
  __gridSize: number;
  __cWid: number;
  __cHei: number;
  intGridCsv: number[];
}

export interface EmittedEntityLayer {
  __identifier: string;
  __type: 'Entities';
  __gridSize: number;
  __cWid: number;
  __cHei: number;
  entityInstances: EmittedEntity[];
}

export interface SettlementMapJson {
  identifier: string;
  pxWid: number;
  pxHei: number;
  fieldInstances: { __identifier: string; __value: unknown }[];
  layerInstances: (EmittedIntGridLayer | EmittedEntityLayer)[];
}

/** Pixel bounds of a building footprint: top-left corner and size. */
function footprintPx(b: PlacedBuilding, cellSize: number): { x: number; y: number; width: number; height: number } {
  const [loX] = footprintSpan(b.widthT);
  const [loY] = footprintSpan(b.depthT);
  return {
    x: (b.tx + loX) * cellSize,
    y: (b.ty + loY) * cellSize,
    width: b.widthT * cellSize,
    height: b.depthT * cellSize,
  };
}

export function emitSettlementMap(result: PlacementResult, opts: EmitOptions): SettlementMapJson {
  const { identifier, gridSize: n, cellSize } = opts;
  const collision = new Array<number>(n * n).fill(0);
  const paths = new Array<number>(n * n).fill(0);
  const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n;

  // Collision: the exact cells placement reserved, via the shared footprint
  // helper — if these ever disagree, buildings would be walkable or roads
  // would route through walls.
  for (const b of result.buildings) {
    for (const [x, y] of footprintTiles(b.tx, b.ty, b.widthT, b.depthT)) {
      if (inGrid(x, y)) collision[y * n + x] = 1;
    }
  }

  for (const r of result.roads) {
    if (!inGrid(r.tx, r.ty)) continue;
    paths[r.ty * n + r.tx] = r.main ? PATH_SEGMENT.paved : PATH_SEGMENT.dirt;
  }

  // Entities. iids are derived from position in the input, not random, so
  // the same settlement always emits byte-identical JSON (criterion 5).
  const entities: EmittedEntity[] = [];
  result.buildings.forEach((b, i) => {
    const px = footprintPx(b, cellSize);
    entities.push({
      __identifier: 'Building',
      iid: `building-${i}`,
      __worldX: px.x,
      __worldY: px.y,
      width: px.width,
      height: px.height,
      fieldInstances: { slug: b.building.id, role: b.building.role, fallback: b.fallback },
    });
    if (b.entranceTx !== undefined && b.entranceTy !== undefined) {
      entities.push({
        __identifier: 'Entrance',
        iid: `entrance-${i}`,
        __worldX: b.entranceTx * cellSize,
        __worldY: b.entranceTy * cellSize,
        width: cellSize,
        height: cellSize,
        fieldInstances: { building: b.building.id, side: b.entranceSide ?? null },
      });
    }
  });
  // Biome cells + resource nodes come from the site (#1178).
  const biomes: string[] = [];
  let biomeLayer: EmittedIntGridLayer | undefined;
  if (opts.site) {
    const biome = paintBiome(opts.site, n, biomes);
    biomeLayer = { __identifier: 'Biome', __type: 'IntGrid', __gridSize: cellSize, __cWid: n, __cHei: n, intGridCsv: biome };
    const rng = opts.rng ?? (() => { throw new Error('emitSettlementMap: opts.rng is required with opts.site'); });
    placeResourceNodes(opts.site, n, collision, paths, biome, biomes, rng).forEach(([x, y, nodeType], i) => {
      entities.push({
        __identifier: 'ResourceNode',
        iid: `node-${i}`,
        __worldX: x * cellSize,
        __worldY: y * cellSize,
        width: cellSize,
        height: cellSize,
        fieldInstances: { nodeType },
      });
    });
  }

  const mid = Math.floor(n / 2);
  entities.push({
    __identifier: 'SpawnPoint',
    iid: 'spawn-0',
    __worldX: mid * cellSize,
    __worldY: mid * cellSize,
    width: cellSize,
    height: cellSize,
    fieldInstances: { name: 'default' },
  });

  const grid = { __gridSize: cellSize, __cWid: n, __cHei: n };
  return {
    identifier,
    pxWid: n * cellSize,
    pxHei: n * cellSize,
    fieldInstances: [
      { __identifier: 'metersPerTile', __value: opts.metersPerTile },
      { __identifier: 'scaleLabel', __value: opts.label },
      ...(biomeLayer ? [{ __identifier: 'biomes', __value: biomes }] : []),
    ],
    layerInstances: [
      { __identifier: 'Collision', __type: 'IntGrid', ...grid, intGridCsv: collision },
      { __identifier: 'PathSegments', __type: 'IntGrid', ...grid, intGridCsv: paths },
      ...(biomeLayer ? [biomeLayer] : []),
      { __identifier: 'Entities', __type: 'Entities', ...grid, entityInstances: entities },
    ],
  };
}

/**
 * Base biome everywhere, plus a one-cell band along the east edge for a
 * river (`river-crossing` / `river-confluence`) or the south edge for a
 * harbour. Values index `biomes`, which this fills in first-seen order so
 * value 0 is always the base. A base + an edge band is deliberately crude:
 * enough for the crafter's biome set and for Core Warden to know where the
 * water is; per-cell terrain comes with the editors (#1172).
 */
function paintBiome(site: EmitSite, n: number, biomes: string[]): number[] {
  const index = (b: string) => { let i = biomes.indexOf(b); if (i < 0) { biomes.push(b); i = biomes.length - 1; } return i; };
  const base = index(GEOGRAPHY_TO_BIOME[site.geography]);
  const cells = new Array<number>(n * n).fill(base);
  const river = site.features.includes('river-crossing') || site.features.includes('river-confluence');
  const harbour = site.features.includes('harbour');
  if (river) {
    const v = index('riverbank');
    for (let y = 0; y < n; y++) cells[y * n + (n - 1)] = v;
  } else if (harbour) {
    const v = index('coast');
    for (let x = 0; x < n; x++) cells[(n - 1) * n + x] = v;
  }
  return cells;
}

/**
 * Place NODES_PER_RESOURCE nodes per adjacent resource on free cells (no
 * building, no road, no other node), preferring the outer ring so the
 * settlement core stays walkable. Wet node types only land on wet biome
 * cells; if the map has none, that resource places nothing — a fishing
 * village with no water is a data problem to see, not to paper over.
 */
function placeResourceNodes(
  site: EmitSite, n: number, collision: number[], paths: number[], biome: number[], biomes: string[], rng: () => number,
): Array<[number, number, string]> {
  const out: Array<[number, number, string]> = [];
  const taken = new Set<number>();
  const free = (i: number) => collision[i] === 0 && paths[i] === 0 && !taken.has(i);
  const wet = (i: number) => WET_BIOMES.has(biomes[biome[i]]);
  // Outer ring = outside the middle third; small grids fall back to any free cell.
  const inner = (i: number) => { const x = i % n, y = Math.floor(i / n); const lo = Math.floor(n / 3), hi = n - 1 - lo; return x > lo && x < hi && y > lo && y < hi; };
  for (const resource of site.adjacentResources) {
    const nodeType = RESOURCE_TO_NODE[resource];
    if (!nodeType) continue;
    const needsWet = WET_NODES.has(nodeType);
    let candidates: number[] = [];
    for (let i = 0; i < n * n; i++) if (free(i) && (!needsWet || wet(i)) && !inner(i)) candidates.push(i);
    if (candidates.length < NODES_PER_RESOURCE) {
      candidates = [];
      for (let i = 0; i < n * n; i++) if (free(i) && (!needsWet || wet(i))) candidates.push(i);
    }
    for (let k = 0; k < NODES_PER_RESOURCE && candidates.length > 0; k++) {
      const pick = candidates.splice(Math.floor(rng() * candidates.length), 1)[0];
      taken.add(pick);
      out.push([pick % n, Math.floor(pick / n), nodeType]);
    }
  }
  return out;
}
