/**
 * Regression tests for #1227 — bugs found by having several AI models play
 * Region 1 (see src/artificer-ai/) and reading their transcripts.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, chooseSite, endDay, ACTIONS, type Region1State } from './region1';
import { createVitals } from './vitality';

function camp(over: Partial<Region1State> = {}): Region1State {
  const s = chooseSite(runAction(createRegion1(), 'scout'), 'cave');
  return { ...s, stores: { ...s.stores, materials: 20, rawFood: 5, water: 5 }, ...over };
}
// The craft's own line (a skill level-up may follow it).
const lastText = (s: Region1State): string => [...s.log].reverse().find(l => !/comes easier\.$|how little you know|^You've worked out|^From /.test(l.text))?.text ?? '';

describe('Region 1 playtest fixes (#1227)', () => {
  // Journal lines read as English: no "a" before plurals or mass nouns.
  it('words craft and build lines naturally', () => {
    const roofed = runAction(camp(), 'build');
    expect(roofed.log.map(l => l.text).join('\n')).toMatch(/Raised a sound lean-to/);
    const walled = runAction(roofed, { q: 'build', opts: { walls: 'timber' } });
    expect(walled.log.map(l => l.text).join('\n')).toMatch(/Raised sound timber walls/);
    expect(lastText(runAction(camp(), 'coldGear'))).toMatch(/^Crafted sound cold gear\./);
    expect(lastText(runAction(camp(), 'knife'))).toMatch(/^Crafted a sound stone knife\./);
  });

  it('says "1 winter ration", not "1 winter rations"', () => {
    const s = runAction(camp({ stores: { ...camp().stores, rawFood: 2 } }), { q: 'preserve', opts: { method: 'smoke' } });
    expect(s.log.map(l => l.text).join('\n')).toMatch(/into 1 winter ration\./);
  });

  // Small game no longer claims a snare you may not have.
  it("doesn't mention a snare when hunting small game", () => {
    const s = runAction(camp(), { q: 'hunt', opts: { target: 'small' } });
    expect(s.log.some(l => /^Took small game/.test(l.text))).toBe(true);
    expect(s.log.some(l => /snared/i.test(l.text))).toBe(false);
  });

  // Condition heals on a good night in shelter, so an overworked Warden can still get ready.
  it('heals worn Condition overnight in a warm, fed camp', () => {
    const walled = runAction(runAction(camp(), 'build'), { q: 'build', opts: { walls: 'timber' } });
    const worn = { ...walled, vitals: createVitals({ condition: 57 }), today: { loadVigor: 0, loadClarity: 0, pushedVigor: false, pushedClarity: false } };
    const night = endDay(worn);
    expect(night.vitals.condition).toBeGreaterThan(57);
  });

  // Found by the random baseline: a look-out from unscouted ground scouted two rings at once.
  it('needs the ring scouted before you can look out over it', () => {
    const fresh = createRegion1();
    expect(ACTIONS.lookout.gate?.(fresh, 1, {})).toMatch(/scout the near ring first/);
    const scoutedNear = runAction(fresh, 'scout');
    expect(ACTIONS.lookout.gate?.(scoutedNear, 1, {})).toBeNull();
    expect(ACTIONS.lookout.gate?.(scoutedNear, 2, {})).toMatch(/scout the far ring first/);
  });
});
