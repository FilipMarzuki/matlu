/**
 * Acceptance tests for #1242 (run numbers per character, records say whose run it was) as
 * revised by #1455: one run per Warden. The next run is always someone new, who starts with
 * the last Warden's tools — their heirlooms — and none of their knowledge. Criteria 4–6 of
 * #1455 live here; 1–3 are in src/artificer/heirlooms.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, type Region1State } from '../artificer/region1';
import { createVitals } from '../artificer/vitality';
import { runNumberFor, summarizeRun, type RunRecord } from '../artificer/legacy';
import type { OutcomeKind } from '../artificer/winter';
import { SCOUT_TRAINING } from '../artificer/scout';
import { deserialize, newGame, newRun, recordRun, deserializeHistory, serialize, serializeHistory } from './controller';

/** A resolved run for a named Warden who knows the snare, has some woodcraft, and owns a masterwork knife (better than the pack's fine one). */
function ended(kind: OutcomeKind, id = 'w-vega'): Region1State {
  const s = createRegion1({}, undefined, { id, name: 'Vega', portrait: 'tinkerer', chosen: ['hardy', 'tough'] });
  const worked = { ...runAction(s, 'scout'), known: [...s.known, 'trap-snare'], skills: { woodcraft: 40 }, tools: [{ item: 'stone-knife', grade: 'masterwork' as const }] };
  const choice = kind === 'collapsed' || kind === 'died' ? 'collapse' as const : kind === 'crossed' || kind === 'turnedBack' ? 'solo' as const : kind === 'thrive' || kind === 'ragged' ? 'caravan' as const : 'winter' as const;
  return { ...worked, outcome: { choice, kind, vitals: createVitals() } };
}

describe('One run per Warden (#1455), and whose run it was (#1242)', () => {
  // 4. After any outcome — death included — the next run is someone new, holding the last Warden's tools.
  it('starts someone new after any outcome, with the last Warden’s tools and none of their knowledge', () => {
    for (const kind of ['thrive', 'ragged', 'crossed', 'wintered', 'grim', 'collapsed', 'died'] as OutcomeKind[]) {
      const from = ended(kind);
      const next = newRun(from).sim;
      expect(next.character.id).not.toBe('w-vega');
      expect(next.character.name).toBe('');
      expect(next.concepts).toEqual({});
      expect(next.known).not.toContain('trap-snare');
      expect(next.skills).toEqual(SCOUT_TRAINING); // only what every new scout knows (#1398)
      expect(next.tools).toContainEqual({ item: 'stone-knife', grade: 'masterwork', heirloom: true });
    }
  });

  // 5. Nothing is taken from an unfinished run, and a fresh Warden is a new person.
  it('starts a fresh Warden with nothing, as someone new', () => {
    const a = newGame().sim, b = newGame().sim;
    expect(a.character.id).toMatch(/^w-/);
    expect(a.character.id).not.toBe(b.character.id);
    expect(a.skills).toEqual(SCOUT_TRAINING);
    expect(a.tools.some(t => t.heirloom)).toBe(false);
    expect(newRun().sim.character.id).not.toBe(a.character.id);
    // An unfinished run leaves nothing: its Warden is still using those tools.
    const unfinished = { ...ended('thrive'), outcome: null };
    const next = newRun(unfinished).sim;
    expect(next.skills).toEqual(SCOUT_TRAINING);
    expect(next.tools.some(t => t.heirloom)).toBe(false);
  });

  // 6. Heirlooms survive a save.
  it('keeps heirlooms through a save', () => {
    const a = newRun(ended('died'));
    const loaded = deserialize(serialize(a));
    expect(loaded?.sim.tools).toEqual(a.sim.tools);
    expect(loaded?.sim.tools).toContainEqual({ item: 'stone-knife', grade: 'masterwork', heirloom: true });
  });

  // Records say whose run it was (#1242).
  it('records whose run it was', () => {
    expect(summarizeRun(ended('thrive'), 1)).toMatchObject({ characterId: 'w-vega', characterName: 'Vega', run: 1 });
  });

  // Run numbers count this character's runs only (#1242).
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

  // History from before character ids still loads, and counts for nobody current (#1242).
  it('keeps old history readable', () => {
    const old = JSON.parse(serializeHistory([summarizeRun(ended('thrive'), 4)]));
    delete old.runs[0].characterId; delete old.runs[0].characterName;
    const loaded = deserializeHistory(JSON.stringify(old));
    expect(loaded).toHaveLength(1);
    expect(runNumberFor(loaded, 'w-vega')).toBe(1);
  });
});
