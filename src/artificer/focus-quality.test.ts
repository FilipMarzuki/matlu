/**
 * Acceptance tests for #1490 — the owner's rule: focus doesn't make work faster. A focused Warden
 * learns more, makes better things and succeeds more often — in the Reach and on the road.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, blockedReason, ACTIONS, type ActionId, type Region1State } from './region1';
import { createVitals } from './vitality';
import { craftGrade } from './crafting';
import { focusGrade, FOCUS_GRADE, GOALS, SKILL_PRACTICE, type Focus } from './focus';
import { chanceOf, FOCUS_ODDS, type EncounterOption } from './encounters';
import { createRoad, runRoadAction, villageOf, type RoadState } from './road';
import { SKILL_IDS } from './skills';
import { scout, createExploration } from './exploration';

const HANDCRAFT: Focus = { kind: 'skill', id: 'handcraft' };

/** A Warden at the bench with the makings of a few bedrolls (a handcraft craft), at `clarity`. */
function benchWarden(clarity: number, int: number, focus: Focus | null): Region1State {
  const s = createRegion1({}, undefined, { id: 'w-quality', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  // Scouted, as the road's craft view is: the Reach won't let you work land you don't know yet.
  return { ...s, focus, known: [...s.known, 'bedroll'], explore: scout(createExploration(), 1), vitals: createVitals({ vigor: 90, clarity, condition: 95 }), stores: { ...s.stores, materials: 30, hides: 6 }, character: { ...s.character, stats: { ...s.character.stats, int } } };
}
const gradeOf = (s: Region1State): string | undefined => runAction(s, 'bedroll').tools.find(t => t.item === 'bedroll')?.grade;
const GRADE_ORDER = ['crude', 'sound', 'fine', 'masterwork'];

describe('Focus makes work better, not faster (#1490)', () => {
  // 1. A focused skill lifts a craft just under a grade edge by one grade; below the reliable line, half that.
  it('lifts a focused craft a grade at the edge', () => {
    expect(focusGrade(HANDCRAFT, 'handcraft', [], 80, 30)).toBe(FOCUS_GRADE);
    expect(focusGrade(HANDCRAFT, 'handcraft', [], 20, 30)).toBe(FOCUS_GRADE / 2);
    expect(focusGrade({ kind: 'skill', id: 'hunting' }, 'handcraft', [], 80, 30)).toBe(0);
    expect(focusGrade({ kind: 'concept', id: 'sealing' }, 'handcraft', ['sealing'], 80, 30)).toBe(FOCUS_GRADE);
    // At a score of 5 (one short of fine), the full bonus crosses the edge and half of it doesn't.
    // band 2 + bench tier 1 (which caps at fine) + tools 2 = 5.
    const q = { band: 2, benchTier: 1, conceptRank: 0, recipeTier: 0 };
    expect(craftGrade({ ...q, tools: 2 })).toBe('sound');
    expect(craftGrade({ ...q, tools: 2 + FOCUS_GRADE })).toBe('fine');
    expect(craftGrade({ ...q, tools: 2 + FOCUS_GRADE / 2 })).toBe('sound');
    // In play: across Wardens of every INT, focus never makes a bedroll worse, and lifts some by exactly one grade.
    expect(gradeOf(benchWarden(90, 10, null))).toBeDefined(); // a bedroll does get made
    let lifted = 0;
    for (let int = 3; int <= 18; int++) {
      const plain = GRADE_ORDER.indexOf(gradeOf(benchWarden(90, int, null)) ?? '');
      const focused = GRADE_ORDER.indexOf(gradeOf(benchWarden(90, int, HANDCRAFT)) ?? '');
      expect(focused - plain).toBeGreaterThanOrEqual(0);
      expect(focused - plain).toBeLessThanOrEqual(1);
      if (focused > plain) lifted++;
    }
    expect(lifted).toBeGreaterThan(0);
  });

  // 2. An option that counts scouting is likelier with scouting the focus, and unchanged with any other.
  it('raises the odds of an option that counts the focused skill', () => {
    const w = benchWarden(90, 10, null);
    const o = { id: 'look', label: 'Look', odds: 0.5, mods: { skills: { scouting: 0.05 } }, success: { text: '' }, fail: { text: '' } } as EncounterOption;
    const none = chanceOf(w, o);
    expect(chanceOf({ ...w, focus: { kind: 'skill', id: 'scouting' } }, o)).toBeCloseTo(none + FOCUS_ODDS);
    expect(chanceOf({ ...w, focus: { kind: 'skill', id: 'hunting' } }, o)).toBe(none);
    expect(chanceOf({ ...w, focus: { kind: 'goal', id: 'explore' } }, o)).toBe(none);
  });

  // 3. On the road, a focused skill's wagon craft practises ×3 and gets the quality bonus.
  it('makes a focused wagon craft teach more, and come out better', () => {
    const s = createRegion1({}, undefined, { id: 'w-wagon', name: 'Ilse', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
    const vitals = createVitals({ vigor: 90, clarity: 90, condition: 95 });
    const from: Region1State = { ...s, day: 61, vitals, known: [...s.known, 'bedroll'], stores: { ...s.stores, rawFood: 30, water: 30, materials: 20 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
    const road: RoadState = createRoad(from);
    expect(villageOf(road)).toBeNull(); // on the wagon
    const practised = (focus: Focus | null) => {
      const before = { ...road, focus };
      const after = runRoadAction(before, 'craft:bedroll');
      return (after.skills.handcraft ?? 0) - (before.skills.handcraft ?? 0);
    };
    const plain = practised(null);
    expect(plain).toBeGreaterThan(0);
    expect(practised(HANDCRAFT)).toBeCloseTo(plain * SKILL_PRACTICE);
    // The bonus reaches the wagon: the same craft is never worse, and with INT tuned to an edge, better.
    let lifted = 0;
    for (let int = 3; int <= 18; int++) {
      const at = (focus: Focus | null) => runRoadAction({ ...road, focus, character: { ...road.character, stats: { ...road.character.stats, int } } }, 'craft:bedroll').tools.find(t => t.item === 'bedroll')?.grade ?? '';
      const d = GRADE_ORDER.indexOf(at(HANDCRAFT)) - GRADE_ORDER.indexOf(at(null));
      expect(d).toBeGreaterThanOrEqual(0);
      if (d > 0) lifted++;
    }
    expect(lifted).toBeGreaterThan(0);
  });

  // 4. No focus shortens anything: every action takes the hours it takes without one.
  it('never changes how long an action takes', () => {
    const s = benchWarden(90, 10, null);
    const focuses: Focus[] = [
      ...(Object.keys(GOALS) as (keyof typeof GOALS)[]).map(id => ({ kind: 'goal', id }) as Focus),
      ...SKILL_IDS.map(id => ({ kind: 'skill', id }) as Focus),
      { kind: 'concept', id: 'sealing' },
    ];
    let checked = 0;
    for (const id of Object.keys(ACTIONS) as ActionId[]) {
      if (blockedReason(s, id, 1)) continue;
      const hours = runAction(s, id).hoursToday;
      for (const f of focuses) expect([id, f.kind, f.id, runAction({ ...s, focus: f }, id).hoursToday]).toEqual([id, f.kind, f.id, hours]);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });
});
