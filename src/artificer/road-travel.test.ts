/**
 * Acceptance tests for #1245 — travel days on the wagon: craft, study, tend,
 * talk to the fellow travellers, help the caravan. One test per Given/When/Then.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, creditedPractice, runAction, type Region1State } from './region1';
import { applyActivity, createVitals } from './vitality';
import { createRoad, endRoadDay, runRoadAction, villageOf, ROUTE, HELP_HOURS, HELP_VIGOR_RATE, TRAVELLER_INSIGHT, WAGON_CRAFT_HOURS, type RoadState } from './road';
import { TRAVELLERS } from './villages';
import { createExploration, scout } from './exploration';

/** A hale Region 1 run at the thaw, with no cold gear yet. */
function survived(): Region1State {
  const s = createRegion1({}, undefined, { id: 'w-vega', name: 'Vega' });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, tools: [], stores: { ...s.stores, rawFood: 10, water: 10, materials: 3 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
}
const wagon = (): RoadState => createRoad(survived());
const lastLine = (s: RoadState): string => s.log.at(-1)?.text ?? '';

describe('Travel days on the wagon (#1245)', () => {
  // 1. 3 materials and cold gear known: crafted at Region 1's grade, materials spent, handcraft +4h practice.
  it('crafts on the wagon as Region 1 would', () => {
    const r = wagon();
    expect(villageOf(r)).toBeNull();
    expect(r.known).toContain('cold-gear');
    const after = runRoadAction(r, 'craft:cold-gear');
    // What Region 1 makes of the same Warden, materials and mind, by day.
    const reach = runAction({ ...survived(), outcome: null, day: 1, hoursToday: 0, weatherToday: 'clear', explore: scout(createExploration(), 1), vitals: r.vitals, character: r.character, skills: r.skills }, 'coldGear');
    const made = after.tools.find(t => t.item === 'cold-gear');
    expect(made?.grade).toBe(reach.tools.find(t => t.item === 'cold-gear')?.grade);
    expect(after.stores.materials).toBe(0);
    expect(after.hoursToday).toBe(r.hoursToday + WAGON_CRAFT_HOURS);
    expect((after.skills.handcraft ?? 0) - (r.skills.handcraft ?? 0)).toBeCloseTo(creditedPractice(r, 'handcraft', 4, 'none'));
  });

  // 2. Gather, wood, build or scout on a travel day: "Not from the wagon", no hours.
  it('refuses camp and land work on the wagon', () => {
    const r = wagon();
    for (const id of ['gather', 'wood', 'build', 'scout'] as const) {
      const after = runRoadAction(r, id);
      expect(lastLine(after)).toContain('Not from the wagon');
      expect(after.hoursToday).toBe(r.hoursToday);
      expect(after.stores).toEqual(r.stores);
    }
  });

  // 3. Three talks with the tinker: three lines in order, Leverage +1.5 insight. A fourth gives no new line.
  it('hears the tinker out, three lines and a little leverage', () => {
    const pim = TRAVELLERS.find(t => t.role === 'tinker')!;
    expect(pim.concept).toBe('leverage');
    let r = wagon();
    const before = r.concepts.leverage?.insight ?? 0;
    const lines: string[] = [];
    for (let i = 0; i < 3; i++) { r = runRoadAction({ ...r, hoursToday: 0 }, `talk:${pim.id}`); lines.push(lastLine(r)); }
    lines.forEach((l, i) => expect(l).toContain(pim.lore[i].text));
    expect((r.concepts.leverage?.insight ?? 0) - before).toBeCloseTo(3 * TRAVELLER_INSIGHT);
    const fourth = runRoadAction({ ...r, hoursToday: 0 }, `talk:${pim.id}`);
    expect(pim.lore.some(l => lastLine(fourth).includes(l.text))).toBe(false);
    expect(fourth.concepts.leverage?.insight).toBe(r.concepts.leverage?.insight);
  });

  // 4. At 40 Vigor, help: Vigor drops by the help cost, food +1.
  it('helps drive the caravan for an extra portion', () => {
    const r0 = wagon();
    const r = { ...r0, vitals: { ...r0.vitals, vigor: { ...r0.vitals.vigor, current: 40 } } };
    const after = runRoadAction(r, 'help');
    // The help cost: four hours at the help rate, through the same drain as any work.
    expect(after.vitals.vigor.current).toBeCloseTo(applyActivity(r.vitals, { hours: HELP_HOURS, vigorRate: HELP_VIGOR_RATE, clarityRate: 0 }).vitals.vigor.current);
    expect(after.vitals.vigor.current).toBeLessThan(40);
    expect(after.stores.rawFood).toBe(r.stores.rawFood + 1);
    expect(after.hoursToday).toBe(HELP_HOURS);
  });

  // 5. A village day: help and talking to a traveller are refused with a reason, no hours.
  it('keeps wagon-only actions on the wagon', () => {
    let r = wagon();
    const village = ROUTE.findIndex(l => l.kind === 'village');
    while (r.leg < village) r = endRoadDay(r);
    expect(villageOf(r)).toBe('hollowford');
    for (const id of ['help', `talk:${TRAVELLERS[1].id}`] as const) {
      const after = runRoadAction(r, id);
      expect(lastLine(after)).toMatch(/skipped — .+/);
      expect(after.hoursToday).toBe(r.hoursToday);
    }
  });

  it('studies and mends on the road', () => {
    const r = wagon();
    const studied = runRoadAction(r, 'study:joinery');
    expect(studied.concepts.joinery?.insight ?? 0).toBeGreaterThan(r.concepts.joinery?.insight ?? 0);
    expect(studied.hoursToday).toBe(3);
    // Nothing worn: nothing to mend. A worn tool goes back up a grade.
    expect(lastLine(runRoadAction(r, 'tend'))).toMatch(/nothing needs mending/);
    const worn = runRoadAction({ ...r, tools: [{ item: 'stone-knife', grade: 'crude', crafted: 'sound' }] }, 'tend');
    expect(worn.tools[0].grade).toBe('sound');
  });
});
