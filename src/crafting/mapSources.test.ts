/**
 * Acceptance tests for #1171 — the crafting sim derives its harvest sources
 * and biome set from a map file. One test per Given/When/Then criterion.
 * Levels are built from emptyLdtkLevel() plus hand-filled layers; no file I/O.
 */

import { describe, it, expect } from 'vitest';
import { sourcesFromMap, biomesFromMap, type NodeTypeDef } from './mapSources';
import { emptyLdtkLevel, type LdtkLevel, type LdtkEntity } from '../world/MapData';
import { ActionQueue } from './ActionQueue';
import { Inventory } from './Inventory';
import { MemoryStore, RecordingEmitter } from './testDoubles';
import { mulberry32 } from '../lib/rng';

const CELL = 32;

function level(cols = 4, rows = 4): LdtkLevel {
  return emptyLdtkLevel(cols * CELL, rows * CELL, CELL);
}

function node(nodeType: string, x: number, y: number): LdtkEntity {
  return { identifier: 'ResourceNode', iid: `node-${x}-${y}`, x: x * CELL, y: y * CELL, width: CELL, height: CELL, fields: { nodeType } };
}

/** Add a Biome IntGrid whose values index `biomes`, filled from `cells`. */
function withBiome(l: LdtkLevel, biomes: string[], cells: number[]): LdtkLevel {
  const g = l.intGrids.Collision;
  l.intGrids.Biome = { identifier: 'Biome', cellSize: g.cellSize, cols: g.cols, rows: g.rows, values: cells };
  l.fields.biomes = biomes;
  return l;
}

const NODE_TYPES: NodeTypeDef[] = [
  { id: 'tree', label: 'Oak Tree', yields: [{ itemId: 'wood-log', min: 1, max: 2 }, { itemId: 'plant-fiber', min: 1, max: 1, seasonal: true }], respawnMs: 60_000 },
  { id: 'rock', label: 'Rock', yields: [{ itemId: 'stone', min: 1, max: 2 }], respawnMs: 90_000 },
  { id: 'herb', label: 'Herb Patch', yields: [{ itemId: 'herb-green', min: 1, max: 1, seasonal: true }], respawnMs: 45_000 },
];

const REGISTRY = new Map([
  ['wood-log', { biomes: ['forest', 'plains', 'taiga'] }],
  ['plant-fiber', { biomes: ['forest', 'plains', 'swamp', 'meadow'] }],
  ['stone', { biomes: ['mountain', 'cliff', 'plains', 'riverbank'] }],
  ['herb-green', { biomes: ['forest', 'plains', 'meadow'] }],
]);

describe('mapSources (#1171 acceptance)', () => {
  it('1. given ResourceNode entities tree, tree, rock, sourcesFromMap returns exactly two sources, tree then rock', () => {
    const l = level();
    l.entityLayers.Entities.entities.push(node('tree', 0, 0), node('tree', 1, 0), node('rock', 2, 0));
    const sources = sourcesFromMap(l, NODE_TYPES, REGISTRY);
    expect(sources.map(s => s.id)).toEqual(['tree', 'rock']);
    expect(sources[0].label).toBe('Oak Tree');
    expect(sources[0].durationTicks).toBe(3); // 60_000 ms / 20_000 per tick
  });

  it('2. given a ResourceNode with an unknown nodeType mithril-vein, it is skipped', () => {
    const l = level();
    l.entityLayers.Entities.entities.push(node('mithril-vein', 0, 0), node('rock', 1, 0));
    expect(sourcesFromMap(l, NODE_TYPES, REGISTRY).map(s => s.id)).toEqual(['rock']);
  });

  it('3. given tree yielding wood-log and a registry with wood-log.biomes, the tree source\'s wood-log yield carries those biomes', () => {
    const l = level();
    l.entityLayers.Entities.entities.push(node('tree', 0, 0));
    const [tree] = sourcesFromMap(l, NODE_TYPES, REGISTRY);
    const wood = tree.yields.find(y => y.itemId === 'wood-log')!;
    expect(wood.biomes).toEqual(['forest', 'plains', 'taiga']);
    // The node type's own flags survive the copy.
    expect(tree.yields.find(y => y.itemId === 'plant-fiber')!.seasonal).toBe(true);
  });

  it('4. given a Biome layer with cells forest, forest, riverbank, forest, biomesFromMap returns [forest, riverbank]', () => {
    const l = withBiome(level(2, 2), ['forest', 'riverbank'], [0, 0, 1, 0]);
    expect(biomesFromMap(l)).toEqual(['forest', 'riverbank']);
  });

  it('5. given no Biome layer and no biomes field, biomesFromMap returns []', () => {
    expect(biomesFromMap(level())).toEqual([]);
  });

  it('6. given sources and biomes from a forest map with tree and herb nodes fed into an ActionQueue, harvesting tree yields wood-log and there is no rock source', () => {
    const l = withBiome(level(3, 1), ['forest'], [0, 0, 0]);
    l.entityLayers.Entities.entities.push(node('tree', 0, 0), node('herb', 2, 0));
    const sources = sourcesFromMap(l, NODE_TYPES, REGISTRY);
    const biome = biomesFromMap(l);
    const inventory = new Inventory({ emitter: new RecordingEmitter(), store: new MemoryStore() });
    const queue = new ActionQueue({ inventory, rng: mulberry32(1), sources, recipes: [], context: () => ({ biome }) });
    expect(queue.enqueueHarvest('rock')).toBe(false);
    expect(queue.enqueueHarvest('tree')).toBe(true);
    queue.tick(3);
    expect(inventory.getQty('wood-log')).toBeGreaterThanOrEqual(1);
  });
});
