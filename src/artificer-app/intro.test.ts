/**
 * Tests for #1228 — what the arrival intro says (the look is checked by screenshot).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1 } from '../artificer/region1';
import { introBeats, artificerRank, conceptRanks, fillName } from './intro';

describe('Arrival intro', () => {
  it('designates a fresh Warden as an Apprentice Artificer and closes on the motto', () => {
    const beats = introBeats(createRegion1());
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

  it('ranks a Warden by concept mastery', () => {
    const s = createRegion1({}, { known: ['snare', 'stone-knife'], concepts: { tension: 2, sealing: 1 } });
    expect(conceptRanks(s)).toBe(3);
    expect(artificerRank(s)).toBe('Journeyman');
    expect(introBeats(s).flatMap(b => b.lines).join('\n')).toMatch(/RANK: JOURNEYMAN/);
  });

  // One run per Warden (#1455): every arrival is a new person, told what the last one left.
  it('tells a new Warden what the last one left', () => {
    const s = createRegion1({}, { known: [], concepts: {}, heirlooms: [{ item: 'stone-knife', grade: 'fine', heirloom: true }] });
    const beats = introBeats(s);
    const all = beats.flatMap(b => b.lines).join('\n');
    expect(all).toMatch(/Someone was here before you\./);
    expect(all).toMatch(/They left: a fine stone-knife\./);
    // Still a new person: the creation screen runs, and the heirloom line comes after registration.
    expect(beats.findIndex(b => b.lines[0] === 'Someone was here before you.')).toBeGreaterThan(beats.findIndex(b => b.kind === 'create'));
    expect(introBeats(createRegion1()).flatMap(b => b.lines).join('\n')).not.toMatch(/Someone was here/);
  });

  it('climbs Apprentice → Journeyman → Master by volume and depth (#1457)', () => {
    const at = (n: number) => artificerRank({ concepts: { a: { rank: n, insight: 0 } } });
    expect([at(0), at(2), at(3), at(6), at(10)]).toEqual(['Apprentice', 'Apprentice', 'Journeyman', 'Journeyman', 'Master']);
  });
});
