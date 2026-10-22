/**
 * #1529 — the toast shown when a recipe is discovered: its wording, and that the discovery it
 * announces happens when the player gathers, not later.
 */

import { describe, it, expect } from 'vitest';
import recipesJson from '../../public/macro-world/recipes.json';
import { Discovery, type DiscoveryMethod } from './Discovery';
import { discoveryToastText } from './discoveryToast';

const RECIPES = recipesJson.recipes as { id?: string; name?: string }[];

describe('Recipe discovery toast (#1529)', () => {
  it('names the recipe and says how it was found', () => {
    expect(discoveryToastText('healing-salve', 'memory', RECIPES)).toEqual({ title: 'Healing Salve', detail: 'Worked out from practice' });
    expect(discoveryToastText('glass', 'experiment', RECIPES)?.detail).toBe('Found by experimenting');
    const methods: DiscoveryMethod[] = ['memory', 'experiment', 'observation', 'taught', 'reverse-engineer'];
    for (const m of methods) expect(discoveryToastText('glass', m, RECIPES)?.detail).toMatch(/\w/);
  });

  it('stays quiet for innate recipes, and never shows a raw id', () => {
    expect(discoveryToastText('fire-starter', 'innate', RECIPES)).toBeNull();
    expect(discoveryToastText('smoked-eel-pie', 'memory', RECIPES)?.title).toBe('Smoked Eel Pie');
  });

  it('announces Healing Salve on the fifth herb gather once the defs are loaded up front', () => {
    // DiscoverySystem now loads the bundled recipe defs when it's made, so a gather in the
    // Homestead fires the discovery (and its toast) then, not the next time the menu opens.
    const d = new Discovery();
    d.loadRecipeDefs(RECIPES);
    const found: [string, DiscoveryMethod][] = [];
    d.onFound = (id, method) => found.push([id, method]);
    for (let i = 0; i < 5; i++) d.recordAction('gather:herb-green');
    expect(found).toEqual([['healing-salve', 'memory']]);
    expect(discoveryToastText(...found[0], RECIPES)?.title).toBe('Healing Salve');
  });
});
