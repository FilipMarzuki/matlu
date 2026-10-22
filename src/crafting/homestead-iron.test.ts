/**
 * #1516 — the Homestead's iron ore leads somewhere.
 *
 * The homestead map places two ore veins, which dropped iron and copper ore, but nothing in the
 * Homestead gave coal, so the iron chain (iron ingot = iron ore + coal, then blades, plates,
 * nails…) was out of reach. The ore vein now turns up coal now and then. No new node, sprite or
 * item: `coal` was already in the registry, per the owner's keep-it-simple call (#1523).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nodesJson from '../../public/macro-world/resource-nodes.json';
import recipesJson from '../../public/macro-world/recipes.json';
import { resolveHarvest, type ResourceNodeYield } from './actions';
import { mulberry32 } from '../lib/rng';
import { queueRecipes } from './ActionQueue';

const root = join(__dirname, '..', '..');
const nodes = nodesJson.nodeTypes as { id: string; yields: ResourceNodeYield[] }[];
/** The node types the homestead map places. */
const placed = [...new Set([...readFileSync(join(root, 'public/assets/maps/homestead.json'), 'utf8').matchAll(/"nodeType"\s*:\s*"([^"]+)"/g)].map(m => m[1]))];

describe('Homestead coal (#1516)', () => {
  it('gathers both inputs of an iron ingot from nodes the homestead map places', () => {
    const gatherable = new Set(nodes.filter(n => placed.includes(n.id)).flatMap(n => n.yields.map(y => y.itemId)));
    const ingot = queueRecipes(recipesJson.recipes).find(r => r.id === 'iron-ingot')!;
    expect(ingot.inputs.map(i => i.item).sort()).toEqual(['coal', 'iron-ore']);
    expect(ingot.inputs.filter(i => !gatherable.has(i.item))).toEqual([]);
  });

  it('turns up coal from an ore vein now and then, not every time', () => {
    const ore = nodes.find(n => n.id === 'ore')!;
    const rng = mulberry32(1516);
    const coal = Array.from({ length: 200 }, () => resolveHarvest(ore.yields, { rng }).items.some(i => i.itemId === 'coal'));
    const share = coal.filter(Boolean).length / coal.length;
    // 0–1 per harvest, like the vein's copper: about half the time.
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.7);
  });
});
