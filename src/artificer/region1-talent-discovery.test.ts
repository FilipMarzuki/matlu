/**
 * Acceptance tests for #1265 — discovering a hidden talent. A hidden talent works before you
 * know it; each time it makes a noticeable difference that's a sign. At 2 signs the journal
 * hints, at 4 it hints closer, and at 6 the talent is revealed. One test per Given/When/Then.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, runDay, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FLAT_WORLD } from './world';
import { createExploration, scout } from './exploration';
import { legacyOf } from './legacy';
import { TALENTS, TALENT_IDS, HINTS, signOf, giftLine, type Talent } from './talents';

/** A sheltered, stocked Warden in the flat world (no accidents), with one known talent and the given hidden one. */
function warden(hidden: Talent, over: Partial<Region1State> = {}): Region1State {
  const s = createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-gift' });
  return {
    ...s, explore: scout(scout(scout(createExploration(), 1), 2), 3), tier: 2, shelterGrade: 'sound', shelter: { type: 'leanto', walls: 'timber' },
    stores: { ...s.stores, rawFood: 9, water: 9, firewood: 30, materials: 20 }, vitals: createVitals({ clarity: 80 }),
    character: { ...s.character, talents: [{ id: 'sharp', tier: 1, known: true }, hidden], quirks: [] }, ...over,
  };
}
const hiddenOf = (s: Region1State) => s.character.talents.find(t => t.id !== 'sharp')!;
const count = (s: Region1State, text: string) => s.log.filter(l => l.text === text).length;

describe('Discovering a hidden talent (#1265)', () => {
  // 1. A hidden Waterfinder at tier 2 (+1 water): two water trips are two signs, and one vague hint.
  it('counts a sign each time the hidden talent brings home more', () => {
    let s = warden({ id: 'waterfinder', tier: 2, known: false });
    s = runAction(s, 'water');
    expect(hiddenOf(s).signs).toBe(1);
    expect(count(s, HINTS.waterfinder.vague)).toBe(0);
    s = runAction(s, 'water');
    expect(hiddenOf(s).signs).toBe(2);
    expect(count(s, HINTS.waterfinder.vague)).toBe(1);
    expect(hiddenOf(s).known).toBe(false);
    // At tier 1 it adds nothing yet, so there's nothing to notice.
    expect(hiddenOf(runAction(warden({ id: 'waterfinder', tier: 1, known: false }), 'water')).signs).toBeUndefined();
  });

  // 2. Hardy: saving under 2 Vigor isn't a sign; 2 or more is.
  it('needs a difference big enough to notice', () => {
    expect(signOf({ vigor: 1.9 })).toBe(false);
    expect(signOf({ vigor: 2 })).toBe(true);
    expect(signOf({ yield: 1 })).toBe(true);
    expect(signOf({ clung: true })).toBe(true);
    // In play: a short water trip with Hardy at tier 1 saves a fraction of a point — no sign…
    expect(hiddenOf(runAction(warden({ id: 'hardy', tier: 1, known: false }), 'water')).signs).toBeUndefined();
    // …a stint of felling with Hardy at its height saves several — a sign.
    expect(hiddenOf(runAction(warden({ id: 'hardy', tier: 4, known: false }), 'wood')).signs).toBe(1);
  });

  // 3. At 5 signs, the sixth reveals it: known, and "You have a gift: <Name>."
  it('reveals the talent at the sixth sign', () => {
    const s = runAction(warden({ id: 'waterfinder', tier: 2, known: false, signs: 5 }), 'water');
    expect(hiddenOf(s)).toMatchObject({ known: true, signs: 6 });
    expect(count(s, giftLine('waterfinder'))).toBe(1);
    expect(giftLine('waterfinder')).toBe('You have a gift: Waterfinder.');
    expect(count(s, HINTS.waterfinder.reveal)).toBe(1);
    // Known now: no more signs, no more hints.
    const again = runAction(s, 'water');
    expect(hiddenOf(again).signs).toBe(6);
    // The closer hint came at 4.
    expect(count(runAction(warden({ id: 'waterfinder', tier: 2, known: false, signs: 3 }), 'water'), HINTS.waterfinder.closer)).toBe(1);
  });

  // 4. A hidden talent that's never exercised (Silver Tongue in the Reach): no signs, no hints.
  it('gives no sign for a talent that never comes into play', () => {
    const s = runDay(runDay(warden({ id: 'silverTongue', tier: 4, known: false }), ['water', 'gather', 'wood', 'build']).state, ['study', 'rest']).state;
    expect(hiddenOf(s).signs).toBeUndefined();
    expect(s.log.some(l => Object.values(HINTS.silverTongue).includes(l.text))).toBe(false);
  });

  // A night can be a sign too: Light Eater through a hungry night.
  it('notices a hidden talent at night', () => {
    const s = warden({ id: 'lightEater', tier: 4, known: false }, { deprivation: { hungry: 3, thirsty: 0 } });
    const night = runDay({ ...s, stores: { ...s.stores, rawFood: 0 } }, []).state;
    expect(hiddenOf(night).signs).toBe(1);
  });

  // 5. A revealed talent stays known in the next run.
  it('keeps a revealed talent known', () => {
    const s = runAction(warden({ id: 'waterfinder', tier: 2, known: false, signs: 5 }), 'water');
    const next = createRegion1({ world: FLAT_WORLD }, legacyOf(s), { id: 'w-gift' });
    expect(next.character.talents.find(t => t.id === 'waterfinder')).toMatchObject({ known: true });
  });

  // 6. Every talent has all three lines, and the hints never give the name away.
  it('has hints for every talent that never name it', () => {
    for (const id of TALENT_IDS) {
      const h = HINTS[id];
      for (const line of [h.vague, h.closer, h.reveal]) expect(line.length).toBeGreaterThan(10);
      for (const line of [h.vague, h.closer]) expect(line.toLowerCase()).not.toContain(TALENTS[id].name.toLowerCase());
    }
  });
});
