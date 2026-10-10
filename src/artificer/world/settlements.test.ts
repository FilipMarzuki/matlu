/**
 * #1541 — the Reach's settlements, with the hand-written villages as anchors.
 *
 * Phase 3 of the Artificer's generated world (docs/spikes/artificer-generated-world.md): a
 * settlement at every province seat, laid out by the Settlement Forge's generator (mapgen/), and
 * Hollowford, Saltmere and Kestrel Gate seated as three of them on the road south to Mistheim.
 */

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { seedOf } from '../rng';
import { VILLAGES } from '../villages';
import { generateReach, REACH_W } from './reach';
import { provincesOf, ANCHORS } from './provinces';
import { settlementOf } from './settlements';

const SEEDS = Array.from({ length: 12 }, (_, i) => seedOf(`w-test-${i}`));

describe('The hand-written villages as anchors (#1541)', () => {
  it('seats each hand-written village exactly once, in the road\'s order south towards Mistheim', () => {
    for (const seed of SEEDS) {
      const { list } = provincesOf(generateReach(seed));
      const at = ANCHORS.map(id => list.filter(p => p.anchor === id));
      for (const [k, found] of at.entries()) {
        expect(found, `${ANCHORS[k]} once (seed ${seed})`).toHaveLength(1);
        expect(found[0].name).toBe(VILLAGES[ANCHORS[k]].name);
        expect(found[0].culture).toBe(VILLAGES[ANCHORS[k]].cultures[0]);
      }
      expect(list.filter(p => p.name === 'Hollowford' || p.name === 'Saltmere' || p.name === 'Kestrel Gate')).toHaveLength(3);
      // Hollowford, then Saltmere, then Kestrel Gate, each further south (the road runs north to south).
      const [ford, mere, gate] = at.map(f => f[0]);
      expect(ford.seat.y, `seed ${seed}`).toBeLessThan(mere.seat.y);
      expect(mere.seat.y, `seed ${seed}`).toBeLessThan(gate.seat.y);
      // The Gate is the last seat before the lowlands, and Saltmere sits by a lake when one can.
      expect(gate.seat.y).toBe(Math.max(...list.map(p => p.seat.y)));
      if (list.some(p => p !== gate && p.lakeside && p.seat.y < gate.seat.y)) expect(mere.lakeside, `seed ${seed}`).toBe(true);
    }
  });
});

describe('The Reach\'s settlements (#1541)', () => {
  it('builds the same settlements from the same seed', () => {
    const reach = generateReach(seedOf('w-vega'));
    const { list } = provincesOf(reach);
    const ford = list.find(p => p.anchor === 'hollowford')!;
    const a = settlementOf(reach, ford), b = settlementOf(generateReach(seedOf('w-vega')), provincesOf(generateReach(seedOf('w-vega'))).list.find(p => p.anchor === 'hollowford')!);
    expect(b).toEqual(a);
    expect(createHash('sha256').update(a.rows.join('\n')).digest('hex').slice(0, 16)).toBe('4fc3a5553de3d6e6');
  });

  it("puts every hand-written villager in their village, in a building that suits their work", () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const reach = generateReach(seed);
      for (const p of provincesOf(reach).list.filter(q => q.anchor)) {
        const s = settlementOf(reach, p);
        const placed = [...s.buildings.flatMap(b => b.people), ...s.about];
        expect(placed.sort()).toEqual(VILLAGES[p.anchor!].people.map(v => `${v.name} (${v.role})`).sort());
        // Nobody is left about the place: each role's workplace is built if the generator didn't pick one.
        expect(s.about, `${s.name}, seed ${seed}`).toEqual([]);
        const smith = VILLAGES[p.anchor!].people.find(v => v.role === 'smith');
        if (smith) expect(['smithy', 'workshop', 'smelter']).toContain(s.buildings.find(b => b.people.includes(`${smith.name} (smith)`))!.id);
      }
    }
  });

  it('draws every settlement to fit the map\'s width, with one letter per building and a key for each', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const reach = generateReach(seed);
      for (const p of provincesOf(reach).list) {
        const s = settlementOf(reach, p);
        expect(s.rows[0].length, `${s.name} width`).toBeLessThanOrEqual(REACH_W);
        expect(s.rows.length, `${s.name} height`).toBeLessThanOrEqual(40);
        expect(s.rows.every(r => r.length === s.rows[0].length)).toBe(true);
        const letters = s.buildings.map(b => b.letter);
        expect(new Set(letters).size, `${s.name}: letters are unique`).toBe(letters.length);
        const drawn = new Set(s.rows.join('').replace(/[.=-]/g, ''));
        expect([...drawn].sort()).toEqual([...letters].sort());
        expect(s.buildings.length).toBeGreaterThan(0);
      }
    }
  });
});
