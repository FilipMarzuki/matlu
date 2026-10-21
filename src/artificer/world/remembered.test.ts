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
import { runHistory, rememberedOf, rememberedCache, pickLines, simulateReach, LIVING_MEMORY } from './history';
import { remembered, eventFact, recall, publicityOf, sensitivityOf, hasStake, GENERATION, type Remembered } from './remembered';
import { CRAFTED_REGIONS, NORTH_ROAD, generatedRegions, regionFor, regionOf, roadRegions } from './regions';
import { regionOfProvince } from './regional-facts';
import { sift } from '../../../storytelling/sifter';
import type { WorldEvent } from '../../../storytelling/types';

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
      // Its region: the crafted north road (regions.ts), whatever the generator grouped it into.
      expect(v.region).toBe(NORTH_ROAD);
      expect(v.crafted).toBe(true);
      expect(v.title).toContain(v.province.name);
      expect(v.events.length).toBeLessThanOrEqual(3);
      // The holder, for the province and for the road, then one fact per told event.
      expect(v.facts.map(f => f.scope)).toEqual([
        { kind: 'village', id: v.village }, { kind: 'region', id: NORTH_ROAD },
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
      for (const r of regions) expect(r.province.name).toBe(VILLAGES[r.village].name);
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

// The owner's answers on PR #1592 (2026-10-11).
const SEEDS = ['play-s1', 'play-abc', 'w-test-0', 'w-test-1', 'w-test-2'].map(seedOf);

describe('Something true and recent: a place kept for living memory (#1586, answer 1)', () => {
  const present = 151;
  const ev = (id: number, year: number, significance: number, actorId: string | null = `c${id}`) => ({ id, year, significance, actorId });

  it('gives the last place to the most significant recent event when the top ones are all old', () => {
    const events = [ev(1, 10, 9), ev(2, 20, 8), ev(3, 30, 7), ev(4, 140, 5), ev(5, 145, 6), ev(6, 40, 6.5)];
    // Top three by significance are 1, 2, 3 (all legend); 5 is the most significant recent one.
    expect(pickLines(events, present).map(e => e.id)).toEqual([1, 2, 5]);
  });

  it('keeps the top ones as they were when one is already recent, or none is', () => {
    const recentInTop = [ev(1, 10, 9), ev(2, 140, 8), ev(3, 30, 7), ev(4, 145, 5)];
    expect(pickLines(recentInTop, present).map(e => e.id)).toEqual([1, 3, 2]);
    const allOld = [ev(1, 10, 9), ev(2, 20, 8), ev(3, 30, 7), ev(4, 40, 6)];
    expect(pickLines(allOld, present).map(e => e.id)).toEqual([1, 2, 3]);
    // Fewer than three told: all kept. None: none.
    expect(pickLines([ev(1, 10, 9), ev(2, 150, 1)], present).map(e => e.id)).toEqual([1, 2]);
    expect(pickLines([], present)).toEqual([]);
    // The edge of living memory counts, as in recall().
    expect(pickLines([ev(1, 10, 9), ev(2, 20, 8), ev(3, 30, 7), ev(4, present - LIVING_MEMORY, 1)], present).map(e => e.id)).toEqual([1, 2, 4]);
    expect(pickLines([ev(1, 10, 9), ev(2, 20, 8), ev(3, 30, 7), ev(4, present - LIVING_MEMORY - 1, 1)], present).map(e => e.id)).toEqual([1, 2, 3]);
  });

  it('still tells a deed once: the same person in the same year is one line', () => {
    const events = [ev(1, 10, 9), ev(2, 20, 8), ev(3, 30, 7), ev(4, 140, 6, 'c9'), ev(5, 140, 5, 'c9')];
    expect(pickLines(events, present).map(e => e.id)).toEqual([1, 2, 4]);
  });

  it('gives every province with anything recent in its history a true, recent event, over several seeds', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const h = runHistory(seed);
      // The same events runHistory chooses from: the told chronicle, by province (its own, or its title's seat).
      const { world } = simulateReach(seed);
      const { chronicle } = sift(world, 5);
      const where = (e: WorldEvent) => e.provinceId ?? world.title(e.titleId)?.provinceId ?? null;
      for (const p of h.provinces) {
        const anyRecent = chronicle.some(e => where(e) === p.id && h.year - e.year <= LIVING_MEMORY);
        expect(p.lines.some(l => h.year - l.year <= LIVING_MEMORY), `${p.name}, seed ${seed}`).toBe(anyRecent);
        for (const l of p.lines) expect(typeof l.kind).toBe('string');
      }
      const r = remembered(h);
      for (const v of r.villages) {
        const anyRecent = chronicle.some(e => where(e) === v.province.id && h.year - e.year <= LIVING_MEMORY);
        if (anyRecent) expect(v.facts.some(f => f.id.split(':').length === 4 && f.truth === 'true'), `${v.village}, seed ${seed}`).toBe(true);
      }
    }
  });
});

describe('Regions are semi-generated: crafted where written, generated where not (#1586, answer 2)', () => {
  it('lets a crafted region win, and falls back to the generated region, then to the province itself', () => {
    const h = runHistory(SEED);
    const { list } = provincesOf(generateReach(SEED));
    const gen = generatedRegions(h);
    for (const p of list) {
      const r = regionFor(p, gen);
      if (p.anchor && CRAFTED_REGIONS[p.anchor]) {
        expect(r).toEqual({ id: NORTH_ROAD, crafted: true });
      } else {
        // Not crafted: the engine's region (#1598), e.g. `hollowford-country`.
        expect(r).toEqual({ id: regionOfProvince(h, p.id)!.id, crafted: false });
        expect(r.id).toMatch(/-country$/);
        // With no regions to hand, a region of its own.
        expect(regionFor(p)).toEqual({ id: regionOf(p), crafted: false });
      }
    }
    // A province the generator left out of every region falls back to its own region too.
    expect(regionFor({ id: 'p99', name: 'Ember Moss' }, gen)).toEqual({ id: 'ember-moss', crafted: false });
  });

  it('gives the road villages the north road whatever the seed, and the generated regions the rest', () => {
    for (const seed of SEEDS.slice(2)) {
      const provinces = provincesOf(generateReach(seed));
      // Generated regions that would say otherwise don't move a crafted one.
      expect(roadRegions(provinces, () => 'somewhere-else').map(r => r.region)).toEqual([NORTH_ROAD, NORTH_ROAD, NORTH_ROAD]);
      const others = provinces.list.filter(p => !p.anchor);
      expect(others.length).toBeGreaterThan(0);
      for (const p of others) expect(regionFor(p, () => 'the-generated-one').id).toBe('the-generated-one');
    }
  });
});

describe('Server games: computed lazily, kept per seed (#1586, answer 3)', () => {
  const fake = (seed: number) => ({ seed, year: 151, villages: [] }) as Remembered;

  it('tells a seed once, then hands back the kept one', () => {
    const told: number[] = [];
    const get = rememberedCache(4, s => { told.push(s); return fake(s); });
    const a = get(1);
    expect(get(1)).toBe(a);
    get(2);
    expect(get(1)).toBe(a);
    expect(told).toEqual([1, 2]);
  });

  it('keeps only the last few seeds used, forgetting the least recently used first', () => {
    const told: number[] = [];
    const get = rememberedCache(2, s => { told.push(s); return fake(s); });
    get(1); get(2); get(1); // 1 is now the most recent
    get(3); // forgets 2
    get(1); // still kept
    get(2); // told again, forgets 3
    get(3); // told again
    expect(told).toEqual([1, 2, 3, 2, 3]);
  });

  it('gives what rememberedOf gives', () => {
    const get = rememberedCache();
    expect(get(SEED)).toEqual(rememberedOf(SEED));
  });

  // Acceptance criterion 3: a new API game (id `play-<seed>`) has its remembered facts on demand,
  // from the Warden's id, as the page tells the same world; the second ask is the kept one.
  it('has a new API game\'s facts on demand from its id, the second ask kept', () => {
    const get = rememberedCache();
    const seed = seedOf('play-acceptance-1586');
    const first = get(seed);
    expect(first.villages.map(v => v.village).sort()).toEqual(['hollowford', 'kestrel-gate', 'saltmere']);
    expect(first.villages.every(v => v.title.length > 0 && v.facts.length > 0)).toBe(true);
    expect(get(seed)).toBe(first);
  });
});

describe('Sensitivity: how public it was, and the teller\'s stake (#1586, answer 4)', () => {
  const present = 151;

  it('keeps public events public, and a house\'s affairs guarded or private', () => {
    for (const k of ['WAR', 'PLAGUE', 'FAMINE', 'SUCCESSION', 'USURP', 'CHILD_KING_CROWNED', undefined]) expect(publicityOf(k)).toBe('public');
    for (const k of ['MURDER', 'KINSLAYING_NOTORIOUS', 'SCHEME_DISCOVERED', 'MADNESS_ONSET', 'BASTARD_ACKNOWLEDGED']) expect(publicityOf(k)).toBe('house');
    for (const k of ['SECRET_HEIR_DISCOVERED', 'CONCUBINE_BEARS_HEIR']) expect(publicityOf(k)).toBe('family');
    expect(sensitivityOf('public', false)).toBe('public');
    expect(sensitivityOf('public', true)).toBe('public');
    expect(sensitivityOf('house', false)).toBe('guarded');
    expect(sensitivityOf('house', true)).toBe('private');
    expect(sensitivityOf('family', false)).toBe('private');
    expect(sensitivityOf('family', true)).toBe('secret');
  });

  it('makes a fact about a house one step more guarded for its own people and those it rules', () => {
    expect(hasStake('Hedlund', { house: 'Hedlund' })).toBe(true);
    expect(hasStake('Hedlund', { lord: 'Hedlund' })).toBe(true);
    expect(hasStake('Hedlund', { house: 'Varga', lord: 'Varga' })).toBe(false);
    expect(hasStake(null, { house: 'Hedlund', lord: 'Hedlund' })).toBe(false);
    const kinslaying = { year: 20, text: 'Ivar of Hedlund had his own kinsman killed.', kind: 'MURDER', house: 'Hedlund' };
    // An old kinslaying isn't guarded as a blanket rule: it depends on whose it is.
    expect(eventFact('hollowford', kinslaying, present, 0, 'Hedlund').sensitivity).toBe('private');
    expect(eventFact('hollowford', kinslaying, present, 0, 'Varga').sensitivity).toBe('guarded');
    expect(eventFact('hollowford', kinslaying, present, 0, null).sensitivity).toBe('guarded');
    // And a war is public, even one the village's own lords started.
    expect(eventFact('hollowford', { year: 20, text: 'War.', kind: 'WAR', house: 'Hedlund' }, present, 0, 'Hedlund').sensitivity).toBe('public');
    // A line with no kind (hand-written) is public.
    expect(eventFact('hollowford', { year: 20, text: 'The mill burned.' }, present).sensitivity).toBe('public');
  });

  it('grades every told event in real histories by its kind and stake, and keeps who holds a place public', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const h = runHistory(seed);
      for (const v of remembered(h).villages) {
        const p = h.provinces.find(q => q.id === v.province.id)!;
        expect(v.facts.slice(0, 2).map(f => f.sensitivity)).toEqual(['public', 'public']);
        p.lines.forEach((l, k) => {
          const f = v.facts[2 + k];
          expect(f.sensitivity).toBe(sensitivityOf(publicityOf(l.kind), !!l.house && l.house === p.house));
          seen.add(f.sensitivity);
        });
      }
    }
    // Not a blanket rule either way: some told events are public and some are not.
    expect(seen.has('public')).toBe(true);
    expect([...seen].some(s => s !== 'public')).toBe(true);
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
