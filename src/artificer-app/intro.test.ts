/**
 * Tests for #1228 — what the arrival intro says (the look is checked by screenshot).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1 } from '../artificer/region1';
import { introBeats, artificerRank, conceptRanks, fillName } from './intro';

describe('Arrival intro', () => {
  it('designates a fresh Warden as an Apprentice Artificer and closes on the motto', () => {
    const beats = introBeats('fresh', createRegion1());
    const all = beats.flatMap(b => b.lines).join('\n');
    expect(beats[0]).toMatchObject({ kind: 'narration', portal: true });
    expect(all).toMatch(/Crafting knowledge exceeds threshold/);
    expect(all).toMatch(/CLASS DESIGNATED: ARTIFICER/);
    expect(all).toMatch(/RANK: APPRENTICE/);
    expect(all).toMatch(/Winter arrives in 30 days/);
    expect(beats.at(-1)).toEqual({ kind: 'title', lines: ['SURVIVE.', 'THRIVE.', 'MASTER YOUR NEW REALITY.'] });
    // Character creation (#1239) comes right after the designation, and the voice then uses the name.
    const create = beats.findIndex(b => b.kind === 'create');
    expect(beats[create - 1].lines[0]).toBe('CLASS DESIGNATED: ARTIFICER');
    expect(fillName(beats[create + 1].lines[0], 'Vega')).toBe('Registered: Vega.');
    expect(fillName(beats[create + 1].lines[0], '  ')).toBe('Registered: Artificer.');
  });

  it('greets a returning Warden with what they kept, and ranks them by concept mastery', () => {
    const s = createRegion1({}, { known: ['snare', 'stone-knife'], concepts: { tension: 2, sealing: 1 } });
    expect(conceptRanks(s)).toBe(3);
    expect(artificerRank(s)).toBe('Journeyman');
    const beats = introBeats('carry', s, 3);
    const all = beats.flatMap(b => b.lines).join('\n');
    expect(beats.length).toBeLessThan(introBeats('fresh', createRegion1()).length);
    expect(all).toMatch(/RETURNING ARTIFICER — CYCLE 3/);
    expect(all).toMatch(/3 concept ranks/);
    expect(all).toMatch(/RANK: JOURNEYMAN/);
    // A returning Warden is the same person: no creation screen, greeted by name.
    expect(beats.some(b => b.kind === 'create')).toBe(false);
    const named = introBeats('carry', createRegion1({}, undefined, { name: 'Vega' }), 2).flatMap(b => b.lines).join('\n');
    expect(named).toMatch(/Welcome back, Vega\./);
  });

  it('climbs Apprentice → Journeyman → Adept → Master', () => {
    const at = (n: number) => artificerRank({ concepts: { a: { rank: n, insight: 0 } } });
    expect([at(0), at(2), at(3), at(6), at(10)]).toEqual(['Apprentice', 'Apprentice', 'Journeyman', 'Adept', 'Master']);
  });
});
