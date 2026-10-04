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
}

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
    ],
    layerInstances: [
      { __identifier: 'Collision', __type: 'IntGrid', ...grid, intGridCsv: collision },
      { __identifier: 'PathSegments', __type: 'IntGrid', ...grid, intGridCsv: paths },
      { __identifier: 'Entities', __type: 'Entities', ...grid, entityInstances: entities },
    ],
  };
}
