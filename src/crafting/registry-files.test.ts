/**
 * Acceptance tests for #1513 — one copy of each registry.
 *
 * The content inventory (#1505) found two leftovers: `macro-world/recipes.json`, an older
 * 34-recipe copy of `public/macro-world/recipes.json` that only the /crafter testbed still read,
 * and `macro-world/tinker-tray.json`, an identical copy of the public one that nothing read. Two
 * copies drift: the full tech tree went into one and not the other. And the item registry's
 * `_stats` block had fallen a raw item and an icon behind.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import recipesJson from '../../public/macro-world/recipes.json';
import { queueRecipes } from './ActionQueue';

const root = join(__dirname, '..', '..');

/** Every .ts file under src/. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : f.endsWith('.ts') ? [p] : [];
  });
}

describe('One copy of each registry (#1513)', () => {
  // 1. The old copies are gone, and nothing in src/ reaches for them.
  it('has no root copies of recipes.json or tinker-tray.json, and nothing imports them', () => {
    for (const f of ['recipes.json', 'tinker-tray.json']) {
      expect([f, existsSync(join(root, 'macro-world', f))]).toEqual([f, false]);
      expect([f, existsSync(join(root, 'public', 'macro-world', f))]).toEqual([f, true]);
    }
    // An import path into the root folder (`../../macro-world/recipes.json`), not the public one.
    const stale = sources(join(root, 'src')).filter(p => /['"](\.\.\/)+macro-world\/(recipes|tinker-tray)\.json['"]/.test(readFileSync(p, 'utf8')));
    expect(stale.map(p => relative(root, p))).toEqual([]);
  });

  // 2. /crafter reads the canonical recipes now, so it has to skip their `_tier` section headers.
  it('reads every recipe from the canonical file and none of its section headers', () => {
    const recipes = queueRecipes(recipesJson.recipes);
    expect(recipes).toHaveLength(131);
    expect(recipes.every(r => typeof r.id === 'string' && r.output.item && r.inputs.length > 0 && r.timeBase > 0)).toBe(true);
    // Including the 34 the old file had.
    for (const id of ['rope', 'iron-ingot', 'trap-snare', 'healing-salve']) expect(recipes.some(r => r.id === id)).toBe(true);
  });

  // 3. The registry's summary block says what the registry holds.
  it('keeps item-registry.json _stats in step with its items', () => {
    const reg = JSON.parse(readFileSync(join(root, 'macro-world', 'item-registry.json'), 'utf8')) as {
      _stats: { totalItems: number; categories: Record<string, number>; withIcon: number; pendingIcon: number };
      items: { category: string; icon: string | null }[];
    };
    const categories: Record<string, number> = {};
    for (const i of reg.items) categories[i.category] = (categories[i.category] ?? 0) + 1;
    const withIcon = reg.items.filter(i => i.icon).length;
    expect(reg._stats).toEqual({ totalItems: reg.items.length, categories, withIcon, pendingIcon: reg.items.length - withIcon });
  });
});
