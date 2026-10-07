/**
 * Acceptance tests for #1394 — injuries, part 3: healers on the road. Ottilia on the wagon and each
 * village's healer tend an injury — free for a friend, else for marks — and, trusting you enough,
 * set a grave one so it heals without a lasting harm. One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { createVitals } from './vitality';
import { DEFAULT_STATS } from './stats';
import { createRoad, endRoadDay, runRoadAction, peopleHere, villageOf, healFee, ROUTE, type RoadState } from './road';
import { injure, HEAL_FEE, HEAL_HOURS, FRIEND_HEAL, SET_BONE_TRUST, HEALER_POINTS, healerTarget, type Injury } from './injuries';
import { parseRoadDecision } from '../artificer-ai/decision';
import { observeRoad } from '../artificer-ai/observe';

function survived(): Region1State {
  const s = createRegion1({}, undefined, { id: 'w-heal', name: 'Vega', stats: { ...DEFAULT_STATS } });
  const vitals = createVitals({ condition: 90 });
  return { ...s, day: 61, vitals, stores: { ...s.stores, rawFood: 10, water: 10 }, outcome: { choice: 'thaw', kind: 'survived', grade: 'hale', vitals } };
}
/** On the wagon (the first leg), hurt, with this trust in Ottilia. */
const wagon = (injuries: Injury[], trust = 0, marks = 0): RoadState => {
  const r = createRoad(survived());
  return { ...r, injuries, marks, trust: { ...r.trust, 'cv-ottilia': trust } };
};
/** In a village, hurt, with this trust in its healer. */
function village(injuries: Injury[], trust: number, marks: number): { r: RoadState; healer: string } {
  let s = createRoad(survived());
  const leg = ROUTE.findIndex(l => l.kind === 'village');
  while (s.leg < leg && !s.outcome) s = endRoadDay(s);
  const healer = peopleHere(s).find(p => p.role === 'healer')!.id;
  return { r: { ...s, injuries, marks, trust: { ...s.trust, [healer]: trust } }, healer };
}

describe('Healers on the road (#1394)', () => {
  // 1. A serious injury on the road, Ottilia at trust 40+: treated, 2 points healed, free.
  it('lets Ottilia tend an injury for free, for a friend', () => {
    const r = wagon([injure('sprain', 'serious')], FRIEND_HEAL, 3);
    expect(villageOf(r)).toBeNull();
    const after = runRoadAction(r, 'heal:cv-ottilia');
    expect(after.injuries).toEqual([{ kind: 'sprain', severity: 'serious', heal: 6 - HEALER_POINTS, treated: 'good' }]);
    expect(after.marks).toBe(3);
    expect(after.hoursToday).toBe(r.hoursToday + HEAL_HOURS);
    expect(after.log.at(-1)?.text).toMatch(/^Ottilia tends your sprained ankle\. — no charge between friends/);
    // Treated, it heals faster from here on.
    expect(healFee(r, 'cv-ottilia')).toBe(0);
  });

  // 2. A village healer, trust under 40: it costs marks — refused without them, with the reason.
  it('charges marks below trust 40, and refuses without them', () => {
    const { r, healer } = village([injure('cut', 'serious')], FRIEND_HEAL - 1, HEAL_FEE);
    const paid = runRoadAction(r, `heal:${healer}`);
    expect(paid.marks).toBe(0);
    expect(paid.injuries?.[0].treated).toBe('good');
    const broke = runRoadAction({ ...r, marks: HEAL_FEE - 1 }, `heal:${healer}`);
    expect(broke.injuries).toEqual(r.injuries);
    expect(broke.hoursToday).toBe(r.hoursToday);
    expect(broke.log.at(-1)?.text).toMatch(new RegExp(`asks ${HEAL_FEE} marks for her care; you have ${HEAL_FEE - 1}`));
    // No healer by that name, or no one hurt: skipped.
    expect(runRoadAction(r, 'heal:cv-ottilia').log.at(-1)?.text).toMatch(/no healer called cv-ottilia here/);
    expect(runRoadAction({ ...r, injuries: undefined }, `heal:${healer}`).log.at(-1)?.text).toMatch(/finds nothing that needs her/);
  });

  // 3. A grave injury, a healer at trust 60+: it will heal without a lasting harm.
  it('sets a grave injury properly at trust 60+, so it heals without a harm', () => {
    const grave = injure('sprain', 'grave');
    const set = runRoadAction(wagon([grave], SET_BONE_TRUST), 'heal:cv-ottilia');
    expect(set.injuries?.[0]).toMatchObject({ severity: 'grave', mended: true, treated: 'good' });
    expect(set.log.at(-1)?.text).toMatch(/sets it properly — it will heal straight/);
    // Below 60, tended but not set.
    expect(runRoadAction(wagon([grave], SET_BONE_TRUST - 1), 'heal:cv-ottilia').injuries?.[0].mended).toBeUndefined();
    // Even one already treated is worth taking back to a healer who trusts you enough.
    expect(healerTarget([{ ...grave, treated: 'fair' }], SET_BONE_TRUST)?.severity).toBe('grave');
    expect(healerTarget([{ ...grave, treated: 'fair' }], SET_BONE_TRUST - 1)).toBeNull();
    // Healed: no lasting harm for the set one; a stiff knee for the other.
    const heals = (i: Injury) => {
      let r = wagon([{ ...i, heal: 1 }], 0);
      for (let d = 0; d < 6 && r.injuries?.length; d++) r = endRoadDay(r);
      return r;
    };
    expect(heals({ ...grave, mended: true }).character.harms).toBeUndefined();
    expect(heals(grave).character.harms).toEqual(['stiff-knee']);
    // An old harm can't be undone, but she'll tell you about it.
    const old = runRoadAction({ ...wagon([], 0), character: { ...wagon([], 0).character, harms: ['scar'] } }, 'heal:cv-ottilia');
    expect(old.log.at(-1)?.text).toMatch(/^Ottilia looks at your scar: "An old cut/);
  });

  // The AI can ask for it, and sees who can heal.
  it('lets the AI ask a healer, and shows it who can', () => {
    expect(parseRoadDecision('{"thoughts":"","actions":["heal:cv-ottilia"]}').ok).toBe(true);
    const r = wagon([injure('sprain', 'serious')], 0);
    expect(observeRoad(r)).toMatch(/INJURIES: serious sprained ankle, 6 healing to go, untreated/);
    expect(observeRoad(r)).toMatch(/HEALERS HERE: cv-ottilia \(4 marks\)/);
  });
});
