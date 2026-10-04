/**
 * mapSources — the crafting sim's "place", read from a map file (#1171).
 *
 * The sim doesn't walk around, but it still needs to know *where* it is: which
 * nodes can be harvested and which biomes surround the settlement. Both come
 * from the same `LdtkLevel` a Core Warden scene would draw — the map's
 * `ResourceNode` entities and its `Biome` layer — so a generated settlement
 * file (#1170/#1178) feeds the sim with no second data path. Same file,
 * displayed differently: the game draws it in iso, the sim reads it as menus.
 *
 * Pure: no Phaser, no I/O. The scene loads the JSON and the registry; these
 * two functions turn them into what ActionQueue and resolveHarvest want.
 */

import { entitiesOfType, intGridGet, type LdtkLevel } from '../world/MapData';
import type { HarvestSource } from './ActionQueue';
import type { ResourceNodeYield } from './actions';

/** Shape of a public/macro-world/resource-nodes.json entry the sim needs. */
export interface NodeTypeDef {
  id: string;
  label: string;
  yields: ResourceNodeYield[];
  respawnMs: number;
}

/** The slice of a registry item the sim reads. */
export interface ItemBiomes {
  biomes?: string[];
}

/** Respawn time stands in for "how long a trip takes": 1 tick ≈ 20 s, at least 2 ticks. */
const MS_PER_TICK = 20_000;
export const durationTicksFor = (respawnMs: number): number => Math.max(2, Math.round(respawnMs / MS_PER_TICK));

/**
 * One HarvestSource per distinct node type present on the map, in the order
 * the types first appear. Yields are copied from resource-nodes.json with
 * each item's `biomes` from the registry attached, so resolveHarvest can gate
 * them (#1160) without a registry lookup of its own. Node types the map
 * mentions but resource-nodes.json doesn't know are skipped — a map can be
 * authored ahead of the data, and the sim shouldn't crash on it.
 */
export function sourcesFromMap(level: LdtkLevel, nodeTypes: NodeTypeDef[], registry: Map<string, ItemBiomes>): HarvestSource[] {
  const byId = new Map(nodeTypes.map(n => [n.id, n]));
  const seen = new Set<string>();
  const sources: HarvestSource[] = [];
  for (const layer of Object.values(level.entityLayers)) {
    for (const e of entitiesOfType(layer, 'ResourceNode')) {
      const id = String(e.fields.nodeType ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const def = byId.get(id);
      if (!def) continue;
      sources.push({
        id: def.id,
        label: def.label,
        yields: def.yields.map(y => ({ ...y, biomes: registry.get(y.itemId)?.biomes })),
        durationTicks: durationTicksFor(def.respawnMs),
      });
    }
  }
  return sources;
}

/**
 * The distinct biomes on the map, in first-seen cell order. The `Biome`
 * IntGrid stores indices into the level's `biomes` field (#1178); with the
 * field but no layer the whole list counts; with neither there's nothing to
 * say, and the caller falls back to its own default.
 */
export function biomesFromMap(level: LdtkLevel): string[] {
  const names = Array.isArray(level.fields.biomes) ? (level.fields.biomes as unknown[]).map(String) : null;
  if (!names) return [];
  const grid = level.intGrids.Biome;
  if (!grid) return [...names];
  const out: string[] = [];
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const name = names[intGridGet(grid, x, y)];
      if (name !== undefined && !out.includes(name)) out.push(name);
    }
  }
  return out;
}
