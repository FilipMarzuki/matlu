/**
 * Acceptance tests for #1393 — injuries, part 2: treating an injury at camp (a first-aid dressing,
 * or improvised: bind, splint, herbs), and an untreated deep cut that festers.
 * One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, blockedReason, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD, FLAT_WORLD } from './world';
import { createExploration, scout } from './exploration';
import { streamFor, seedOf } from './rng';
import { LEVEL_HOURS } from './skills';
import { injure, treatmentQuality, worstUntreated, FESTER_CHANCE, type Injury } from './injuries';
import { observe } from '../artificer-ai/observe';

/** A sheltered, stocked Warden in the flat world, so the night is a good one. */
function settled(id: string, over: Partial<Region1State> = {}): Region1State {
  const s = createRegion1({ world: FLAT_WORLD }, undefined, { id });
  return {
    ...s, explore: scout(createExploration(), 1), tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' },
    stores: { ...s.stores, rawFood: 9, water: 9, firewood: 30, materials: 10 }, character: { ...s.character, talents: [], quirks: [] }, ...over,
  };
}
const line = (s: Region1State, re: RegExp) => s.log.some(l => re.test(l.text));

describe('Treating injuries (#1393)', () => {
  // 1. A serious sprain, 1 firewood + 1 materials, no dressings: splinted, goods spent, +1 a night from then on.
  it('splints a sprain with a stick and lashing', () => {
    const s = settled('w-splint', { injuries: [injure('sprain', 'serious')] });
    const t = runAction(s, 'treat');
    expect(t.injuries).toEqual([{ kind: 'sprain', severity: 'serious', heal: 6, treated: 'fair' }]);
    expect(t.stores.firewood).toBe(s.stores.firewood - 1);
    expect(t.stores.materials).toBe(s.stores.materials - 1);
    expect(t.hoursToday).toBe(s.hoursToday + 1);
    expect(line(t, /You splint the sprained ankle/)).toBe(true);
    // A good, restful night heals 2 — and the splint 1 more.
    expect(runDay(t, []).state.injuries).toEqual([{ kind: 'sprain', severity: 'serious', heal: 3, treated: 'fair' }]);
    expect(runDay(s, ['rest']).state.injuries).toEqual([{ kind: 'sprain', severity: 'serious', heal: 4 }]);
    // A bad night heals nothing, treated or not.
    expect(runDay({ ...t, stores: { ...t.stores, rawFood: 0 } }, []).state.injuries?.[0].heal).toBe(6);
    // A splinted sprain won't give under heavy work, whoever's hour it is.
    for (let i = 0; i < 200; i++) {
      const w = createRegion1({ world: { ...FULL_WORLD, luck: false } }, undefined, { id: `w-agg-${i}` });
      const out = { ...w, day: 3, hoursToday: 2, weatherToday: 'clear' as const, explore: scout(createExploration(), 1), vitals: createVitals(), injuries: [{ ...injure('sprain', 'serious'), treated: 'fair' as const }] };
      expect(runAction(out, 'wood').injuries?.[0].severity).toBe('serious');
    }
  });

  // 2. A first-aid kit: a dressing is used instead of goods, and the treatment is one step better.
  it('uses a first-aid dressing when there is one, and treats better', () => {
    const s = settled('w-kit', { injuries: [injure('cut', 'serious')], dressings: 2 });
    const t = runAction(s, 'treat');
    expect(t.dressings).toBe(1);
    expect(t.stores).toEqual(s.stores);
    expect(t.injuries?.[0].treated).toBe('fair');
    // The same Warden binding it with cloth: fair too, at no First aid — the dressing is the step up.
    expect(treatmentQuality(0, true)).toBe('fair');
    expect(treatmentQuality(0, false)).toBe('fair');
    // A scout (First aid Apprentice) with a dressing: good. Without one: fair.
    const scout1 = settled('w-scout', { injuries: [injure('cut', 'serious')], dressings: 1, skills: { firstaid: LEVEL_HOURS[2] } });
    expect(runAction(scout1, 'treat').injuries?.[0].treated).toBe('good');
    expect(runAction({ ...scout1, dressings: 0 }, 'treat').injuries?.[0].treated).toBe('fair');
    // With no materials, a cut is bound with soft hide — a better dressing.
    const hide = runAction({ ...scout1, dressings: 0, stores: { ...scout1.stores, materials: 0, hides: 1 } }, 'treat');
    expect(hide.stores.hides).toBe(0);
    expect(hide.injuries?.[0].treated).toBe('good');
    expect(line(hide, /bind it with soft hide/)).toBe(true);
    // A hurt hand is eased with herbs: 1 food.
    const hand = runAction(settled('w-hand', { injuries: [injure('hand', 'minor')] }), 'treat');
    expect(hand.stores.rawFood).toBe(8);
    expect(line(hand, /poultice for the hurt hand/)).toBe(true);
    // The worst untreated injury is the one tended.
    expect(worstUntreated([injure('hand', 'minor'), injure('sprain', 'grave'), injure('cut', 'serious')])?.kind).toBe('sprain');
    expect(worstUntreated([{ ...injure('sprain', 'grave'), treated: 'good' }, injure('hand', 'minor')])?.kind).toBe('hand');
    // The AI sees it all.
    expect(observe(t)).toMatch(/deep cut .*treated \(fair\) · first-aid dressings: 1/);
  });

  // 3. An untreated serious deep cut: when the night's roll hits, it festers — grave, −5 Condition. A treated one never does.
  it('lets an untreated serious cut fester', () => {
    let who = '';
    for (let i = 0; i < 400 && !who; i++) if (streamFor(seedOf(`w-fester-${i}`), 1, 'fester')() < FESTER_CHANCE) who = `w-fester-${i}`;
    const s = settled(who, { injuries: [injure('cut', 'serious')] });
    const bad = runDay(s, ['rest']).state;
    expect(bad.injuries?.[0]).toMatchObject({ kind: 'cut', severity: 'grave' });
    expect(line(bad, /has gone bad overnight/)).toBe(true);
    const tended = runDay(s, ['treat']).state;
    expect(tended.injuries?.[0]).toMatchObject({ kind: 'cut', severity: 'serious', treated: 'fair' });
    // −5 for the festering, against the same night tended (both bleed 1).
    const clean = runDay({ ...s, injuries: [{ ...injure('cut', 'serious'), treated: 'fair' }] }, ['rest']).state;
    expect(bad.vitals.condition).toBe(clean.vitals.condition - 5);
    // Only serious cuts: a minor one, or a sprain, never festers.
    expect(runDay({ ...s, injuries: [injure('cut', 'minor')] }, ['rest']).state.injuries?.[0]?.severity ?? 'minor').toBe('minor');
    expect(runDay({ ...s, injuries: [injure('sprain', 'serious')] }, ['rest']).state.injuries?.[0].severity).toBe('serious');
  });

  // 4. No injury, or nothing to treat it with: blocked, with the reason.
  it('is blocked with the reason', () => {
    const s = settled('w-block');
    expect(blockedReason(s, 'treat', 1)).toBe('you have no injuries to tend');
    expect(blockedReason({ ...s, injuries: [{ ...injure('sprain', 'minor'), treated: 'fair' }] }, 'treat', 1)).toBe('your injuries are already tended');
    const bare = { ...s, stores: { ...s.stores, materials: 0, firewood: 0, rawFood: 0, hides: 0 } };
    expect(blockedReason({ ...bare, injuries: [injure('sprain', 'serious')] }, 'treat', 1)).toBe('a splint needs 1 firewood and 1 materials');
    expect(blockedReason({ ...bare, injuries: [injure('cut', 'serious')] }, 'treat', 1)).toBe('binding a cut needs a dressing, 1 materials or a hide');
    expect(blockedReason({ ...bare, injuries: [injure('hand', 'serious')] }, 'treat', 1)).toBe('easing a hurt hand needs herbs — 1 food');
    // A dressing does for anything.
    expect(blockedReason({ ...bare, injuries: [injure('sprain', 'serious')], dressings: 1 }, 'treat', 1)).toBeNull();
    // Blocked costs nothing.
    const tried = runAction(s, 'treat');
    expect(tried.hoursToday).toBe(s.hoursToday);
  });

  // 5. Higher First aid: a better treatment, faster healing; treating practises the skill.
  it('treats better with more First aid, and practises it', () => {
    const at = (hours: number): Region1State => settled('w-fa', { injuries: [injure('sprain', 'serious')], skills: { firstaid: hours } });
    const novice = runAction(at(LEVEL_HOURS[1]), 'treat');
    const journeyman = runAction(at(LEVEL_HOURS[4]), 'treat');
    expect(novice.injuries?.[0].treated).toBe('fair');
    expect(journeyman.injuries?.[0].treated).toBe('good');
    // A good treatment heals 2 more a night than none at all, a fair one 1.
    const healed = (s: Region1State) => 6 - (runDay(s, []).state.injuries as Injury[])[0].heal;
    expect(healed(journeyman)).toBe(healed(novice) + 1);
    // An hour's practice of First aid.
    expect(novice.skills.firstaid).toBeGreaterThan(LEVEL_HOURS[1]);
  });
});
