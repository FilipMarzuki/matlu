/**
 * Acceptance tests for #1220 — options for hunting, preserving and cold gear.
 * One test per Given/When/Then criterion (1–5).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, ACTIONS, queueHours, STARTING_RECIPES, DISCOVERIES, type Region1State } from './region1';
import { createExploration, scout, track } from './exploration';
import { createVitals } from './vitality';
import { newGame, enqueue, setOption, previewQueue } from '../artificer-app/controller';

/** Scouted near ring (game suspected), plenty of food and materials. */
function base(over: Partial<Region1State> = {}): Region1State {
  const s = runAction(createRegion1(), 'scout');
  return { ...s, known: [...STARTING_RECIPES, ...DISCOVERIES.map(d => d.recipe)], stores: { ...s.stores, rawFood: 12, materials: 10 }, ...over };
}
const tracked = (): Region1State => base({ explore: track(scout(createExploration(), 1), 1) });

describe('More action options', () => {
  // 1. Defaults are unchanged (a deer hunt also brings a hide).
  it('keeps the defaults, with a hide from deer', () => {
    const s = tracked();
    const hunted = runAction(s, 'hunt');
    expect(hunted.stores.rawFood).toBe(s.stores.rawFood + 7);
    expect(hunted.stores.hides).toBe(1);
    expect(hunted.hoursToday).toBe(s.hoursToday + 5);

    const smoked = runAction(s, 'preserve');
    expect(smoked.stores.rations).toBe(3);
    expect(smoked.hoursToday).toBe(s.hoursToday + 4);

    const gear = runAction(s, 'coldGear');
    expect(gear.tools.map(t => t.item)).toEqual(['cold-gear']);
    expect(gear.stores.materials).toBe(7);
  });

  // 2. Small game needs only suspected game: shorter, smaller, no hide.
  it('lets you hunt small game before tracking', () => {
    const s = base(); // game suspected, not tracked
    expect(runAction(s, 'hunt').log.at(-1)?.text).toMatch(/no game tracked/);
    const small = runAction(s, { q: 'hunt', opts: { target: 'small' } });
    expect(small.stores.rawFood).toBe(s.stores.rawFood + 3);
    expect(small.stores.hides).toBe(0);
    expect(small.hoursToday).toBe(s.hoursToday + 3);
    expect(small.vitals.vigor.current).toBeGreaterThan(runAction(tracked(), 'hunt').vitals.vigor.current);
    // Before any scouting there's nothing to hunt at all.
    expect(runAction(createRegion1(), { q: 'hunt', opts: { target: 'small' } }).log.at(-1)?.text).toMatch(/haven't seen any game/);
  });

  // 3. Air-drying: quicker, at most two rations.
  it('air-dries faster but makes fewer rations', () => {
    const s = base();
    const dried = runAction(s, { q: 'preserve', opts: { method: 'dry' } });
    expect(dried.stores.rations).toBe(2);
    expect(dried.stores.rawFood).toBe(s.stores.rawFood - 4);
    expect(dried.hoursToday).toBe(s.hoursToday + 2);
    expect(dried.vitals.clarity.current).toBeGreaterThan(runAction(s, 'preserve').vitals.clarity.current);
  });

  // 4. A hide parka uses hides, and even a crude one holds on the road.
  it('makes a hide parka from hides, road-worthy even when crude', () => {
    const noHides = base();
    const refused = runAction(noHides, { q: 'coldGear', opts: { material: 'hide' } });
    expect(refused.log.at(-1)?.text).toMatch(/needs 2 hides/);
    expect(refused.hoursToday).toBe(noHides.hoursToday);

    const rough = base({ vitals: createVitals({ clarity: 60 }), stores: { ...noHides.stores, hides: 2 } });
    const parka = runAction(rough, { q: 'coldGear', opts: { material: 'hide' } });
    expect(parka.tools).toEqual([{ item: 'hide-parka', grade: 'crude' }]);
    expect(parka.stores.hides).toBe(0);
    expect(parka.coldGear).toBe(true); // crude fiber gear would not be
    expect(runAction(rough, 'coldGear').coldGear).toBe(false);
    // And once you have road-worthy gear, you don't make more.
    expect(runAction(parka, 'coldGear').log.at(-1)?.text).toMatch(/already have road-worthy cold gear/);

    // The waterskin takes a hide now.
    expect(runAction(noHides, 'waterskin').log.at(-1)?.text).toMatch(/need a hide/);
    expect(runAction({ ...noHides, stores: { ...noHides.stores, hides: 1 } }, 'waterskin').tools.map(t => t.item)).toEqual(['waterskin']);
  });

  // 5. Each action offers its real choice, and the preview follows it.
  it('offers the choices and previews their hours', () => {
    const s = tracked();
    for (const id of ['hunt', 'preserve', 'coldGear'] as const) {
      const groups = ACTIONS[id].options?.(s, {}) ?? [];
      expect(groups).toHaveLength(1);
      expect(groups[0].choices.length).toBe(2);
    }
    expect(queueHours({ q: 'hunt', opts: { target: 'small' } })).toBe(3);
    expect(queueHours({ q: 'hunt@2', opts: { target: 'small' } })).toBe(3 + 3);
    expect(queueHours({ q: 'preserve', opts: { method: 'dry' } })).toBe(2);

    const a = setOption(enqueue({ ...newGame(), sim: s }, 'preserve'), 0, 'method', 'dry');
    expect(previewQueue(a).projected.stores.rations).toBe(2);
  });
});
