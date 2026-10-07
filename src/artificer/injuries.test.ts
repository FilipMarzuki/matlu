/**
 * Acceptance tests for #1392 — injuries, part 1: how bad an injury is, how slowly it heals, how
 * working through it can make it worse, and the lasting harm a grave one leaves behind.
 * One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD, FLAT_WORLD } from './world';
import { createExploration, scout } from './exploration';
import { LEVEL_HOURS } from './skills';
import { legacyOf } from './legacy';
import { streamFor, seedOf } from './rng';
import { statEffects, DEFAULT_STATS } from './stats';
import {
  severityOf, injure, nightHealing, strains, readInjury, healedLine, injuryCost,
  SEVERITY_ODDS, HEAL_POINTS, AGGRAVATE_CHANCE, STIFF_KNEE_COST, type Severity,
} from './injuries';

/** A sheltered, stocked Warden in the flat world (no accidents), so the night is a good one. */
function settled(id: string, over: Partial<Region1State> = {}): Region1State {
  const s = createRegion1({ world: FLAT_WORLD }, undefined, { id });
  return {
    ...s, explore: scout(scout(scout(createExploration(), 1), 2), 3), tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' },
    stores: { ...s.stores, rawFood: 9, water: 9, firewood: 30, materials: 10 }, character: { ...s.character, talents: [], quirks: [] }, ...over,
  };
}

describe('Injuries (#1392)', () => {
  // 1. An injury's severity comes from the seeded roll; a tired start makes it one step worse.
  it('rolls how bad an injury is, worse when you set out exhausted', () => {
    const seen: Record<Severity, number> = { minor: 0, serious: 0, grave: 0 };
    for (let i = 0; i < 2000; i++) seen[severityOf(seedOf(`w-sev-${i}`), 5, 10, false)]++;
    // Roughly 60 / 30 / 10.
    expect(seen.minor / 2000).toBeCloseTo(SEVERITY_ODDS.minor, 1);
    expect(seen.serious / 2000).toBeCloseTo(SEVERITY_ODDS.serious, 1);
    expect(seen.grave / 2000).toBeCloseTo(SEVERITY_ODDS.grave, 1);
    // Seeded: the same Warden, day and hour always gives the same answer.
    expect(severityOf(seedOf('w-x'), 5, 10, false)).toBe(severityOf(seedOf('w-x'), 5, 10, false));
    // Tired is one step worse, never past grave.
    for (let i = 0; i < 200; i++) {
      const seed = seedOf(`w-sev-${i}`);
      const rested = severityOf(seed, 5, 10, false);
      expect(severityOf(seed, 5, 10, true)).toBe(rested === 'minor' ? 'serious' : 'grave');
    }
    // A fresh injury needs its severity's healing.
    expect(injure('sprain', 'serious')).toEqual({ kind: 'sprain', severity: 'serious', heal: HEAL_POINTS.serious });
    expect([HEAL_POINTS.minor, HEAL_POINTS.serious, HEAL_POINTS.grave]).toEqual([2, 6, 10]);
    // A grave sprain costs more than a lighter one.
    expect(injuryCost([injure('sprain', 'serious')], 'sprain')).toBe(1.3);
    expect(injuryCost([injure('sprain', 'grave')], 'sprain')).toBe(1.5);
    expect(injuryCost([injure('hand', 'grave')], 'sprain')).toBe(1);
    // An old save's injury (#1286) reads as a minor one with its days left to heal.
    expect(readInjury({ kind: 'sprain', daysLeft: 3 })).toEqual({ kind: 'sprain', severity: 'minor', heal: 3 });
    expect(readInjury({ kind: 'elbow' })).toBeNull();
  });

  // 2. A serious sprain: a good night after a light day heals 2 points × CON; a hungry or cold night, 0.
  it('heals by the night, only when you look after yourself', () => {
    const good = { ate: true, drank: true, cold: false, restful: true, healFactor: 1 };
    expect(nightHealing(good)).toBe(2);
    expect(nightHealing({ ...good, restful: false })).toBe(1);
    expect(nightHealing({ ...good, healFactor: statEffects({ ...DEFAULT_STATS, con: 16 }).heal })).toBeCloseTo(2 * (1 + 0.03 * 6), 10);
    expect(nightHealing({ ...good, ate: false })).toBe(0);
    expect(nightHealing({ ...good, drank: false })).toBe(0);
    expect(nightHealing({ ...good, cold: true })).toBe(0);

    // In play: a restful, fed, sheltered day takes a serious sprain from 6 to 4.
    // (An Adept in First aid can tell how bad it is and how long it will take, #1410.)
    const s = settled('w-heal', { injuries: [injure('sprain', 'serious')], skills: { firstaid: LEVEL_HOURS[3] } });
    const d = runDay(s, ['rest']).state;
    expect(d.injuries).toEqual([{ kind: 'sprain', severity: 'serious', heal: 4 }]);
    expect(d.log.some(l => l.text === 'Your sprained ankle (serious) is mending — about 4 more good nights.')).toBe(true);
    // Untrained, you only know it's mending.
    expect(runDay({ ...s, skills: {} }, ['rest']).state.log.some(l => l.text === 'Your ankle is mending.')).toBe(true);
    // No food: nothing mends, and the journal says why.
    const hungry = runDay({ ...s, stores: { ...s.stores, rawFood: 0 } }, ['rest']).state;
    expect(hungry.injuries).toEqual([{ kind: 'sprain', severity: 'serious', heal: 6 }]);
    expect(hungry.log.some(l => /didn't mend tonight/.test(l.text))).toBe(true);
    // A deep cut bleeds a little each night it's open.
    const cut = runDay({ ...s, injuries: [injure('cut', 'minor')] }, ['rest']).state;
    const clean = runDay({ ...s, injuries: undefined }, ['rest']).state;
    expect(cut.vitals.condition).toBe(clean.vitals.condition - 1);
  });

  // 3. A serious sprain worked through: when the seeded roll hits, it becomes grave, and the journal says so.
  it('can make a serious injury grave if you work through it', () => {
    // Which work strains what: heavy work or the long walk for a sprain, the bench for a hand.
    expect(strains('sprain', 'wood', 1, false)).toBe(true);
    expect(strains('sprain', 'gather', 3, false)).toBe(true);
    expect(strains('sprain', 'gather', 1, false)).toBe(false);
    expect(strains('hand', 'knife', 1, true)).toBe(true);
    expect(strains('hand', 'wood', 1, false)).toBe(false);

    const out = (id: string, injuries = [injure('sprain', 'serious')]): Region1State => {
      const s = createRegion1({ world: { ...FULL_WORLD, luck: false } }, undefined, { id });
      // Apprentice First aid (#1410): you can tell it got worse, and how bad.
      return { ...s, day: 3, hoursToday: 2, weatherToday: 'clear', explore: scout(createExploration(), 1), vitals: createVitals(), injuries, skills: { firstaid: LEVEL_HOURS[2] }, character: { ...s.character, talents: [], quirks: [] } };
    };
    // A Warden whose roll for the hour hits.
    let who = '';
    for (let i = 0; i < 400 && !who; i++) {
      const w = runAction(out(`w-agg-${i}`), 'wood');
      if (w.injuries?.[0]?.severity === 'grave') who = `w-agg-${i}`;
    }
    const worse = runAction(out(who), 'wood');
    expect(worse.injuries).toEqual([{ kind: 'sprain', severity: 'grave', heal: HEAL_POINTS.grave }]);
    expect(worse.log.some(l => l.text === 'You push on through it, and something gives — your sprained ankle is worse now (grave).')).toBe(true);
    // The roll is the seeded 15% for that hour.
    expect(streamFor(seedOf(who), 3, `aggravate:sprain@${worse.log.find(l => /something gives/.test(l.text))!.at!.hour}`)()).toBeLessThan(AGGRAVATE_CHANCE);
    // A minor sprain, or light work, never worsens.
    expect(runAction(out(who, [injure('sprain', 'minor')]), 'wood').injuries).toEqual([injure('sprain', 'minor')]);
    expect(runAction(out(who), 'rest').injuries).toEqual([injure('sprain', 'serious')]);
    // About 15% of Wardens.
    let hit = 0;
    for (let i = 0; i < 400; i++) if (runAction(out(`w-agg-${i}`), 'wood').injuries?.[0]?.severity === 'grave') hit++;
    expect(hit / 400).toBeGreaterThan(0.08);
    expect(hit / 400).toBeLessThan(0.22);
  });

  // 4. A grave injury heals into a lasting harm: a stiff knee, a weak grip, a scar.
  it('leaves a lasting harm when a grave injury heals', () => {
    const s = settled('w-grave');
    const nearly = (kind: 'sprain' | 'hand' | 'cut') => runDay({ ...s, injuries: [{ kind, severity: 'grave', heal: 1 }] }, ['rest']).state;
    const knee = nearly('sprain');
    expect(knee.injuries).toEqual([]);
    expect(knee.character.harms).toEqual(['stiff-knee']);
    expect(knee.log.some(l => l.text === healedLine({ kind: 'sprain', severity: 'grave', heal: 0 }, 'stiff-knee'))).toBe(true);
    expect(nearly('hand').character.harms).toEqual(['weak-grip']);
    expect(nearly('cut').character.harms).toEqual(['scar']);
    // A minor or serious one heals clean.
    expect(runDay({ ...s, injuries: [{ kind: 'sprain', severity: 'serious', heal: 1 }] }, ['rest']).state.character.harms).toBeUndefined();

    // A stiff knee: the walk out to ring 3 costs 1.1× Vigor; work at the camp's doorstep costs the same.
    const harmed: Region1State = { ...s, character: { ...s.character, harms: ['stiff-knee'] } };
    const spent = (w: Region1State, item: 'gather@3' | 'gather') => w.vitals.vigor.current - runAction(w, item).vitals.vigor.current;
    expect(spent(harmed, 'gather@3')).toBeGreaterThan(spent(s, 'gather@3'));
    expect(spent(harmed, 'gather@3')).toBeLessThan(spent(s, 'gather@3') * STIFF_KNEE_COST);
    expect(spent(harmed, 'gather')).toBeCloseTo(spent(s, 'gather'), 10);
    // A weak grip: −1 on the grade score — never better, and at the edge of a grade, a step worse.
    const GRADES = ['crude', 'sound', 'fine', 'masterwork'];
    const knife = (w: Region1State) => GRADES.indexOf(runAction(w, 'knife').tools.find(t => t.item === 'stone-knife')?.grade ?? '') ;
    const gripped = (w: Region1State): Region1State => ({ ...w, character: { ...w.character, harms: ['weak-grip'] } });
    const minds = Array.from({ length: 21 }, (_, i) => ({ ...s, vitals: createVitals({ clarity: 100 - 5 * i }) }));
    for (const w of minds) expect(knife(gripped(w))).toBeLessThanOrEqual(knife(w));
    expect(minds.some(w => knife(gripped(w)) < knife(w))).toBe(true);
    // A scar: a cold night aches, 2 Clarity.
    const exposed = (w: Region1State) => runDay({ ...w, shelter: { type: null, walls: null }, shelterGrade: null, tier: 0 }, ['rest']).state.vitals.clarity.current;
    expect(exposed({ ...s, character: { ...s.character, harms: ['scar'] } })).toBe(exposed(s) - 2);
  });

  // 5. A run that ends with a lasting harm: the next run starts with it, and no open injuries.
  it('carries lasting harms into later runs, but not open injuries', () => {
    const s = settled('w-legacy', { character: { ...settled('w-legacy').character, harms: ['stiff-knee', 'scar'] }, injuries: [injure('hand', 'serious')] });
    const legacy = legacyOf(s);
    expect(legacy.harms).toEqual(['stiff-knee', 'scar']);
    const next = createRegion1({ world: FLAT_WORLD }, legacy, { id: 'w-legacy' });
    expect(next.character.harms).toEqual(['stiff-knee', 'scar']);
    expect(next.injuries).toBeUndefined();
    // A character with none carries none.
    expect(legacyOf(settled('w-clean')).harms).toBeUndefined();
  });
});
