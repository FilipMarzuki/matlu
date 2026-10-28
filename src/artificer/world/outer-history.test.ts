/**
 * #1906 — history over the wider world: a second, independent run of the engine over the outer
 * provinces (`worldmap/provinces.ts` `outerProvinces`), beside the Reach's own (history.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { seedOf } from '../rng';
import { outerProvinces } from '../../../worldmap/provinces';
import { runHistory, HISTORY_YEARS } from './history';
import { runOuterHistory } from './outer-history';
import { keptOuterHistory } from './history-format';
import { cultureName, type ReachCulture } from './peoples';
import { VILLAGES } from '../villages';

const SEED = seedOf('w-vega');

describe('the wider world gets its own history (#1906)', () => {
  it('scenario 2: runOuterHistory(seed, 30) tells the same history twice', () => {
    const a = runOuterHistory(SEED, 30);
    const b = runOuterHistory(SEED, 30);
    expect(b).toEqual(a);
  });

  it('scenario 3: one ProvinceHistory per outer province, each with a line, a title, and most with a holder', () => {
    const h = runOuterHistory(SEED);
    const ids = outerProvinces(SEED).map(p => p.id).sort();
    expect(h.provinces.map(p => p.id).sort()).toEqual(ids);
    for (const p of h.provinces) {
      expect(p.lines.length, `${p.id} has a line`).toBeGreaterThan(0);
      expect(p.title, `${p.id} has a title`).toBeTruthy();
    }
    expect(h.provinces.filter(p => p.holder !== null).length).toBeGreaterThanOrEqual(h.provinces.length / 2);
  }, 30_000);

  it("scenario 4: with roadAnchors: 'hexes' h0/h1/h2 take the road villages' names and first cultures; without it they keep generated names", () => {
    const byId = (id: string, from: ReturnType<typeof runOuterHistory>) => from.provinces.find(p => p.id === id)!;

    const hexes = runOuterHistory(SEED, HISTORY_YEARS, { roadAnchors: 'hexes' });
    expect(byId('h0', hexes).name).toBe(VILLAGES.hollowford.name);
    expect(byId('h1', hexes).name).toBe(VILLAGES.saltmere.name);
    expect(byId('h2', hexes).name).toBe(VILLAGES['kestrel-gate'].name);
    expect(byId('h0', hexes).culture).toBe(cultureName(VILLAGES.hollowford.cultures[0] as ReachCulture));
    expect(byId('h1', hexes).culture).toBe(cultureName(VILLAGES.saltmere.cultures[0] as ReachCulture));
    expect(byId('h2', hexes).culture).toBe(cultureName(VILLAGES['kestrel-gate'].cultures[0] as ReachCulture));

    const generated = runOuterHistory(SEED);
    for (const id of ['h0', 'h1', 'h2']) expect(['Hollowford', 'Saltmere', 'Kestrel Gate']).not.toContain(byId(id, generated).name);
  }, 30_000);

  it('scenario 5: the Reach keeps its own history whether the outer history runs or not', () => {
    const before = runHistory(SEED);
    runOuterHistory(SEED);
    const after = runHistory(SEED);
    expect(after).toEqual(before);
  }, 30_000);

  it('scenario 6: a kept outer history for one roadAnchors setting is null for the other, so both are told again', () => {
    const reachHistory = runOuterHistory(SEED);
    const hexHistory = runOuterHistory(SEED, HISTORY_YEARS, { roadAnchors: 'hexes' });

    expect(keptOuterHistory(JSON.stringify(hexHistory), SEED)).toBeNull();
    expect(keptOuterHistory(JSON.stringify(reachHistory), SEED, 'hexes')).toBeNull();

    expect(keptOuterHistory(JSON.stringify(reachHistory), SEED)).toEqual(reachHistory);
    expect(keptOuterHistory(JSON.stringify(hexHistory), SEED, 'hexes')).toEqual(hexHistory);
  }, 30_000);
});
