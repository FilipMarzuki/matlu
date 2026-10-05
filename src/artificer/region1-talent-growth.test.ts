/**
 * Acceptance tests for #1264 — talents grow quietly with use through tiers
 * 1–4. The tier is never shown, only felt. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, endDay, sleepNight, type Region1State } from './region1';
import { createVitals } from './vitality';
import { legacyOf } from './legacy';
import { createRoad } from './road';
import { TALENTS, TIER_UP_LINE, tierFor, type Talent, type TalentId } from './talents';
import { newRun } from '../artificer-app/controller';

const t = (id: TalentId, tier = 1, growth = 0, known = true): Talent => ({ id, tier, known, growth });
const warden = (talents: Talent[], over: Partial<Region1State> = {}): Region1State => {
  const s = runAction(createRegion1({}, undefined, { name: 'Test', talents }), 'scout');
  return { ...s, hoursToday: 0, vitals: createVitals(), ...over };
};
const talent = (s: Region1State, id: TalentId) => s.character.talents.find(x => x.id === id)!;
const newLines = (a: Region1State, b: Region1State) => b.log.slice(a.log.length).map(l => l.text).join('\n');
/** One night, fed and watered unless told otherwise; warm (roofed) unless `cold`. */
function night(talents: Talent[], o: { fed?: boolean; cold?: boolean; condition?: number } = {}): Region1State {
  const s = structuredClone(warden(talents, { stores: { ...warden([]).stores, rawFood: o.fed === false ? 0 : 5, water: 5 }, vitals: createVitals({ condition: o.condition ?? 80 }) }));
  sleepNight(s, { warmth: o.cold ? 0.1 : 0.8, coldNight: o.cold ?? false, lockedToday: false });
  return s;
}

describe('Talent growth (#1264)', () => {
  it('reaches tiers at 30, 150 and 600 hours', () => {
    expect([0, 29, 30, 149, 150, 599, 600, 5000].map(tierFor)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
  });

  // 1. Forager grows from gathering and steps up a tier — felt, not named.
  it('grows a talent through use, and lets you feel it without naming it', () => {
    const before = warden([t('forager', 1, 27)]);
    const after = runAction(before, 'gather');
    expect(talent(after, 'forager')).toMatchObject({ tier: 2 });
    expect(talent(after, 'forager').growth).toBeGreaterThanOrEqual(30);
    const lines = newLines(before, after);
    expect(lines).toContain(TIER_UP_LINE);
    expect(lines).not.toMatch(new RegExp(`${TALENTS.forager.name}|tier|knack|spark`, 'i'));
    // Work it doesn't train leaves it be.
    expect(talent(runAction(warden([t('forager')]), 'wood'), 'forager').growth ?? 0).toBe(0);
  });

  // 2. Light Eater grows from hungry nights only.
  it('grows Light Eater from hungry nights', () => {
    expect(talent(night([t('lightEater')], { fed: false }), 'lightEater').growth).toBe(4);
    expect(talent(night([t('lightEater')]), 'lightEater').growth ?? 0).toBe(0);
  });

  // 3. Cold-blooded grows from cold nights.
  it('grows Cold-blooded from cold nights', () => {
    expect(talent(night([t('coldBlooded')], { cold: true }), 'coldBlooded').growth).toBe(4);
    expect(talent(night([t('coldBlooded')]), 'coldBlooded').growth ?? 0).toBe(0);
  });

  // 4. Tough grows from nights ending under 50 Condition.
  it('grows Tough from nights spent worn down', () => {
    expect(talent(night([t('tough')], { condition: 30 }), 'tough').growth).toBe(4);
    expect(talent(night([t('tough')], { condition: 90 }), 'tough').growth ?? 0).toBe(0);
  });

  // 5. A hidden talent grows exactly like a known one.
  it('grows hidden talents too', () => {
    const known = runAction(warden([t('waterfinder', 1, 0, true)]), 'water');
    const hidden = runAction(warden([t('waterfinder', 1, 0, false)]), 'water');
    expect(talent(hidden, 'waterfinder').growth).toBe(talent(known, 'waterfinder').growth);
    expect(talent(hidden, 'waterfinder').growth).toBeGreaterThan(0);
    expect(talent(hidden, 'waterfinder').known).toBe(false);
  });

  // 6. Mastery is the top.
  it('never grows past tier 4', () => {
    const s = runAction(warden([t('forager', 4, 600)]), 'gather');
    expect(talent(s, 'forager')).toMatchObject({ tier: 4, growth: 600 });
  });

  // 7. Growth carries with the character, and onto the road.
  it('carries growth and tiers over', () => {
    const grown = [t('hardy', 2, 40), t('forager', 3, 160, false)];
    const done = { ...warden(grown), character: { ...warden(grown).character, id: 'w-vega' }, outcome: { choice: 'winter' as const, kind: 'grim' as const, vitals: createVitals() } };
    expect(newRun(done).sim.character.talents).toEqual(grown);
    expect(createRegion1({}, legacyOf(done)).character.talents).toEqual(grown);
    expect(createRoad({ ...done, outcome: { choice: 'caravan', kind: 'thrive', vitals: createVitals() } }).character.talents).toEqual(grown);
  });

  // Crafting and study grow the hands and mind; the night's growth also runs through endDay.
  it('grows Careful Hands and Sharp-minded from crafting and study, and Light Eater through a full night', () => {
    const base = chooseSite(warden([t('carefulHands'), t('sharp')]), 'cave');
    const crafted = runAction({ ...base, stores: { ...base.stores, materials: 20 } }, 'coldGear');
    expect(talent(crafted, 'carefulHands').growth).toBeGreaterThan(0);
    expect(talent(crafted, 'sharp').growth).toBeGreaterThan(0);
    const studied = runAction(warden([t('sharp')]), { q: 'study', opts: { concept: 'joinery' } });
    expect(talent(studied, 'sharp').growth).toBe(3);
    const s = warden([t('lightEater')], { stores: { ...warden([]).stores, rawFood: 0, water: 5 } });
    expect(talent(endDay(s), 'lightEater').growth).toBe(4);
  });
});
