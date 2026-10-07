/**
 * Acceptance tests for #1378 — pins: places worth remembering, found while exploring, offered
 * like an encounter, and limited by memory (INT and the Memory skill). One test per scenario.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, chooseOption, forgetPin, runDay, creditedPractice, type Region1State } from './region1';
import { FULL_WORLD } from './world';
import { ENCOUNTERS, encounterById, encounterFor, optionsFor } from './encounters';
import { pinCapacity, pinId, FULL_MEMORY, ALREADY_PINNED, type Pin } from './pins';
import { legacyOf } from './legacy';
import { LEVEL_HOURS } from './skills';
import { seedOf } from './talents';
import type { Ring } from './exploration';

/** A Warden standing at `id` in `ring`, calm, with no talents or quirks. */
function at(id: string, extra: Partial<Region1State> = {}, ring: Ring = 2): Region1State {
  const s = createRegion1({ world: { ...FULL_WORLD, encounters: true } }, undefined, { id: 'w-pins' });
  return {
    ...s, canPlan: true, day: 7, character: { ...s.character, talents: [], quirks: [] }, hoursToday: 4,
    pending: { id, day: 7, hour: 12, ring, action: 'scout', state: 'calm', margin: 0 }, encounterDay: 7, ...extra,
  };
}
const remember = (s: Region1State) => optionsFor(s, encounterById(s.pending!.id)!).find(o => o.option.id === 'remember')!;
const withInt = (s: Region1State, int: number): Region1State => ({ ...s, character: { ...s.character, stats: { ...s.character.stats, int } } });
const pin = (place: string, ring: Ring = 1): Pin => ({ id: pinId(place, ring), place, kind: 'shelter', ring, day: 1 });

describe('Pins (#1378)', () => {
  // 1. "Remember it": the pin is recorded (kind, ring, day), the day carries on, and Memory gets 1h of practice.
  it('remembers a place: a pin, the day going on, and an hour of Memory practice', () => {
    const s = at('deep-pool', {}, 3);
    const after = chooseOption(s, 'remember');
    expect(after.pins).toEqual([{ id: 'deep-pool@3', place: 'deep-pool', kind: 'fishing', ring: 3, day: 7 }]);
    expect(after.pending).toBeNull();
    expect(after.skills.memory).toBe(creditedPractice(s, 'memory', 1, 'none'));
    expect(after.skills.memory).toBeGreaterThan(0);
    // The day carries on: the rest of the plan runs.
    expect(runDay({ ...after, hoursToday: 0 }, ['water']).state.day).toBe(after.day + 1);
    // The carving is remembered with a feeling: awed or eerie.
    const carved = chooseOption(at('strange-carving'), 'remember').pins![0];
    expect(['awed', 'eerie']).toContain(carved.feeling);
    expect(carved.kind).toBe('wonder');
    // Looking closer at the carving gives a little insight.
    const looked = chooseOption(at('strange-carving'), 'look');
    expect(looked.concepts.sealing?.insight ?? 0).toBeGreaterThan(0);
    expect(looked.pins ?? []).toEqual([]);
  });

  // 2. INT 10 and no Memory: 2 pins. INT 14: 4. Each true Memory level adds 1.
  it('holds as many places as the mind and practice allow', () => {
    const s = at('deep-pool');
    expect(pinCapacity(s)).toBe(2);
    expect(pinCapacity(withInt(s, 14))).toBe(4);
    expect(pinCapacity(withInt(s, 11))).toBe(2);
    expect(pinCapacity(withInt(s, 6))).toBe(1);
    expect(pinCapacity(withInt(s, 3))).toBe(1); // never below one
    expect(pinCapacity({ ...s, skills: { memory: LEVEL_HOURS[1] } })).toBe(3);
    expect(pinCapacity({ ...s, skills: { memory: LEVEL_HOURS[3] } })).toBe(5);
  });

  // 3. A full memory: "Remember it" is unavailable, with the reason; after forgetting a pin, it's available again.
  it('closes "remember it" when memory is full, and opens it once a place is let go', () => {
    const full = at('sunlit-glade', { pins: [pin('sheltered-hollow'), pin('deep-pool')] });
    expect(remember(full).unmet).toBe(FULL_MEMORY);
    expect(chooseOption(full, 'remember').pins).toHaveLength(2);
    const freed = forgetPin(full, 'deep-pool@1');
    expect(freed.pins).toEqual([pin('sheltered-hollow')]);
    expect(freed.log.at(-1)!.text).toBe('You let it go: a place for a shelter in the near ring.');
    expect(remember(freed).unmet).toBeNull();
    expect(chooseOption(freed, 'remember').pins).toHaveLength(2);
    // Forgetting a place you don't remember changes nothing.
    expect(forgetPin(full, 'nowhere@1')).toBe(full);
    // The same place twice is one pin.
    expect(remember(at('deep-pool', { pins: [pin('deep-pool', 2)] })).unmet).toBe(ALREADY_PINNED);
    expect(remember(at('deep-pool', { pins: [pin('deep-pool', 1)] })).unmet).toBeNull();
  });

  // 4. A run ends, the character carries on: the new run has no pins; Memory practice carries over.
  it('lets pins go with the run, and keeps the Memory', () => {
    const remembered = chooseOption(at('deep-pool'), 'remember');
    const next = createRegion1({ world: { ...FULL_WORLD, encounters: true } }, legacyOf(remembered), { id: 'w-pins' });
    expect(next.pins ?? []).toEqual([]);
    expect(next.skills.memory).toBe(remembered.skills.memory);
  });

  // 5. The same Warden and trip: the same place is found.
  it('finds the same place on the same trip', () => {
    const seed = seedOf('w-pins-where');
    const places = new Set<string>();
    for (let d = 1; d <= 400; d++) for (const h of [8, 12, 16]) {
      const t = encounterFor(seed, d, h, 2, 'autumn', false);
      expect(encounterFor(seed, d, h, 2, 'autumn', false)?.id).toBe(t?.id);
      if (t?.kind === 'place') places.add(t.id);
    }
    expect(places.size).toBeGreaterThanOrEqual(4);
    // The glade is a daylight place; the berries come in autumn.
    const darkSeen = new Set<string>();
    for (let d = 1; d <= 400; d++) for (const h of [8, 12, 16]) { const t = encounterFor(seed, d, h, 2, 'winter', true); if (t) darkSeen.add(t.id); }
    expect(darkSeen).not.toContain('sunlit-glade');
    expect(darkSeen).not.toContain('berry-thicket');
    // Every place offers to remember it, and a way to move on.
    for (const t of ENCOUNTERS.filter(e => e.kind === 'place')) {
      expect(t.options.some(o => o.remembers)).toBe(true);
      expect(t.options.some(o => o.id === 'move-on')).toBe(true);
    }
  });
});
