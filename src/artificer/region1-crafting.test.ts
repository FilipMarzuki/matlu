/**
 * Acceptance tests for #1213 — crafting & tools hooked into Region 1.
 * One test per Given/When/Then criterion (1–5) in the issue; criterion 6 is
 * playthrough.test.ts (unchanged, it crafts nothing) and 7 is in
 * src/artificer-app/controller.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, endDay, chooseSite, type Region1State } from './region1';
import { createVitals } from './vitality';
import type { Tool } from './crafting';
import { createExploration, scout, track } from './exploration';

/** Scouted, with a pile of materials and whatever else the test needs. */
function ready(over: Partial<Region1State> = {}): Region1State {
  const s = runAction(createRegion1(), 'scout');
  return { ...s, stores: { ...s.stores, materials: 10, rawFood: 5 }, ...over };
}

describe('Region 1 crafting', () => {
  // 1. Crafts are refused for free without materials; otherwise they pay and add a graded tool.
  it('crafts a tool from stores, or refuses at no cost', () => {
    const poor = runAction(createRegion1(), 'scout'); // 1 material
    const tried = runAction(poor, 'knife');
    expect(tried.tools).toEqual([]);
    expect(tried.hoursToday).toBe(poor.hoursToday);
    expect(tried.vitals).toEqual(poor.vitals);
    expect(tried.log.at(-1)).toMatchObject({ kind: 'skip' });
    expect(tried.log.at(-1)?.text).toMatch(/needs 2 materials/);

    const s = ready();
    const made = runAction(s, 'knife');
    expect(made.tools).toEqual([{ item: 'stone-knife', grade: 'sound', made: { sharpening: 0 } }]); // sharp mind, no bench yet; the maker's rank goes in (#1456)
    expect(made.stores.materials).toBe(8);
    expect(made.hoursToday).toBe(s.hoursToday + 3);
    expect(made.vitals.clarity.current).toBeLessThan(s.vitals.clarity.current);
    expect(made.concepts.sharpening?.insight).toBeGreaterThan(0);
    // A sound knife is kept; you don't make a second.
    expect(runAction(made, 'knife').log.at(-1)?.text).toMatch(/already have a sound stone knife/);
  });

  // 2. Tools make the actions they serve cheaper or richer.
  it('applies tool effects to the actions they serve', () => {
    const base = ready({ explore: track(scout(createExploration(), 1), 1) });
    const knife: Tool[] = [{ item: 'stone-knife', grade: 'sound' }];

    const plain = runAction(base, 'hunt');
    const withKnife = runAction({ ...base, tools: knife }, 'hunt');
    expect(withKnife.vitals.vigor.current).toBeGreaterThan(plain.vitals.vigor.current);

    const skinner = runAction({ ...base, tools: [{ item: 'skinning-knife', grade: 'sound' }] }, 'hunt');
    expect(skinner.stores.rawFood).toBe(plain.stores.rawFood + 2);

    const skin = runAction({ ...base, tools: [{ item: 'waterskin', grade: 'sound' }] }, 'water');
    expect(skin.stores.water).toBe(runAction(base, 'water').stores.water + 1);

    // Time savings shorten the day's hours (preserve 4h × 0.85).
    const preserved = runAction({ ...base, tools: knife }, 'preserve');
    expect(preserved.hoursToday).toBeCloseTo(base.hoursToday + 3.4);
  });

  // 3. A frayed mind fails the craft and wastes the materials.
  it('fails a craft when too foggy, wasting materials', () => {
    const s = ready({ vitals: createVitals({ clarity: 10 }) });
    const r = runAction(s, 'bedroll');
    expect(r.tools).toEqual([]);
    expect(r.stores.materials).toBe(7);
    // (A skill line — "comes easier" — may follow: even a failed attempt is practice.)
    expect(r.log.some(l => l.kind === 'hardship' && /materials wasted/.test(l.text))).toBe(true);
  });

  // 4. Overnight: the snare brings food, the bedroll more Clarity.
  it('lets a snare and a bedroll work overnight', () => {
    const s = ready();
    const snared = endDay({ ...s, tools: [{ item: 'trap-snare', grade: 'sound' }] });
    expect(snared.stores.rawFood).toBe(endDay(s).stores.rawFood + 1);
    expect(snared.log.some(l => /snare line caught/.test(l.text))).toBe(true);

    const tired = { ...s, vitals: createVitals({ clarity: 40 }) };
    const bedded = endDay({ ...tired, tools: [{ item: 'bedroll', grade: 'sound' }] });
    expect(bedded.vitals.clarity.current).toBeGreaterThan(endDay(tired).vitals.clarity.current);
  });

  // 5. The tier-1 shovel needs a roof (the shelter is the bench).
  it('needs a tier-1 shelter before crafting the shovel', () => {
    const s = chooseSite(ready(), 'cave');
    const tried = runAction(s, 'shovel');
    expect(tried.tools).toEqual([]);
    // Not yet worked out — digging the footings for a roof is what teaches it (#1221)…
    expect(tried.log.at(-1)?.text).toMatch(/haven't worked out/);
    // …and even known, it's tier-1 work that needs the roof as a bench.
    expect(runAction({ ...s, known: [...s.known, 'crude-shovel'] }, 'shovel').log.at(-1)?.text).toMatch(/tier-1 bench/);

    const roofed = runAction(s, 'build');
    expect(roofed.tier).toBe(1);
    const made = runAction(roofed, 'shovel');
    expect(made.tools.map(t => t.item)).toEqual(['crude-shovel']);
  });
});
