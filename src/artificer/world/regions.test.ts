/**
 * #1598 — the story engine's regional level, in the Reach.
 *
 * Regions group neighbouring provinces around market towns (storytelling/regions.ts), keep a
 * running political and economic state through the 150 years, and log regional events. The
 * told history carries them (history.ts `regionsOf`), and regional-facts.ts reads them as facts
 * for the knowledge model. These tests pin that the regions are sound, deterministic, and that
 * the facts cover politics, economics and events with the knowledge model's truth and depth.
 */

import { describe, it, expect } from 'vitest';
import { seedOf } from '../rng';
import { loadWorld } from '../../../storytelling/seed';
import { generateReach } from './reach';
import { provincesOf } from './provinces';
import { reachSpec, runHistory, simulateReach, regionalChronicleEvents, REGION_CHRONICLE_THRESHOLD, HISTORY_YEARS } from './history';
import { sift } from '../../../storytelling/sifter';
import { extractArcs } from '../../../storytelling/arcs';
import { EXTRA_MARK, renderLayeredChronicle, renderRegionalEventNamed } from '../../../storytelling/render';
import { GENERATION, factsOfRegion, lineFact, regionalFacts, regionOfProvince } from './regional-facts';
import { LIVING_MEMORY } from './history-format';

const SEEDS = Array.from({ length: 12 }, (_, i) => seedOf(`w-test-${i}`));

/** The Reach's starting world: regions are formed at seed time, so no years need running. */
const startOf = (seed: number) => {
  const reach = generateReach(seed);
  const provinces = provincesOf(reach);
  return { provinces, world: loadWorld(reachSpec(reach, provinces), seedOf(`${seed}|world|history`)) };
};

describe('Regions of the Reach (#1598)', () => {
  it('puts every province in exactly one region, each a few neighbouring provinces around its market town', () => {
    for (const seed of SEEDS) {
      const { provinces, world } = startOf(seed);
      const all = [...world.regions.values()].flatMap(r => r.provinceIds);
      expect(all.slice().sort(), `seed ${seed}`).toEqual(provinces.list.map(p => p.id).sort());
      expect(new Set(all).size).toBe(all.length);
      for (const r of world.regions.values()) {
        expect(r.provinceIds[0]).toBe(r.centreId);
        expect(r.provinceIds.length, `${r.name} (seed ${seed})`).toBeGreaterThanOrEqual(2);
        expect(r.provinceIds.length, `${r.name} (seed ${seed})`).toBeLessThanOrEqual(6);
        // In one piece, and no further than two borders from its market town (a few days across).
        const hops = new Map([[r.centreId, 0]]);
        let frontier = [r.centreId];
        while (frontier.length) {
          const next: string[] = [];
          for (const id of frontier) for (const n of world.province(id)!.neighbors) {
            if (r.provinceIds.includes(n) && !hops.has(n)) { hops.set(n, hops.get(id)! + 1); next.push(n); }
          }
          frontier = next;
        }
        expect(hops.size, `${r.name} is in one piece (seed ${seed})`).toBe(r.provinceIds.length);
        expect(Math.max(...hops.values())).toBeLessThanOrEqual(2);
        // Every province lives on something; the market town on its market, the region on its land.
        expect(r.livelihoods[r.centreId]).toBe('trading');
        expect(r.primary).not.toBe('trading');
        for (const id of r.provinceIds) expect(r.livelihoods[id]).toBeDefined();
        expect(r.provinceIds).toContain(r.venture.provinceId);
      }
    }
  });

  it('forms the same regions from the same seed', () => {
    const a = startOf(SEEDS[0]).world, b = startOf(SEEDS[0]).world;
    expect([...a.regions.values()]).toEqual([...b.regions.values()]);
  });
});

describe('Regional history and facts (#1598)', () => {
  // Four histories, told once and shared by the tests below (each takes a few hundred ms).
  const histories = SEEDS.slice(0, 4).map(seed => runHistory(seed));

  it('tells the same regions, events and facts from the same seed', () => {
    const again = runHistory(SEEDS[0]);
    expect(again.regions).toEqual(histories[0].regions);
    expect(regionalFacts(again)).toEqual(regionalFacts(histories[0]));
    // Plain data: it survives the worker and storage unchanged.
    expect(JSON.parse(JSON.stringify(histories[0].regions))).toEqual(histories[0].regions);
  });

  it('covers politics, economics and regional events over a long run', () => {
    for (const h of histories) {
      const facts = regionalFacts(h);
      for (const kind of ['politics', 'economy', 'event'] as const) {
        expect(facts.some(f => f.kind === kind), `${kind} facts (seed ${h.seed})`).toBe(true);
        // And not only how things stand: told events of each kind, too.
        expect(h.regions.some(r => r.lines.some(l => l.category === kind)), `${kind} lines (seed ${h.seed})`).toBe(true);
      }
      for (const r of h.regions) {
        const mine = factsOfRegion(r, h.year);
        expect(mine.every(f => f.scope.kind === 'region' && f.scope.id === r.id && f.about.includes(`region:${r.id}`))).toBe(true);
        expect(new Set(mine.map(f => f.id)).size, `fact ids unique in ${r.name}`).toBe(mine.length);
        // Every region always knows what it lives on, who leads it and what its lords ask.
        expect(mine.some(f => f.id.endsWith(':trade'))).toBe(true);
        expect(mine.some(f => f.id.endsWith(':dues'))).toBe(true);
        for (const l of r.lines) expect(l.year).toBeGreaterThanOrEqual(1);
      }
      // Every province can find its region.
      for (const p of h.provinces) expect(regionOfProvince(h, p.id)?.provinces.map(q => q.id)).toContain(p.id);
    }
  });

  it('marks old events as rumour known to few, and recent ones as true, known to most or all', () => {
    const h = histories[0];
    const r = h.regions[0];
    const line = { year: 0, kind: 'FAMINE', category: 'event' as const, significance: 6, province: null, text: 'Famine struck.' };
    const old = lineFact(r, { ...line, year: h.year - LIVING_MEMORY - 1 }, h.year);
    expect([old.truth, old.depth]).toEqual(['rumour', 3]);
    const recent = lineFact(r, { ...line, year: h.year - 2 }, h.year);
    expect([recent.truth, recent.depth]).toEqual(['true', 1]);
    const middling = lineFact(r, { ...line, year: h.year - GENERATION - 1 }, h.year);
    expect([middling.truth, middling.depth]).toEqual(['true', 2]);
    // Small news (a fair) is known to most, not all, even when recent; lords' quarrels are guarded.
    expect(lineFact(r, { ...line, kind: 'FAIR', significance: 2, year: h.year - 1 }, h.year).depth).toBe(2);
    expect(lineFact(r, { ...line, kind: 'FEUD', category: 'politics', year: h.year - 1 }, h.year).sensitivity).toBe('guarded');
    // And the real facts follow the rule.
    for (const f of regionalFacts(h)) {
      if (h.year - f.year > LIVING_MEMORY) expect([f.truth, f.depth]).toEqual(['rumour', 3]);
      else expect(f.truth).toBe('true');
    }
  });
});

describe('Big regional events in the told chronicle (#1598)', () => {
  // The owner's call: famine, plague, a house losing its seats belong in the history the HISTORY
  // tab shows, in year order among the province events. Told at the telling layer only.
  const runs = SEEDS.slice(0, 3).map(seed => {
    const { world } = simulateReach(seed);
    const { chronicle } = sift(world, 5);
    return { seed, world, chronicle, text: runHistory(seed).chronicle };
  });

  it('tells the big ones, naming the region, in year order', () => {
    for (const { seed, world, chronicle, text } of runs) {
      const big = regionalChronicleEvents(world, new Set(chronicle.map(e => e.id)));
      expect(big.length, `seed ${seed}`).toBeGreaterThan(0);
      const lines = text.split('\n');
      const marked = lines.filter(l => l.includes(EXTRA_MARK));
      expect(marked.length, `seed ${seed}`).toBe(big.filter(e => world.year - e.year <= HISTORY_YEARS).length);
      let last = -1;
      for (const e of big) {
        const sentence = renderRegionalEventNamed(world, e).replace(/\.$/, '');
        expect(sentence).toContain(`the ${world.regions.get(e.regionId)!.name} country`);
        const at = lines.findIndex((l, i) => i > last && l.includes(EXTRA_MARK) && l.includes(sentence));
        expect(at, `${e.year} ${e.kind} (seed ${seed})`).toBeGreaterThan(last);
        last = at;
        expect(e.significance).toBeGreaterThanOrEqual(REGION_CHRONICLE_THRESHOLD);
      }
      // In living memory each sits under its own year, after that year's province events.
      let year = 0;
      for (const l of lines) {
        const m = l.match(/^\s*(\d+)\s{2}/);
        if (!m) continue;
        expect(Number(m[1]), `living memory in year order (seed ${seed})`).toBeGreaterThanOrEqual(year);
        year = Number(m[1]);
      }
    }
  });

  it('leaves the small ones out: fairs, festivals, hard winters, bandits', () => {
    for (const { world, text } of runs) {
      const marked = text.split('\n').filter(l => l.includes(EXTRA_MARK)).join('\n');
      expect(marked).not.toMatch(/fair was held|festival was held|hard winter|Bandits troubled|bumper harvest/);
      const big = new Set(regionalChronicleEvents(world, new Set()).map(e => e.id));
      for (const e of world.regionalEvents) if (e.significance < REGION_CHRONICLE_THRESHOLD) expect(big.has(e.id)).toBe(false);
    }
  });

  it('only adds lines: the province chronicle reads as before', () => {
    for (const { world, chronicle, text } of runs) {
      const arcs = extractArcs(world, chronicle);
      const before = renderLayeredChronicle(world, chronicle, arcs, { living: LIVING_MEMORY, chronicle: HISTORY_YEARS });
      const strip = (t: string) => t.split('\n').filter(l => !l.includes(EXTRA_MARK) && !l.startsWith('LIVING MEMORY') && l.trim()).join('\n');
      expect(strip(text)).toBe(strip(before));
    }
  });
});
