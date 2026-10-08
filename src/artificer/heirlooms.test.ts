/**
 * Acceptance tests for #1455 — heirlooms: one run per Warden, and the tools pass to the next.
 * Criteria 1–3 (the sim) are here; 4–6 (the app's `newRun` and saves) are in
 * src/artificer-app/carry.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, repack, runAction, blockedReason, STARTING_RECIPES, type Region1State } from './region1';
import { createRoad } from './road';
import { createVitals } from './vitality';
import { heirloomsOf, type Legacy } from './legacy';
import { SUGGESTED_PACK } from './kit';
import type { Tool } from './crafting';
import type { OutcomeKind } from './winter';

/** Two knives (fine over sound) and a crude bedroll: what the Warden had at the end. */
const TOOLS: Tool[] = [
  { item: 'stone-knife', grade: 'fine', crafted: 'sound' },
  { item: 'bedroll', grade: 'crude' },
  { item: 'stone-knife', grade: 'sound' },
];

/** A run that ended `kind`, holding TOOLS. */
function ended(kind: OutcomeKind): Region1State {
  const s = createRegion1();
  const vitals = createVitals({ condition: 90 });
  const choice = kind === 'survived' ? 'thaw' as const : 'collapse' as const;
  return { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 30, water: 20, firewood: 4 }, tools: TOOLS, outcome: { choice, kind, ...(kind === 'survived' ? { grade: 'hale' as const } : {}), vitals } };
}

describe('Heirlooms: one run per Warden, the tools pass on (#1455)', () => {
  // 1. Any outcome leaves the tools — one of each item, the best grade — and nothing of the mind.
  it('leaves one of each tool, the best grade, and no knowledge', () => {
    for (const kind of ['died', 'collapsed', 'survived'] as OutcomeKind[]) {
      const h = heirloomsOf(ended(kind));
      expect(h.heirlooms).toEqual([
        { item: 'stone-knife', grade: 'fine', crafted: 'sound', heirloom: true },
        { item: 'bedroll', grade: 'crude', heirloom: true },
      ]);
      expect(h.known).toEqual([]);
      expect(h.concepts).toEqual({});
      for (const k of ['skills', 'stats', 'talents', 'quirks', 'age', 'contacts', 'marks', 'techniques'] as (keyof Legacy)[]) expect(h[k]).toBeUndefined();
    }
  });

  // 2. A run that ended on the road leaves the road's tools, not the Reach's.
  it('takes the road’s tools from a run that ended there', () => {
    const reach = ended('survived');
    const road = { ...createRoad(reach), tools: [{ item: 'waterskin', grade: 'sound' as const }] };
    expect(heirloomsOf(road).heirlooms).toEqual([{ item: 'waterskin', grade: 'sound', heirloom: true }]);
  });

  // 3. A new run with heirlooms and the default pack: the pack's tools plus the heirlooms, fresh knowledge, and a journal line.
  it('starts the next Warden with the pack and the heirlooms, knowing nothing', () => {
    const packOnly = createRegion1({}, undefined, { pack: [...SUGGESTED_PACK] });
    // The suggested pack holds a fine stone-knife, so only a better one is worth leaving.
    const s = createRegion1({}, heirloomsOf({ tools: [{ item: 'stone-knife', grade: 'masterwork' }] }), { pack: [...SUGGESTED_PACK] });
    expect(s.tools).toEqual([...packOnly.tools, { item: 'stone-knife', grade: 'masterwork', heirloom: true }]);
    expect(s.known).toEqual([...STARTING_RECIPES]);
    expect(s.concepts).toEqual({});
    const journal = s.log.map(l => l.text).join('\n');
    expect(journal).toMatch(/left for you/i);
    expect(journal).toMatch(/masterwork stone-knife/);
    // A knowledge-free legacy doesn't claim to carry knowledge.
    expect(journal).not.toMatch(/You carry what you learned/);
    // Repacking on the first morning (the intro's pack screen) swaps the pack's tools, never the heirlooms.
    const repacked = repack(s, ['tarp', 'kasa']);
    expect(repacked.tools).toContainEqual({ item: 'stone-knife', grade: 'masterwork', heirloom: true });
    expect(repacked.tools.filter(t => !t.heirloom)).toEqual(repack(packOnly, ['tarp', 'kasa']).tools);
  });

  // An heirloom the pack already matches or beats adds nothing — no duplicate, no journal line.
  it('drops heirlooms the pack already matches', () => {
    expect(packTools().length).toBeGreaterThan(0);
    const s = createRegion1({}, heirloomsOf({ tools: packTools() }), { pack: [...SUGGESTED_PACK] });
    expect(s.tools).toEqual(packTools());
    expect(s.log.map(l => l.text).join('\n')).not.toMatch(/left for you/i);
  });

  // An heirloom never blocks making your own: that's how the next Warden learns the craft.
  it('lets the next Warden craft an item they hold only as an heirloom', () => {
    const base = runAction(createRegion1(), 'scout'); // the knife needs the land scouted first
    const withHeirloom = { ...base, tools: [{ item: 'stone-knife', grade: 'fine' as const, heirloom: true }] };
    const withOwn = { ...base, tools: [{ item: 'stone-knife', grade: 'fine' as const }] };
    expect(blockedReason(withHeirloom, 'knife', 1)).toBe(blockedReason(base, 'knife', 1));
    expect(blockedReason(withHeirloom, 'knife', 1) ?? '').not.toMatch(/already have/);
    expect(blockedReason(withOwn, 'knife', 1)).toMatch(/already have a fine stone knife/);
  });
});

/** The suggested pack's day-1 tools. */
const packTools = () => createRegion1({}, undefined, { pack: [...SUGGESTED_PACK] }).tools;
