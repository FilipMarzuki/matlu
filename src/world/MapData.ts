/**
 * MapData — typed interfaces for LDtk map ingestion.
 *
 * ## Map source strategy
 *
 * LDtk exports a `.ldtk` project file alongside individual level JSON files
 * (one per level). The runtime pipeline is:
 *
 *   1. LDtk export → `public/assets/maps/<levelName>.json`
 *   2. Phaser `this.load.json('map-level1', 'assets/maps/level1.json')` in preload()
 *   3. `parseLdtkLevel()` converts raw JSON to typed `LdtkLevel`
 *   4. Systems (HeightMap, PathSystem, NPC, AttractionPoints) read from `LdtkLevel`
 *
 * Until actual LDtk files are authored, systems use the fallback placeholder
 * data produced by `emptyLdtkLevel()`.
 *
 * ## Layer naming conventions (LDtk project)
 *
 * | Layer identifier | Type     | Purpose                              |
 * |-----------------|----------|--------------------------------------|
 * | `HeightMap`     | IntGrid  | Height values 0–4 (pit→ridge)       |
 * | `Collision`     | IntGrid  | Solid (1) / passable (0)            |
 * | `PathSegments`  | IntGrid  | Path type (0=none, 1=animal, …)     |
 * | `Entities`      | Entities | NPCs, attraction points, portals     |
 */

// ─── IntGrid layers ──────────────────────────────────────────────────────────

/** A flat array of IntGrid cell values, row-major. */
export type IntGridValues = number[];

export interface IntGridLayer {
  /** Layer identifier as set in LDtk. */
  identifier: string;
  /** Cell size in pixels (LDtk `gridSize`). */
  cellSize: number;
  /** Width in cells. */
  cols: number;
  /** Height in cells. */
  rows: number;
  /** Flat row-major array of integer values (0 = empty). */
  values: IntGridValues;
}

/** Read a value from an IntGrid layer by cell coordinates. Returns 0 if out of bounds. */
export function intGridGet(layer: IntGridLayer, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= layer.cols || row >= layer.rows) return 0;
  return layer.values[row * layer.cols + col] ?? 0;
}

/** Convert world-pixel position to cell coordinates. */
export function worldToCell(
  layer: IntGridLayer,
  wx: number,
  wy: number
): { col: number; row: number } {
  return {
    col: Math.floor(wx / layer.cellSize),
    row: Math.floor(wy / layer.cellSize),
  };
}

// ─── Entity layer ────────────────────────────────────────────────────────────

/** A single entity placed in LDtk (NPC, attraction point, portal, etc.). */
export interface LdtkEntity {
  /** Entity definition identifier (e.g. "AttractionPoint", "NPC_Villager"). */
  identifier: string;
  /** Unique instance identifier (UUID). */
  iid: string;
  /** World-pixel X of the entity pivot. */
  x: number;
  /** World-pixel Y of the entity pivot. */
  y: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Arbitrary field values from the LDtk entity definition. */
  fields: Record<string, unknown>;
}

export interface EntityLayer {
  identifier: string;
  entities: LdtkEntity[];
}

/** Filter entities by identifier. */
export function entitiesOfType(layer: EntityLayer, type: string): LdtkEntity[] {
  return layer.entities.filter(e => e.identifier === type);
}

// ─── Level ───────────────────────────────────────────────────────────────────

/** A fully parsed LDtk level ready for runtime consumption. */
export interface LdtkLevel {
  /** Level identifier (e.g. "Level_0"). */
  identifier: string;
  /** World-pixel width of the level. */
  width: number;
  /** World-pixel height of the level. */
  height: number;
  /** All IntGrid layers keyed by identifier. */
  intGrids: Record<string, IntGridLayer>;
  /** All Entity layers keyed by identifier. */
  entityLayers: Record<string, EntityLayer>;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a raw LDtk level JSON export into a typed `LdtkLevel`.
 * Tolerates missing layers gracefully (returns empty stubs).
 *
 * @param raw - The JSON object loaded via `this.cache.json.get('map-level1')`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseLdtkLevel(raw: any): LdtkLevel {
  const intGrids: Record<string, IntGridLayer> = {};
  const entityLayers: Record<string, EntityLayer> = {};

  const layers: unknown[] = (raw?.layerInstances ?? raw?.layers ?? []) as unknown[];

  for (const layer of layers) {
    const l = layer as Record<string, unknown>;
    const id = String(l['__identifier'] ?? l['identifier'] ?? '');
    const type = String(l['__type'] ?? l['type'] ?? '');
    const cellSize = Number(l['__gridSize'] ?? l['gridSize'] ?? 16);
    const cWid = Number(l['__cWid'] ?? l['cWid'] ?? 0);
    const cHei = Number(l['__cHei'] ?? l['cHei'] ?? 0);

    if (type === 'IntGrid') {
      const csv: number[] = (l['intGridCsv'] ?? l['intGrid'] ?? []) as number[];
      intGrids[id] = { identifier: id, cellSize, cols: cWid, rows: cHei, values: csv };
    } else if (type === 'Entities') {
      const ents: LdtkEntity[] = ((l['entityInstances'] ?? l['entities'] ?? []) as Record<string, unknown>[]).map(e => ({
        identifier: String(e['__identifier'] ?? e['identifier'] ?? ''),
        iid: String(e['iid'] ?? ''),
        x: Number((e['__worldX'] ?? (e['px'] as number[] | undefined)?.[0]) ?? 0),
        y: Number((e['__worldY'] ?? (e['px'] as number[] | undefined)?.[1]) ?? 0),
        width:  Number(e['width']  ?? 16),
        height: Number(e['height'] ?? 16),
        fields: (e['fieldInstances'] ?? e['fields'] ?? {}) as Record<string, unknown>,
      }));
      entityLayers[id] = { identifier: id, entities: ents };
    }
  }

  return {
    identifier: String(raw?.identifier ?? 'unknown'),
    width:  Number(raw?.pxWid ?? raw?.width  ?? 2400),
    height: Number(raw?.pxHei ?? raw?.height ?? 2000),
    intGrids,
    entityLayers,
  };
}

/**
 * Produce an empty `LdtkLevel` placeholder for scenes that run before a real
 * LDtk export is available. All layers exist but contain zero values/entities.
 */
export function emptyLdtkLevel(width = 2400, height = 2000, cellSize = 32): LdtkLevel {
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const emptyGrid = (id: string): IntGridLayer => ({
    identifier: id, cellSize, cols, rows, values: new Array(cols * rows).fill(0),
  });
  return {
    identifier: 'placeholder',
    width,
    height,
    intGrids: {
      HeightMap:    emptyGrid('HeightMap'),
      Collision:    emptyGrid('Collision'),
      PathSegments: emptyGrid('PathSegments'),
    },
    entityLayers: {
      Entities: { identifier: 'Entities', entities: [] },
    },
  };
}
