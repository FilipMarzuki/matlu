/**
 * Pins on screen (#1380): the memory line with the remember-this prompt, the 📌 on the land, the
 * pins list with its controls, the queue note and the journal line on going back. A visual issue —
 * these pin the words and the hooks, not the look.
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, runAction, type Region1State } from '../artificer/region1';
import { FLAT_WORLD } from '../artificer/world';
import { createExploration, scout, type Ring } from '../artificer/exploration';
import { LEVEL_HOURS } from '../artificer/skills';
import { pinId, tripPinNote, type Pin, type PinKind, type Interest } from '../artificer/pins';
import { encounterModal } from './encounter-view';
import { memoryLine, ringPinChip, ringPins, pinsList } from './pins-view';
import { GAME_WORLD } from './controller';

const pin = (place: string, kind: PinKind, ring: Ring, interest?: Interest, day = 1): Pin => ({ id: pinId(place, ring), place, kind, ring, day, ...(interest ? { interest } : {}) });
const at = (pins: Pin[] = [], extra: Partial<Region1State> = {}): Region1State => {
  const s = createRegion1({ world: GAME_WORLD }, undefined, { id: 'w-pins-ui' });
  return { ...s, pins, pending: { id: 'deep-pool', day: 4, hour: 11, ring: 2, action: 'scout', state: 'calm', margin: 0 }, ...extra };
};

describe('Pins on screen (#1380)', () => {
  it('shows how much room memory has with the remember-this prompt, and what you would let go', () => {
    expect(encounterModal(at(), null, 0)).toContain('🧠 Memory: <b>0 of 2</b> places');
    const full = encounterModal(at([pin('sunlit-glade', 'peaceful', 1, undefined, 3), pin('sheltered-hollow', 'shelter', 1, undefined, 2)]), null, 0);
    expect(full).toMatch(/enc-memory full/);
    expect(full).toContain("You'd let go of <b>the sheltered hollow</b> (near ring) first.");
    expect(full).toContain('data-forget="sheltered-hollow@1"');
    expect(full).toMatch(/data-choose="remember" disabled title="your memory is full/);
    // Only places get the memory line.
    expect(encounterModal({ ...at(), pending: { ...at().pending!, id: 'wild-boar' } }, null, 0)).not.toContain('enc-memory');
  });

  it('puts a 📌 on each ring that holds a pin, and lists that ring\'s places', () => {
    const s = at([pin('deep-pool', 'fishing', 2), pin('stone-outcrop', 'stone', 2, 3)]);
    expect(ringPinChip(s, 1, false)).toBe('');
    expect(ringPinChip(s, 2, false)).toMatch(/class="chip pin loud" data-pinring="2" aria-expanded="false">📌 2 places/);
    expect(ringPinChip(at([pin('deep-pool', 'fishing', 2)]), 2, true)).toMatch(/📌 the deep pool/);
    const list = ringPins(s, 2);
    expect(list).toContain('+1 water and fish in this ring');
    expect(list).toContain('+2 stone quarried in this ring'); // ★★★ counts double
    expect(list).not.toContain('data-forget'); // the land only shows; the list controls
  });

  it('lists every pin by ring, with forget and — once Memory allows — interest controls', () => {
    const pins = [pin('deep-pool', 'fishing', 2), pin('sunlit-glade', 'peaceful', 1)];
    const plain = pinsList(at(pins));
    expect(plain).toContain('You can hold <b>2</b> places in mind');
    expect(plain).toContain('With more Memory you will learn to weigh them.');
    expect(plain).toContain('data-forget="deep-pool@2"');
    expect(plain).not.toContain('data-interest');
    expect(plain.indexOf('NEAR')).toBeLessThan(plain.indexOf('FAR'));
    const apprentice = pinsList(at(pins, { skills: { memory: LEVEL_HOURS[2] } }));
    expect(apprentice).toContain('data-interest="deep-pool@2|2"');
    expect(apprentice).toMatch(/data-interest="deep-pool@2\|3" disabled/);
    expect(pinsList(at(pins, { skills: { memory: LEVEL_HOURS[3] } }))).not.toMatch(/data-interest="deep-pool@2\|3" disabled/);
    expect(pinsList(at())).toContain('None yet.');
    expect(memoryLine(at([pins[0]]))).not.toContain('full');
  });

  it('says in the queue what a remembered place does for a trip', () => {
    const pins = [pin('deep-pool', 'fishing', 2), { ...pin('sunlit-glade', 'peaceful', 1), feeling: 'peaceful' as const }];
    expect(tripPinNote(pins, 'water', 2)).toBe('📌 the deep pool: +1 water');
    expect(tripPinNote(pins, 'gather', 2)).toBeNull();
    expect(tripPinNote(pins, 'gather', 1)).toBe('📌 the sunlit glade: calmer');
  });

  it('notes in the journal when you go back by a place you remember — louder for a ★★★ one', () => {
    const base = createRegion1({ world: FLAT_WORLD }, undefined, { id: 'w-pins-ui' });
    const out = (p: Pin): Region1State => ({ ...base, day: 5, explore: scout(scout(createExploration(), 1), 2), pins: [p] });
    const back = runAction(out(pin('deep-pool', 'fishing', 2)), 'water@2').log.find(l => l.text.startsWith('You go back'))!;
    expect(back).toMatchObject({ text: 'You go back by the deep pool you remembered.', kind: 'action' });
    expect(runAction(out(pin('deep-pool', 'fishing', 2, 3)), 'water@2').log.find(l => l.text.startsWith('You go back'))!.kind).toBe('milestone');
  });
});
