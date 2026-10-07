/**
 * Acceptance tests for #1360 — real and perceived threat, nerve: calm, shaken or panicked.
 * One test per Given/When/Then scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, chooseOption, runAction, type Region1State } from './region1';
import { createVitals } from './vitality';
import { FULL_WORLD } from './world';
import { encounterById, optionsFor, chanceOf, ENCOUNTERS } from './encounters';
import { perceivedThreat, nerveOf, readThreat, SHAKEN_PENALTY, SHAKEN_CLARITY } from './panic';
import { legacyOf } from './legacy';
import { createExploration, scout } from './exploration';

const fox = encounterById('fox-at-the-treeline')!;
const ledge = encounterById('crumbling-ledge')!;
/** A Warden with no talents or quirks, so nothing but the rule under test moves the read. */
const warden = (extra: Partial<Region1State> = {}): Region1State => {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: true } }, undefined, { id: 'w-nerve' });
  return { ...s, character: { ...s.character, talents: [], quirks: [] }, ...extra };
};
const withWil = (wil: number): Region1State => { const s = warden(); return { ...s, character: { ...s.character, stats: { ...s.character.stats, wil } } }; };

describe('Real and perceived threat, nerve (#1360)', () => {
  // 1. WIL 10, the fox for the first time, by day: perceived 2, nerve 2, calm.
  it('reads a first fox by day as frightening enough, and stays calm', () => {
    const s = warden();
    expect(fox.threat).toBe(1);
    expect(readThreat(s, fox)).toEqual({ perceived: 2, nerve: 2, state: 'calm' });
    // Every encounter has a real threat and tags.
    for (const t of ENCOUNTERS) { expect(t.threat).toBeGreaterThanOrEqual(0); expect(t.tags.length).toBeGreaterThan(0); }
  });

  // 2. A foggy mind and a hurt body: perceived 4, panicked.
  it('lets a foggy mind and a hurt body make it overwhelming', () => {
    const s = warden({ vitals: createVitals({ clarity: 20, condition: 30 }) });
    expect(readThreat(s, fox)).toEqual({ perceived: 4, nerve: 2, state: 'panicked' });
    // The hour's ambient threat (the dark, a storm — #1367) adds one more once it is 2+.
    expect(perceivedThreat(warden(), fox, 2)).toBe(perceivedThreat(warden(), fox) + 1);
    expect(perceivedThreat(warden(), fox, 1)).toBe(perceivedThreat(warden(), fox));
  });

  // 3. Met the fox 3 times: it looks 1 smaller.
  it('makes a thing look smaller once you have lived through it often', () => {
    expect(perceivedThreat(warden({ met: { [fox.id]: 3 } }), fox)).toBe(perceivedThreat(warden({ met: { [fox.id]: 2 } }), fox) - 1);
    // Knowing the field does the same: an Adept hunter reads a fox for what it is.
    const hunter = warden({ skills: { hunting: 60 } });
    expect(perceivedThreat(hunter, fox)).toBe(perceivedThreat(warden(), fox) - 1);
    // Living through one counts; the count carries into the next run.
    const s = { ...warden(), pending: { id: fox.id, day: 1, hour: 10, ring: 1 as const, action: 'hunt', state: 'calm' as const } };
    const after = chooseOption(s, 'watch');
    expect(after.met).toEqual({ [fox.id]: 1 });
    expect(legacyOf(after).met).toEqual({ [fox.id]: 1 });
    expect(createRegion1({}, legacyOf(after)).met).toEqual({ [fox.id]: 1 });
  });

  // 4. Shaken: careful options one odds word worse, and Clarity −5 when the encounter opens.
  it('makes careful options harder when shaken, and the fright costs Clarity', () => {
    const base = warden({ skills: { scouting: 20 } });
    const at = (state: 'calm' | 'shaken') => ({ ...base, pending: { id: ledge.id, day: 1, hour: 10, ring: 2 as const, action: 'scout', state } });
    const goAround = ledge.options.find(o => o.id === 'go-around')!;
    expect(goAround.careful).toBe(true);
    // At least the penalty worse — and always one odds word worse, since the word is what you see.
    expect(chanceOf(at('shaken'), goAround)).toBeLessThanOrEqual(chanceOf(at('calm'), goAround) - SHAKEN_PENALTY);
    expect(optionsFor(at('calm'), ledge).find(o => o.option.id === 'go-around')!.odds).toBe('likely');
    expect(optionsFor(at('shaken'), ledge).find(o => o.option.id === 'go-around')!.odds).toBe('risky');
    // Options that aren't careful aren't made harder — a physical one even gets adrenaline's help (#1361).
    const climb = ledge.options.find(o => o.id === 'climb-down')!;
    expect(chanceOf(at('shaken'), climb)).toBeGreaterThanOrEqual(chanceOf(at('calm'), climb));
    // When an encounter opens on a shaken Warden, it costs Clarity and says so.
    const opened = openEncounter(warden({ vitals: createVitals({ clarity: 25 }) }));
    expect(opened.pending!.state).not.toBe('calm');
    expect(opened.log.some(l => /Your heart is hammering|Panic\. You can barely think/.test(l.text))).toBe(true);
    expect(opened.vitals.clarity.current).toBeLessThanOrEqual(25 - SHAKEN_CLARITY);
  });

  // 5. WIL 14: nerve 3.
  it('gives more nerve with more Willpower', () => {
    expect(nerveOf(withWil(10))).toBe(2);
    expect(nerveOf(withWil(14))).toBe(3);
    expect(nerveOf(withWil(6))).toBe(1);
  });

  // 6. The same Warden and encounter: the same state, every time.
  it('reads the same way every time', () => {
    const s = warden({ vitals: createVitals({ clarity: 25 }) });
    expect(readThreat(s, ledge)).toEqual(readThreat(s, ledge));
    const a = openEncounter(s), b = openEncounter(s);
    expect(a.pending).toEqual(b.pending);
  });
});

/** Fetch water in the near ring until an encounter opens for this Warden, so the sim opens it for real. */
function openEncounter(s: Region1State): Region1State {
  const scouted = { ...s, explore: scout(createExploration(), 1) };
  for (let day = 1; day <= 60; day++) {
    // The roll is per day and hour, so try a few starting hours each day.
    for (const hoursToday of [0, 2, 4, 6, 8]) {
      const after = runAction({ ...scouted, day, encounterDay: undefined, hoursToday, vitals: s.vitals }, 'water');
      // Something with a real threat to it: a harmless passer-by (#1346) rightly leaves you calm.
      if (after.pending && (encounterById(after.pending.id)?.threat ?? 0) >= 1) return after;
    }
  }
  throw new Error('no encounter opened in 60 days');
}
