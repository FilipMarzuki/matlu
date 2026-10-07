/**
 * Acceptance tests for #1286 — accidents, part 4b: the worst outcomes. A damaged tool drops a
 * grade (a crude one breaks), and a sprain lasts three nights, making physical work dearer.
 * #1276's criteria 4 and 5.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD, FLAT_WORLD } from './world';
import { createExploration, scout } from './exploration';
import { rollAccident, INJURY_DAYS, type AccidentKind } from './accidents';
import { toolInUse, damageTool } from './crafting';
import type { Tool } from './crafting';

/** A tired Warden out at night in a storm, day 12 — the high band — with these tools. */
function grim(id: string, tools: Tool[] = [], accidents = true): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, accidents, luck: false } }, undefined, { id });
  return {
    ...s, day: 12, hoursToday: 13, weatherToday: 'storm', explore: scout(scout(createExploration(), 1), 2), tools,
    vitals: createVitals({ vigor: 15, clarity: 25 }), stores: { ...s.stores, water: 5, rawFood: 5 }, character: { ...s.character, talents: [], quirks: [] },
  };
}
const KIND: Readonly<Record<AccidentKind, RegExp>> = {
  bruise: /a bruise/, cut: /a bad cut/, 'lost-haul': /lose the haul/, sprain: /turn your ankle/, 'damaged-tool': /takes the fall|snaps under you/, hand: /opens your hand/,
};
/** The first Warden for whom gathering in ring 1 in `grim` conditions ends in `kind`. */
function whoGets(kind: AccidentKind, tools: Tool[] = []): string {
  for (let i = 0; i < 3000; i++) if (runAction(grim(`w-inj-${i}`, tools), 'gather').log.some(l => KIND[kind].test(l.text))) return `w-inj-${i}`;
  throw new Error(`no Warden gets ${kind}`);
}

describe('Damaged tools and sprains (#1286)', () => {
  // 4. Each outcome in turn: a cut costs 5, a lost haul zeroes the yield, a damaged tool drops a grade (crude breaks), a sprain lasts 3.
  it('applies each outcome', () => {
    // The high band, by the depth of the miss: lost haul, cut, damaged tool, sprain (about 25/50/15/10).
    const kinds = [0.1, 0.5, 0.8, 0.95].map(d => rollAccident(0.3 * (1 - d), 0.3, 1)!.kind);
    expect(kinds).toEqual(['lost-haul', 'cut', 'damaged-tool', 'sprain']);
    expect([0.3, 0.7, 0.95].map(d => rollAccident(0.3 * (1 - d), 0.3, 1, true)!.kind)).toEqual(['cut', 'damaged-tool', 'hand']);

    const snare: Tool = { item: 'trap-snare', grade: 'sound' };
    const cut = whoGets('cut');
    expect(runAction(grim(cut), 'gather').vitals.condition).toBe(runAction(grim(cut, [], false), 'gather').vitals.condition - 5);
    const lost = whoGets('lost-haul');
    expect(runAction(grim(lost), 'gather').stores.rawFood).toBe(grim(lost).stores.rawFood);
    // The snare the gathering leans on drops a grade; a crude one breaks.
    const knocked = whoGets('damaged-tool', [snare]);
    expect(runAction(grim(knocked, [snare]), 'gather').tools).toEqual([{ item: 'trap-snare', grade: 'crude' }]);
    expect(runAction(grim(knocked, [{ item: 'trap-snare', grade: 'crude' }]), 'gather').tools).toEqual([]);
    expect(runAction(grim(knocked, [{ item: 'trap-snare', grade: 'crude' }]), 'gather').log.some(l => /crude trap snare snaps/.test(l.text))).toBe(true);
    // With no tool in the work, the haul takes it instead.
    expect(runAction(grim(knocked), 'gather').stores.rawFood).toBe(grim(knocked).stores.rawFood);
    const sprained = runAction(grim(whoGets('sprain')), 'gather');
    expect(sprained.injuries).toEqual([{ kind: 'sprain', daysLeft: INJURY_DAYS }]);
    // The helpers: which tool a piece of work leans on, and what a knock does to it.
    expect(toolInUse([snare, { item: 'waterskin', grade: 'fine' }], 'water')).toEqual({ item: 'waterskin', grade: 'fine' });
    expect(toolInUse([snare], 'wood')).toBeNull();
    expect(toolInUse([{ item: 'stone-knife', grade: 'sound' }], 'craft')?.item).toBe('stone-knife');
    expect(damageTool([{ item: 'stone-knife', grade: 'fine', crafted: 'fine' }], 'stone-knife').tools).toEqual([{ item: 'stone-knife', grade: 'sound', crafted: 'fine' }]);
  });

  // 5. A sprain with daysLeft 3: wood costs 1.3× Vigor, and after 3 nights it's gone.
  it('makes a sprain cost more, for three nights', () => {
    const s = createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-sprain' });
    const fresh: Region1State = { ...s, explore: scout(createExploration(), 1), stores: { ...s.stores, rawFood: 9, water: 9 } };
    const sprained: Region1State = { ...fresh, injuries: [{ kind: 'sprain', daysLeft: 3 }] };
    const cost = (w: Region1State) => w.vitals.vigor.current - runAction(w, 'wood').vitals.vigor.current;
    expect(cost(sprained)).toBeCloseTo(cost(fresh) * 1.3, 5);
    let d = sprained;
    const lines: string[] = [];
    for (let n = 1; n <= 3; n++) {
      const before = d.log.length;
      d = runDay(d, ['rest']).state;
      lines.push(...d.log.slice(before).map(l => l.text).filter(t => /ankle/.test(t)));
      if (n < 3) expect(d.injuries).toEqual([{ kind: 'sprain', daysLeft: 3 - n }]);
    }
    expect(d.injuries).toEqual([]);
    expect(lines).toEqual(['Your sprained ankle still aches — 2 more days.', 'Your sprained ankle still aches — 1 more day.', 'Your ankle is sound again.']);
    // Healed, the wood costs what it did.
    expect(cost(d)).toBeCloseTo(cost({ ...d, injuries: undefined }), 5);
  });
});
