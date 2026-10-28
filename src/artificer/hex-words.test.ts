/**
 * Acceptance tests for #1902 — "Further off": hexes in words. One test per Given/When/Then, in
 * the issue's order. Criterion 5 is also the existing descriptive-map.test.ts and
 * src/artificer-ai/observe.test.ts, which this change must leave passing unedited.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from './region1';
import { FULL_WORLD } from './world';
import { ruleFeatures } from './features';
import { HEX_WORLD, landOfRun, toWorld } from './world/hex-window';
import { inReach } from './world/hex-knowledge';
import { hexOfCell, hexKey, hexDistance, cellsOfHex, packCell, type Hex } from '../../worldmap/coords';
import { summariesAround, KNOWN_RADIUS } from '../../worldmap/hex-summary';
import { hexName } from '../../worldmap/hex-names';
import { seedOf } from './rng';
import { furtherOff, furtherOffLine, HEX_RULES } from './hex-words';
import { makeT } from './i18n';
import { observe, RULES } from '../artificer-ai/observe';

const runWith = (id: string, on = true): Region1State =>
  createRegion1({ world: { ...FULL_WORLD, features: { ...ruleFeatures(), [HEX_WORLD]: on } } }, undefined, { id });

/** The hex the run's camp sits in, found the same way `furtherOff` does. */
function campHexOf(s: Region1State): Hex {
  const land = landOfRun(s);
  return hexOfCell(toWorld(land, land.camp.x, land.camp.y));
}

describe('furtherOff (#1902)', () => {
  it('1. heard of a hex two days south, with no seen cell there: how heard, days 2, names the hex and says "two days" and "south"', () => {
    const s = runWith('w-hw-1');
    const camp = campHexOf(s);
    const target: Hex = { q: camp.q, r: camp.r + 2 };
    s.heardHexes = [hexKey(target)];

    const entry = furtherOff(s).find(e => hexKey(e.hex) === hexKey(target));
    expect(entry).toBeDefined();
    expect(entry!.how).toBe('heard');
    expect(entry!.days).toBe(2);
    const seed = seedOf(s.character.id);
    expect(entry!.text).toContain(hexName(seed, target, 'en'));
    expect(entry!.text).toMatch(/two days/);
    expect(entry!.text.toLowerCase()).toMatch(/south/);
  });

  it('2. a hex neither seen, heard of, nor on the skyline: no entry names it', () => {
    const s = runWith('w-hw-2');
    const seed = seedOf(s.character.id);
    const camp = campHexOf(s);
    // Far (beyond the skyline's reach of any seen hex) and low (under the skyline height): can't qualify any way.
    const far = summariesAround(seed, KNOWN_RADIUS).find(sum => hexDistance(sum.hex, camp) >= 3 && sum.height.max < 0.76);
    expect(far).toBeDefined();

    const entries = furtherOff(s);
    expect(entries.some(e => hexKey(e.hex) === hexKey(far!.hex))).toBe(false);
  });

  it('3. seenWorld holds a cell of a neighbouring hex: how seen, days 1', () => {
    const s = runWith('w-hw-3');
    const camp = campHexOf(s);
    const target: Hex = { q: camp.q, r: camp.r - 1 };
    const outside = cellsOfHex(target).find(c => !inReach(c.cx, c.cy));
    expect(outside).toBeDefined();
    s.seenWorld = [packCell(outside!)];

    const entry = furtherOff(s).find(e => hexKey(e.hex) === hexKey(target));
    expect(entry).toBeDefined();
    expect(entry!.how).toBe('seen');
    expect(entry!.days).toBe(1);
  });

  it("4. standing afield in another hex: your own hex isn't listed, and camp's hex is (seen, a day off)", () => {
    const s = runWith('w-hw-4');
    const camp = campHexOf(s);
    const standHex: Hex = { q: camp.q, r: camp.r + 1 };
    const standCell = cellsOfHex(standHex)[0];
    s.afield = { x: standCell.cx, y: standCell.cy };

    const entries = furtherOff(s);
    expect(entries.some(e => hexKey(e.hex) === hexKey(standHex))).toBe(false);
    const campEntry = entries.find(e => hexKey(e.hex) === hexKey(camp));
    expect(campEntry).toBeDefined();
    expect(campEntry!.how).toBe('seen');
    expect(campEntry!.days).toBe(1);
  });

  it('5. hex-world off: furtherOff is empty, and observe() has no "Further off" or HEX_RULES', () => {
    const s = runWith('w-hw-5', false);
    expect(furtherOff(s)).toEqual([]);
    const text = observe(s);
    expect(text).not.toContain('Further off');
    expect(text).not.toContain(HEX_RULES);
    expect(RULES).not.toContain('Further off');
    expect(RULES).not.toContain(HEX_RULES);
  });

  it('6. hex-world on with one hex known: observe() shows "Further off:" and HEX_RULES; RULES stays the identical string', () => {
    const s = runWith('w-hw-6');
    const camp = campHexOf(s);
    const target: Hex = { q: camp.q, r: camp.r + 1 };
    s.heardHexes = [hexKey(target)];

    const text = observe(s);
    expect(text).toContain('Further off:');
    expect(text).toContain(HEX_RULES);
    expect(RULES).not.toContain('Further off');
    expect(RULES).not.toContain(HEX_RULES);
  });

  it('7. the scenario-1 entry rendered in Swedish: carries the Swedish hex name and no English words', () => {
    const s = runWith('w-hw-7');
    const camp = campHexOf(s);
    const target: Hex = { q: camp.q, r: camp.r + 2 };
    s.heardHexes = [hexKey(target)];
    const seed = seedOf(s.character.id);

    const entry = furtherOff(s).find(e => hexKey(e.hex) === hexKey(target));
    expect(entry).toBeDefined();
    const svLine = furtherOffLine(entry!, makeT('sv'), seed, 'sv');
    expect(svLine).toContain(hexName(seed, target, 'sv'));
    expect(svLine).not.toMatch(/\b(the|is|about|minutes|south|north|east|west|heard|seen|off|day|days)\b/i);
  });
});
