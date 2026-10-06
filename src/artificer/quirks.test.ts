/**
 * Acceptance tests for #1362 — quirks: a panic response for everyone, a temperament for some,
 * and fears that bad panics leave behind and calm exposure fades. One test per scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, chooseOption, type Region1State } from './region1';
import { FULL_WORLD } from './world';
import { encounterById, chanceOf, rollOutcome, type PendingEncounter } from './encounters';
import { perceivedThreat, overrideChance } from './panic';
import { startingQuirks, RESPONSE_WEIGHTS, FEAR_FADES, QUIRKS, type Quirk } from './quirks';
import { legacyOf } from './legacy';
import { seedOf, streamFor } from './rng';

const fox = encounterById('fox-at-the-treeline')!;
const ledge = encounterById('crumbling-ledge')!;
const RESPONSES = Object.keys(RESPONSE_WEIGHTS);

/** A Warden with exactly these quirks, facing `id` in `state`. */
function facing(id: string, state: NonNullable<PendingEncounter['state']>, quirks: Quirk[], who = 'w-quirk', margin = state === 'panicked' ? 2 : 0): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: true } }, undefined, { id: who });
  return { ...s, character: { ...s.character, quirks }, hoursToday: 4, pending: { id, day: 1, hour: 10, ring: 2, action: 'scout', state, margin }, encounterDay: 1 };
}
const overrides = (who: string, id: string, margin: number): boolean => streamFor(seedOf(who), 1, `panic:${id}`)() < overrideChance(margin);

describe('Quirks (#1362)', () => {
  // 1. A new character: exactly one panic response, hidden, by a seeded roll with the weights.
  it('gives every new Warden one hidden panic response, seeded', () => {
    const s = createRegion1({}, undefined, { id: 'w-new' });
    const responses = s.character.quirks!.filter(q => RESPONSES.includes(q.id));
    expect(responses).toHaveLength(1);
    expect(responses[0].known).toBe(false);
    expect(createRegion1({}, undefined, { id: 'w-new' }).character.quirks).toEqual(s.character.quirks);
    // Over many Wardens the weights show: runners commonest, appeasers rarest; about half have a temperament.
    const counts: Record<string, number> = {};
    let tempered = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const q = startingQuirks(seedOf(`w-many-${i}`));
      counts[q[0].id] = (counts[q[0].id] ?? 0) + 1;
      if (q.length > 1) tempered++;
      expect(q.filter(x => RESPONSES.includes(x.id))).toHaveLength(1);
    }
    for (const [id, w] of Object.entries(RESPONSE_WEIGHTS)) expect(counts[id] / n).toBeCloseTo(w / 100, 1);
    expect(tempered / n).toBeCloseTo(0.5, 1);
  });

  // 2. A runner whose instinct overrides for the first time: the quirk becomes known, with a line.
  it('reveals the panic response the first time it fires', () => {
    let who = '';
    for (let i = 0; i < 200 && !who; i++) if (overrides(`w-run-${i}`, fox.id, 2)) who = `w-run-${i}`;
    const s = facing(fox.id, 'panicked', [{ id: 'runner', known: false }], who);
    const after = chooseOption(s, 'chase');
    expect(after.character.quirks).toEqual([{ id: 'runner', known: true }]);
    expect(after.log.map(l => l.text)).toContain(QUIRKS.runner.revealed);
    // Once known, it isn't announced again.
    const again = chooseOption({ ...after, pending: s.pending, today: s.today }, 'chase');
    expect(again.log.filter(l => l.text === QUIRKS.runner.revealed)).toHaveLength(1);
  });

  // 3. Reckless: perceived threat 1 lower than without.
  it('makes danger look smaller to the reckless (and bigger to the jumpy)', () => {
    const plain = facing(fox.id, 'calm', []);
    const reckless = facing(fox.id, 'calm', [{ id: 'reckless', known: false }]);
    const jumpy = facing(fox.id, 'calm', [{ id: 'jumpy', known: false }]);
    expect(perceivedThreat(reckless, fox)).toBe(perceivedThreat(plain, fox) - 1);
    expect(perceivedThreat(jumpy, fox)).toBe(perceivedThreat(plain, fox) + 1);
    // Jumpy gets away faster: flight options are better (where they aren't already sure).
    const flee = { ...fox.options[0], odds: 0.5 };
    expect(chanceOf(jumpy, flee)).toBeCloseTo(chanceOf(plain, flee) + 0.1);
  });

  // 4. A panicked failure at the ledge: fear:heights, and the ledge looks 1 worse next time.
  it('leaves a fear behind after a panic that ends badly', () => {
    const climb = ledge.options.find(o => o.id === 'climb-down')!;
    // A fighter (instinct: climb) whose climb goes wrong.
    let s: Region1State | null = null;
    for (let i = 0; i < 400 && !s; i++) {
      const c = facing(ledge.id, 'panicked', [{ id: 'fighter', known: false }], `w-fall-${i}`);
      if (rollOutcome(seedOf(`w-fall-${i}`), c.pending!, climb, chanceOf(c, climb)).tier === 'fail') s = c;
    }
    const after = chooseOption(s!, 'climb-down');
    expect(after.outcome).toBeNull(); // hurt, not killed, at full Condition
    expect(after.character.quirks).toContainEqual({ id: 'fear:heights', known: true, faced: 0 });
    expect(after.log.some(l => /won't forget this\. Heights will frighten you now/.test(l.text))).toBe(true);
    const unafraid = { ...after, character: { ...after.character, quirks: after.character.quirks!.filter(q => q.id !== 'fear:heights') } };
    expect(perceivedThreat(after, ledge)).toBe(perceivedThreat(unafraid, ledge) + 1);
    // A panic that goes well leaves nothing.
    const fine = chooseOption(facing(ledge.id, 'panicked', [{ id: 'runner', known: false }]), 'leave');
    expect(fine.character.quirks!.some(q => q.id === 'fear:heights')).toBe(false);
  });

  // 5. fear:heights and 3 calm successes with heights: the fear is gone.
  it('fades a fear with calm exposure', () => {
    let s = facing(ledge.id, 'calm', [{ id: 'runner', known: false }, { id: 'fear:heights', known: true, faced: 0 }]);
    const pending = s.pending;
    for (let i = 1; i <= FEAR_FADES; i++) {
      s = chooseOption({ ...s, pending }, 'leave');
      if (i < FEAR_FADES) expect(s.character.quirks).toContainEqual({ id: 'fear:heights', known: true, faced: i });
    }
    expect(s.character.quirks!.some(q => q.id === 'fear:heights')).toBe(false);
    expect(s.log.some(l => l.text === "You notice heights don't frighten you the way they did.")).toBe(true);
  });

  // 6. Carrying on: quirks, and whether they are known, carry over.
  it('carries quirks into the next run', () => {
    const quirks: Quirk[] = [{ id: 'freezer', known: true }, { id: 'stoic', known: false }, { id: 'fear:animal', known: true, faced: 1 }];
    const s = { ...createRegion1({}, undefined, { id: 'w-carry' }) };
    const done = { ...s, character: { ...s.character, quirks } };
    expect(legacyOf(done).quirks).toEqual(quirks);
    expect(createRegion1({}, legacyOf(done), { id: 'w-carry' }).character.quirks).toEqual(quirks);
  });
});
