/**
 * Acceptance tests for #1242 — carry-over only within the same living
 * character, and run numbers per character.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { canContinue, runNumberFor, summarizeRun, type RunRecord } from '../artificer/legacy';
import type { OutcomeKind } from '../artificer/winter';
import { newGame, newRun, recordRun, deserializeHistory, serializeHistory } from './controller';

/** A resolved run for a named Warden who knows the snare and has some woodcraft. */
function ended(kind: OutcomeKind, id = 'w-vega'): Region1State {
  const s = createRegion1({}, undefined, { id, name: 'Vega', portrait: 'tinkerer', traits: ['hardy', 'tough'] });
  const worked = { ...runAction(s, 'scout'), known: [...s.known, 'trap-snare'], skills: { woodcraft: 40 } };
  const choice = kind === 'collapsed' || kind === 'died' ? 'collapse' as const : kind === 'crossed' || kind === 'turnedBack' ? 'solo' as const : kind === 'thrive' || kind === 'ragged' ? 'caravan' as const : 'winter' as const;
  return { ...worked, outcome: { choice, kind, vitals: createVitals() } };
}

describe('Carry-over belongs to one character (#1242)', () => {
  // 1. A character who lived goes on: same id, name, traits, knowledge.
  it('continues a character who lived, with everything they learned', () => {
    for (const kind of ['thrive', 'ragged', 'crossed', 'wintered', 'grim', 'collapsed'] as OutcomeKind[]) {
      const from = ended(kind);
      expect(canContinue(from)).toBe(true);
      const next = newRun(from).sim;
      expect(next.character).toMatchObject({ id: 'w-vega', name: 'Vega', portrait: 'tinkerer', traits: ['hardy', 'tough'], lastStandUsed: false });
      expect(next.known).toContain('trap-snare');
      expect(next.skills.woodcraft).toBe(40);
    }
  });

  // 2. Death ends the character: nothing passes on.
  it('lets nothing pass on from a Warden who died', () => {
    const dead = ended('died');
    expect(canContinue(dead)).toBe(false);
    const next = newRun(dead).sim;
    expect(next.character.id).not.toBe('w-vega');
    expect(next.character.name).toBe('');
    expect(next.known).not.toContain('trap-snare');
    expect(next.skills).toEqual({});
  });

  // 3. A fresh Warden starts with nothing, as a new person.
  it('starts a fresh Warden with nothing, as someone new', () => {
    const a = newGame().sim, b = newGame().sim;
    expect(a.character.id).toMatch(/^w-/);
    expect(a.character.id).not.toBe(b.character.id);
    expect(a.skills).toEqual({});
    expect(newRun().sim.character.id).not.toBe(a.character.id);
    // An unfinished run can't be "continued" either.
    const unfinished = { ...ended('thrive'), outcome: null };
    expect(newRun(unfinished).sim.skills).toEqual({});
  });

  // 4. Records say whose run it was.
  it('records whose run it was', () => {
    expect(summarizeRun(ended('thrive'), 1)).toMatchObject({ characterId: 'w-vega', characterName: 'Vega', run: 1 });
  });

  // 5. Run numbers count this character's runs only.
  it('numbers runs per character', () => {
    let history: RunRecord[] = [];
    const play = (kind: OutcomeKind, id: string) => {
      const before = { sim: { ...ended(kind, id), outcome: null }, queue: [] };
      history = recordRun(history, before, { sim: ended(kind, id), queue: [] });
    };
    play('thrive', 'w-vega');
    play('grim', 'w-ash');
    play('wintered', 'w-vega');
    expect(history.map(r => [r.characterName, r.characterId, r.run])).toEqual([['Vega', 'w-vega', 2], ['Vega', 'w-ash', 1], ['Vega', 'w-vega', 1]]);
    expect(runNumberFor(history, 'w-vega')).toBe(3);
    expect(runNumberFor(history, 'w-ash')).toBe(2);
    expect(runNumberFor(history, 'w-new')).toBe(1);
  });

  // 6. History from before character ids still loads, and counts for nobody current.
  it('keeps old history readable', () => {
    const old = JSON.parse(serializeHistory([summarizeRun(ended('thrive'), 4)]));
    delete old.runs[0].characterId; delete old.runs[0].characterName;
    const loaded = deserializeHistory(JSON.stringify(old));
    expect(loaded).toHaveLength(1);
    expect(runNumberFor(loaded, 'w-vega')).toBe(1);
  });
});
