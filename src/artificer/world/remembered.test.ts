/**
 * #1586 — the generated history as what each road village remembers.
 *
 * The world engine seats Hollowford, Saltmere and Kestrel Gate at generated provinces and lives
 * through 150 years of them (history.ts). remembered.ts reads that history as facts for the
 * knowledge model: who holds each village's province, and what happened there, true while it's in
 * living memory and a rumour once it's older. These tests pin that it's deterministic, that it
 * names the right provinces, and the truth and depth rules. The timing is printed, not asserted.
 */

import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';
import { seedOf } from '../rng';
import { VILLAGES } from '../villages';
import { generateReach } from './reach';
import { provincesOf, ANCHORS } from './provinces';
import { runHistory, rememberedOf, LIVING_MEMORY } from './history';
import { remembered, eventFact, recall, GENERATION } from './remembered';
import { NORTH_ROAD, regionOf, roadRegions } from './regions';

// A server game's Warden is `play-<seed>` (artificer-play/session.ts), and every run's world is
// seeded by seedOf(character id), the same seed the rest of the run uses.
const SEED = seedOf('play-s1');

describe('What each road village remembers (#1586)', () => {
  it('gives the same facts for the same seed, and names the province each road village is seated in', () => {
    const a = rememberedOf(SEED);
    const b = rememberedOf(SEED);
    expect(b).toEqual(a);
    // The page's way gives the same: the history it keeps (plain JSON) read without the engine.
    const kept = JSON.parse(JSON.stringify(runHistory(SEED)));
    expect(remembered(kept)).toEqual(a);

    const { list } = provincesOf(generateReach(SEED));
    expect(a.villages.map(v => v.village)).toEqual([...ANCHORS]);
    for (const v of a.villages) {
      const seat = list.find(p => p.anchor === v.village)!;
      expect(v.province).toEqual({ id: seat.id, name: VILLAGES[v.village].name });
      // Its regions: its province's (which reads as the village's id in every Reach) and the road's.
      expect(v.region).toBe(v.village);
      expect(v.road).toBe(NORTH_ROAD);
      expect(v.title).toContain(v.province.name);
      expect(v.events.length).toBeLessThanOrEqual(3);
      // The holder, for the province and for the road, then one fact per told event.
      expect(v.facts.map(f => f.scope)).toEqual([
        { kind: 'region', id: v.village }, { kind: 'region', id: NORTH_ROAD },
        ...v.events.map(() => ({ kind: 'village', id: v.village })),
      ]);
      expect(v.facts[0].text).toContain(v.holder ?? 'vacant');
      for (const f of v.facts) expect(f.about).toEqual([`place:${v.village}`]);
    }
    const ids = a.villages.flatMap(v => v.facts.map(f => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds every road village a province of its own, whatever the seed', () => {
    for (let i = 0; i < 8; i++) {
      const provinces = provincesOf(generateReach(seedOf(`w-test-${i}`)));
      const regions = roadRegions(provinces);
      expect(new Set(regions.map(r => r.province.id)).size).toBe(3);
      for (const r of regions) expect(r.region).toBe(regionOf({ name: VILLAGES[r.village].name }));
    }
  });

  it('refuses a history and provinces from different seeds rather than pair the wrong places', () => {
    const history = runHistory(SEED);
    // Another seed whose road villages sit at other province ids (so the pairing really would be wrong).
    const other = Array.from({ length: 20 }, (_, i) => provincesOf(generateReach(seedOf(`other-${i}`))))
      .find(p => roadRegions(p).some(r => history.provinces.find(q => q.id === r.province.id)?.name !== r.province.name))!;
    expect(() => remembered(history, other)).toThrow(/another seed/);
  });
});

describe('Living memory and legend (#1586)', () => {
  const present = 151;
  const line = (ago: number) => ({ year: present - ago, text: 'The mill burned.' });

  it('makes an event older than LIVING_MEMORY a rumour at depth 3', () => {
    const f = eventFact('hollowford', line(LIVING_MEMORY + 1), present);
    expect(f.truth).toBe('rumour');
    expect(f.depth).toBe(3);
    expect(f.scope).toEqual({ kind: 'village', id: 'hollowford' });
    expect(f.text).toBe(`${LIVING_MEMORY + 1} years ago, in year ${present - LIVING_MEMORY - 1}: The mill burned.`);
    expect(eventFact('saltmere', line(140), present)).toMatchObject({ truth: 'rumour', depth: 3 });
  });

  it('keeps one within living memory true: depth 1 within a generation, 2 beyond it', () => {
    expect(eventFact('saltmere', line(1), present)).toMatchObject({ truth: 'true', depth: 1 });
    expect(eventFact('saltmere', line(GENERATION), present)).toMatchObject({ truth: 'true', depth: 1 });
    expect(eventFact('saltmere', line(GENERATION + 1), present)).toMatchObject({ truth: 'true', depth: 2 });
    // The edge counts as living memory, as the chronicle's LIVING MEMORY section has it.
    expect(eventFact('saltmere', line(LIVING_MEMORY), present)).toMatchObject({ truth: 'true', depth: 2 });
    expect(recall(line(LIVING_MEMORY), present).living).toBe(true);
    expect(recall(line(LIVING_MEMORY + 1), present).living).toBe(false);
  });

  it('marks each told event in a real history the same way', () => {
    const r = rememberedOf(seedOf('play-abc'));
    for (const v of r.villages) {
      v.events.forEach((e, k) => {
        expect(e.ago).toBe(r.year - e.year);
        expect(v.facts[2 + k]).toMatchObject(e.living ? { truth: 'true' } : { truth: 'rumour', depth: 3 });
      });
    }
  });
});

describe('The cost (#1586)', () => {
  // Printed for the record, never asserted: timings vary by machine and load, and a test that
  // fails on a slow day teaches nothing. Telling the history is nearly all of it.
  it('prints how long telling the history and reading it take', () => {
    const seeds = ['play-t1', 'play-t2', 'play-t3'].map(seedOf);
    const time = <T>(f: () => T): [T, number] => { const t = performance.now(); const r = f(); return [r, performance.now() - t]; };
    const rows = seeds.map(seed => {
      const [history, tell] = time(() => runHistory(seed));
      const [memory, read] = time(() => remembered(history));
      expect(memory.villages).toHaveLength(3);
      return { seed, tell: Math.round(tell), read: Math.round(read * 10) / 10 };
    });
    console.info(`remembered (#1586): telling the history ${rows.map(r => `${r.tell}ms`).join(' / ')}; reading it ${rows.map(r => `${r.read}ms`).join(' / ')}`);
  });
});
