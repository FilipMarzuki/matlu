/**
 * #1618 — one list of what a place knows: each road village's remembered facts (#1592) and its
 * country's regional facts (#1605, #1614) as one list, with what both tell merged into one fact.
 *
 * These pin, over several seeds: one list per road village; no fact twice, by id or by telling the
 * same happening; every regional fact of the village's country there (as itself, or merged into
 * the village's fact); the sensitivity, truth and depth rules of both kept; and the same list from
 * the same history. Seeds 1, 4 and 8 are in the list because their histories have events told by
 * both a village and its country (a seizure, a vacant seat, a plague, newcomers).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { seedOf } from '../rng';
import { ANCHORS } from './provinces';
import { runHistory } from './history';
import { remembered, sameEvent, mergeFacts, eventFact, SAME_EVENT_KINDS, type PlaceFact, type RememberedFact, type Remembered } from './remembered';
import { NORTH_ROAD } from './regions';
import { factsOfRegion, regionOfProvince, type RegionalFact } from './regional-facts';
import { knows, answer, type Knower } from '../knowledge';
import type { ReachHistory } from './history-format';

const SEEDS = [1, 4, 8, 3, seedOf('play-s1'), seedOf('play-s2')];
const told = new Map<number, { history: ReachHistory; memory: Remembered }>();
const of = (seed: number) => {
  let t = told.get(seed);
  if (!t) { const history = runHistory(seed); t = { history, memory: remembered(history) }; told.set(seed, t); }
  return t;
};
const STEPS = ['public', 'guarded', 'private', 'secret'];

describe('One list of what a place knows (#1618)', () => {
  it('gives each road village one list: its own facts first, then its country\'s, the same for the same history', () => {
    const counts: string[] = [];
    for (const seed of SEEDS) {
      const { history, memory } = of(seed);
      expect(memory.villages.map(v => v.village)).toEqual([...ANCHORS]);
      // The page's way (a kept history, plain JSON) gives the same list.
      expect(remembered(JSON.parse(JSON.stringify(history)))).toEqual(memory);
      for (const v of memory.villages) {
        // The country is the generated region of its province, even though the crafted north road wins `region`.
        expect(v.region).toBe(NORTH_ROAD);
        expect(v.country).toBe(regionOfProvince(history, v.province.id)!.id);
        // Its own facts come first, in their order, each by its own id.
        expect(v.known.slice(0, v.facts.length).map(f => f.id)).toEqual(v.facts.map(f => f.id));
        // Then only its country's: no other region's facts.
        for (const f of v.known.slice(v.facts.length)) expect(f.scope).toEqual({ kind: 'region', id: v.country });
        counts.push(`${v.village} ${v.facts.length}+${v.known.length - v.facts.length + v.known.filter(f => f.absorbs).length}→${v.known.length}`);
      }
    }
    console.info(`known (#1618): own+country→one list, per village: ${counts.join(', ')}`);
  });

  it('has no fact twice: not by id, not by telling the same happening', () => {
    let merged = 0;
    for (const seed of SEEDS) {
      const { history, memory } = of(seed);
      for (const v of memory.villages) {
        const ids = v.known.map(f => f.id);
        expect(new Set(ids).size, `${v.village}, seed ${seed}`).toBe(ids.length);
        const p = history.provinces.find(q => q.id === v.province.id)!;
        const r = history.regions.find(x => x.id === v.country)!;
        // Every village event told by its country too is one fact, the village's, absorbing the country's.
        p.lines.forEach((line, k) => {
          const pairs = r.lines.map((rl, j) => ({ rl, j })).filter(({ rl }) => sameEvent(line, p.name, rl));
          const mine = v.known.find(f => f.id === `history:${v.village}:${line.year}:${k}`)!;
          if (pairs.length) {
            expect(mine.absorbs, `${mine.id}, seed ${seed}`).toHaveLength(1);
            expect(pairs.map(({ rl, j }) => `region:${r.id}:${rl.year}:${j}`)).toContain(mine.absorbs![0]);
            expect(ids).not.toContain(mine.absorbs![0]);
            merged++;
          } else expect(mine.absorbs).toBeUndefined();
        });
        // Who holds the seat is told once for the village and its country (the north road's is the caravan's).
        const holder = v.known.find(f => f.id === `history:${v.village}:holder`)!;
        if (p.holder) {
          expect(holder.absorbs).toEqual([`region:${r.id}:lord:${v.village}`]);
          expect(ids).not.toContain(`region:${r.id}:lord:${v.village}`);
        } else expect(holder.absorbs).toBeUndefined();
      }
    }
    // The seeds above do have events told by both, so the dedupe is exercised, not vacuous.
    expect(merged).toBeGreaterThanOrEqual(3);
  });

  it('has every regional fact of the village\'s country, as itself or merged into the village\'s fact, once', () => {
    for (const seed of SEEDS) {
      const { history, memory } = of(seed);
      for (const v of memory.villages) {
        const r = history.regions.find(x => x.id === v.country)!;
        const regional = factsOfRegion(r, history.year);
        const absorbed = v.known.flatMap(f => f.absorbs ?? []);
        for (const f of regional) {
          const as = v.known.filter(k => k.id === f.id).length + absorbed.filter(id => id === f.id).length;
          expect(as, `${f.id} in ${v.village}, seed ${seed}`).toBe(1);
          // Left as itself, it's exactly the regional fact: the same id, scope and fields in every list.
          const kept = v.known.find(k => k.id === f.id);
          if (kept) expect(kept).toEqual(f);
        }
        expect(v.known.length).toBe(v.facts.length + regional.length - absorbed.length);
      }
    }
  });

  it('keeps both lists\' rules: an unmerged fact as it was, a merged one stricter, shallower and with the richer text', () => {
    for (const seed of SEEDS) {
      const { history, memory } = of(seed);
      for (const v of memory.villages) {
        const regional = new Map(factsOfRegion(history.regions.find(x => x.id === v.country)!, history.year).map(f => [f.id, f]));
        for (const own of v.facts) {
          const f = v.known.find(k => k.id === own.id)!;
          if (!f.absorbs) { expect(f).toEqual(own); continue; }
          const other = regional.get(f.absorbs[0])!;
          expect(f.scope).toEqual(own.scope);
          expect(other.truth).toBe(own.truth);
          expect(f.truth).toBe(own.truth);
          expect(STEPS.indexOf(f.sensitivity)).toBe(Math.max(STEPS.indexOf(own.sensitivity), STEPS.indexOf(other.sensitivity)));
          expect(f.depth).toBe(Math.min(own.depth, other.depth));
          expect(f.text).toBe(other.text.length > own.text.length ? other.text : own.text);
          for (const a of [...own.about, ...other.about]) expect(f.about).toContain(a);
        }
      }
    }
  });

  it('gives facts the knowledge model reads: a villager in their country knows their village\'s and country\'s facts', () => {
    const { memory } = of(4);
    const v = memory.villages.find(x => x.known.some(f => f.absorbs && f.id !== `history:${x.village}:holder`))!;
    // How slice F could place a villager: their village, and their country as their region.
    const villager: Knower = { id: 'x', name: 'X', home: v.village, region: v.country!, people: 'p', culture: 'c', role: 'farmer', orgs: {} };
    for (const f of v.known) {
      expect(['village', 'region']).toContain(f.scope.kind);
      // The north road's fact is the caravan's: a villager placed in their country doesn't hold it.
      expect(knows(villager, f)).toBe(f.scope.id !== NORTH_ROAD && (f.depth ?? 1) <= 1);
    }
    // Asked who holds the place, they answer from the one merged fact, their village's.
    const a = answer(villager, `place:${v.village}`, 0, v.known, {});
    expect(a.kind).toBe('told');
    if (a.kind === 'told') expect(a.fact.id).toBe(`history:${v.village}:holder`);
  });

  it('is deterministic over seeds: the same lists every time', () => {
    for (const seed of SEEDS.slice(0, 3)) expect(remembered(of(seed).history)).toEqual(of(seed).memory);
  });
});

describe('Telling when two lines are the same happening (#1618)', () => {
  const present = 151;
  const rline = (over: Partial<Parameters<typeof sameEvent>[2]> = {}) => ({ year: 140, kind: 'SEAT_SEIZED', category: 'politics' as const, significance: 6, province: 'Hollowford', text: 'Ivar of Hedlund seized Hundred of Hollowford.', ...over });

  it('matches the same year, a kind read from the other, and the same place (or a region-wide famine or plague)', () => {
    const usurp = { year: 140, text: 'Ivar of Hedlund usurped the Hundred of Hollowford from his cousin.', kind: 'USURP', house: 'Hedlund' };
    expect(sameEvent(usurp, 'Hollowford', rline())).toBe(true);
    expect(sameEvent(usurp, 'Hollowford', rline({ year: 141 }))).toBe(false);
    expect(sameEvent(usurp, 'Saltmere', rline())).toBe(false);
    expect(sameEvent(usurp, 'Hollowford', rline({ kind: 'LORD_DIED' }))).toBe(false);
    expect(sameEvent({ ...usurp, kind: undefined }, 'Hollowford', rline())).toBe(false);
    const plague = { year: 98, text: 'A pestilence broke out near Hollowford.', kind: 'PLAGUE' };
    expect(sameEvent(plague, 'Hollowford', rline({ year: 98, kind: 'PLAGUE', province: null }))).toBe(true);
    // A seizure told with no place isn't matched by year and kind alone.
    expect(sameEvent(usurp, 'Hollowford', rline({ province: null }))).toBe(false);
  });

  it('merges into the village\'s fact: its id and scope, the stricter sensitivity, the shallower depth, the richer text', () => {
    // A seizure by the house that rules the village: a house affair would be private for them;
    // the country tells it guarded. A kinslaying isn't read into a regional kind, so use a made-up pair.
    const own: RememberedFact = { ...eventFact('hollowford', { year: 140, text: 'Short.', kind: 'MURDER', house: 'Hedlund' }, present, 0, 'Hedlund') };
    expect(own.sensitivity).toBe('private');
    const regional: RegionalFact = { id: 'region:x-country:140:3', about: ['region:x-country', 'place:hollowford'], text: '11 years ago, in year 140: a longer telling of it.', scope: { kind: 'region', id: 'x-country' }, sensitivity: 'guarded', truth: 'true', depth: 2, year: 140, kind: 'politics' };
    const m: PlaceFact = mergeFacts(own, regional);
    expect(m.id).toBe(own.id);
    expect(m.scope).toEqual({ kind: 'village', id: 'hollowford' });
    expect(m.sensitivity).toBe('private');
    expect(m.depth).toBe(1);
    expect(m.text).toBe(regional.text);
    expect(m.about).toEqual(['place:hollowford', 'region:x-country']);
    expect(m.absorbs).toEqual([regional.id]);
    expect(mergeFacts({ ...own, sensitivity: 'public' }, regional).sensitivity).toBe('guarded');
  });

  it('reads the same engine kinds the regional level does (storytelling/regions.ts)', () => {
    // The sets aren't exported (and loading the engine here is what remembered.ts avoids), so read them from the source.
    const src = readFileSync(new URL('../../../storytelling/regions.ts', import.meta.url), 'utf8');
    const set = (name: string) => [...(src.match(new RegExp(`const ${name}: ReadonlySet<EventType> = new Set<EventType>\\(\\[([^\\]]*)\\]`))?.[1] ?? '').matchAll(/"([A-Z_]+)"/g)].map(m => m[1]).sort();
    expect([...SAME_EVENT_KINDS.UNREST].sort()).toEqual(set('UNREST'));
    expect([...SAME_EVENT_KINDS.MIGRATION].sort()).toEqual(set('ARRIVALS'));
    expect([...SAME_EVENT_KINDS.BANDITRY].sort()).toEqual(set('BANDITS'));
    expect([...SAME_EVENT_KINDS.FAIR].sort()).toEqual(set('FAIRS'));
    expect(set('UNREST').length).toBeGreaterThan(0);
  });
});
