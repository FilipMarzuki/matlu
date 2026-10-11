/**
 * Acceptance tests for #1381 — the AI harness remembers places: the observation lists the pins
 * with memory used/capacity and land actions show what a pin does, a reply can let a place go or
 * weigh one (checked against the state), random runs never hold more than memory allows, and the
 * report counts pins made, let go and held, by kind. One test per scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../artificer/region1';
import { FULL_WORLD } from '../artificer/world';
import { createExploration, scout, type Ring } from '../artificer/exploration';
import { LEVEL_HOURS } from '../artificer/skills';
import { pinCapacity, pinId, type Pin, type PinKind } from '../artificer/pins';
import { observe, RULES } from './observe';
import { parseDecision, DECISION_SCHEMA } from './decision';
import { playRun, pinOrderErrors, applyPinOrders, pinsOfTurn, type Player } from './runner';
import { randomPlayer } from './players/random';
import { invariantViolations } from './invariants';
import { aggregate, type Transcript } from './report';
import { progressOf } from './progress';

const pin = (place: string, kind: PinKind, ring: Ring, day = 1): Pin => ({ id: pinId(place, ring), place, kind, ring, day });
const warden = (pins: Pin[] = [], extra: Partial<Region1State> = {}): Region1State => {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: true } }, undefined, { id: 'w-pins-ai' });
  return { ...s, day: 6, explore: scout(scout(createExploration(), 1), 2), pins, ...extra };
};
const decision = (o: object) => { const p = parseDecision(JSON.stringify({ thoughts: '', site: null, queue: [], ...o })); if (!p.ok) throw new Error(p.errors.join('; ')); return p.decision; };

describe('The AI harness remembers places (#1381)', () => {
  // 1. Pins held: the observation lists them with memory used/capacity; land actions show pin effects.
  it('shows the places it remembers, how much room is left, and what they do on the land', () => {
    const text = observe(warden([pin('deep-pool', 'fishing', 2)]));
    expect(text).toContain('PINS (memory 1/2, interest not yet): deep-pool@2 = the deep pool, ring 2: +1 water and fish in this ring');
    expect(text).toMatch(/- water ring 2 · .* · 📌 the deep pool: \+1 water/);
    expect(text).not.toMatch(/- water ring 1 · .*📌/);
    const full = observe(warden([pin('deep-pool', 'fishing', 2, 3), pin('sunlit-glade', 'peaceful', 1, 2)]));
    expect(full).toContain('PINS (memory 2/2, interest not yet) — FULL (to remember another, forget one first; least interesting and oldest: sunlit-glade@1)');
    expect(observe(warden())).toContain('PINS (memory 0/2, interest not yet): none');
    // The rules explain places, once, and the reply format names the new fields.
    expect(RULES).toMatch(/PLACES AND MEMORY/);
    expect(RULES).toMatch(/"forget": "<pin id>" \| null/);
    expect(DECISION_SCHEMA.required).toEqual(expect.arrayContaining(['forget', 'interest']));
  });

  // 2. A reply with forget naming a held pin: it is let go. An unknown pin id comes back invalid.
  it('lets a place go on request, and refuses a place it does not remember', () => {
    const s = warden([pin('deep-pool', 'fishing', 2), pin('sunlit-glade', 'peaceful', 1)]);
    const d = decision({ forget: 'deep-pool@2' });
    expect(pinOrderErrors(s, d)).toEqual([]);
    expect(applyPinOrders(s, d).pins!.map(p => p.id)).toEqual(['sunlit-glade@1']);
    expect(pinOrderErrors(s, decision({ forget: 'nowhere@3' }))).toEqual(['forget: you don\'t remember "nowhere@3" — you remember: deep-pool@2, sunlit-glade@1']);
    // Shape errors are caught in parsing.
    expect(parseDecision(JSON.stringify({ thoughts: '', site: null, queue: [], forget: 7 }))).toMatchObject({ ok: false });
  });

  it('asks again when a reply forgets a place it never remembered', async () => {
    const asked: string[] = [];
    const player: Player = { name: 'forgetful', async decide(m) { asked.push(m); return { text: JSON.stringify({ thoughts: '', site: null, forget: 'deep-pool@2', queue: [] }) }; } };
    const r = await playRun(player, { characterId: 'w-forgetful', planning: 'open', maxDays: 61 });
    expect(asked[1]).toMatch(/^Your reply was invalid:\n- forget: you don't remember "deep-pool@2" — you remember no places/);
    expect(r.turns[0]).toMatchObject({ invalid: true, errors: [expect.stringMatching(/^forget:/)] });
  });

  // 3. interest before Memory allows it: refused, with the reason.
  it('refuses to weigh places before Memory allows', () => {
    const pins = [pin('deep-pool', 'fishing', 2)];
    expect(pinOrderErrors(warden(pins), decision({ interest: [{ pin: 'deep-pool@2', stars: 1 }] })))
      .toEqual(["interest: your Memory isn't good enough to weigh places yet (it comes at Apprentice) — leave interest empty"]);
    const apprentice = warden(pins, { skills: { memory: LEVEL_HOURS[2] } });
    expect(pinOrderErrors(apprentice, decision({ interest: [{ pin: 'deep-pool@2', stars: 3 }] }))).toEqual(['interest: your Memory can weigh places up to 2 stars, not 3']);
    const d = decision({ interest: [{ pin: 'deep-pool@2', stars: 2 }] });
    expect(pinOrderErrors(apprentice, d)).toEqual([]);
    expect(applyPinOrders(apprentice, d).pins![0].interest).toBe(2);
    expect(pinOrderErrors(apprentice, decision({ interest: [{ pin: 'nowhere@1', stars: 1 }] }))[0]).toMatch(/^interest: you don't remember "nowhere@1"/);
  });

  // 4. 30 random runs: no invariant breaks, and pins never exceed capacity.
  it('keeps every invariant across 30 random runs, never holding more than memory allows', async () => {
    let made = 0;
    // At least 30 runs; more (up to 150) until one has remembered a place — a random player meets a
    // place in about one run in seven and remembers it one time in four, and which runs do shifts
    // with anything that changes how a run goes.
    for (let seed = 1; seed <= 150 && (seed <= 30 || made === 0); seed++) {
      const r = await playRun(randomPlayer({ mode: seed % 5 === 0 ? 'uniform' : 'legal', seed }), { characterId: `ai-random-pins-${seed}` });
      for (const t of r.turns) {
        expect(t.violations).toBeUndefined();
        made += t.pins?.made.length ?? 0;
      }
      expect(invariantViolations(r.final)).toEqual([]);
      expect((r.final.pins ?? []).length).toBeLessThanOrEqual(pinCapacity(r.final));
    }
    expect(made).toBeGreaterThan(0); // places did get remembered
    // The invariant itself catches an overfull memory.
    expect(invariantViolations(warden([pin('a', 'stone', 1), pin('b', 'stone', 1), pin('c', 'stone', 1)]))).toContain('3 pins held, but memory holds 2');
  }, 60_000);

  // 5. Finished runs: the report counts pins made, let go and held, by kind.
  it('counts places remembered, let go and held, by kind', () => {
    expect(pinsOfTurn([], [pin('deep-pool', 'fishing', 2)])).toEqual({ made: ['fishing'], forgotten: [], held: ['fishing'] });
    expect(pinsOfTurn([pin('deep-pool', 'fishing', 2)], [pin('deep-pool', 'fishing', 2)])).toBeNull();
    const s = createRegion1({}, undefined, { id: 'w-report' });
    const start = progressOf(s, s.known.length);
    const turn = (extra: Partial<Transcript['turns'][number]>): Transcript['turns'][number] => ({ day: 1, queue: [], invalid: false, progress: start, ...extra });
    const run = (turns: Transcript['turns']): Transcript => ({ player: 'scripted', start, turns, record: { kind: 'survived', choice: 'thaw', day: 61, readyDay: null }, usage: { input: 0, output: 0, cacheRead: 0, cost: 0 } });
    const [m] = aggregate([
      run([turn({ pins: { made: ['fishing'], forgotten: [], held: ['fishing'] } }), turn({}), turn({ pins: { made: ['shelter'], forgotten: ['fishing'], held: ['shelter'] } })]),
      run([turn({ pins: { made: ['fishing', 'peaceful'], forgotten: [], held: ['fishing', 'peaceful'] } })]),
    ]);
    expect(m.pins).toEqual({
      made: 2, forgotten: 0.5, held: 1.5,
      madeByKind: { fishing: 2, shelter: 1, peaceful: 1 }, forgottenByKind: { fishing: 1 }, heldByKind: { shelter: 1, fishing: 1, peaceful: 1 },
    });
  });
});
