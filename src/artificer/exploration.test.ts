/**
 * Acceptance tests for #1217 — the exploration module (criteria 1–3).
 * Region 1 integration (4–5) is in region1-explore.test.ts; saves (6) in
 * src/artificer-app/controller.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { createExploration, scout, survey, track, work, level, scouted, reachable, tripYield, supplyFactor, hasFind, domainsOf, SUPPLY_FLOOR, SUPPLY_DRAW, TRAVEL_HOURS, RICHNESS } from './exploration';

describe('Exploration rings', () => {
  // 1. Scout → suspected, survey → observed, track → game observed; never past detailed.
  it('raises a ring through scouting, surveying and tracking', () => {
    const e = createExploration();
    expect(scouted(e, 1)).toBe(false);

    const s = scout(e, 1);
    expect(domainsOf(1).every(d => level(s, 1, d) === 1)).toBe(true);
    expect(scouted(s, 1)).toBe(true);
    expect(level(s, 2, 'forage')).toBe(0); // other rings untouched

    const v = survey(s, 1);
    expect(domainsOf(1).every(d => level(v, 1, d) === 2)).toBe(true);
    // Scouting after surveying never lowers anything.
    expect(level(scout(v, 1), 1, 'timber')).toBe(2);

    const t = track(s, 1);
    expect(level(t, 1, 'game')).toBe(2);
    expect(level(t, 1, 'forage')).toBe(1);

    // Pure.
    expect(level(e, 1, 'forage')).toBe(0);
  });

  // 2. Doing teaches detail (up to detailed + a find, once) and spills overview (capped at suspected).
  it('teaches the detail of a domain by working it, and a little of the rest', () => {
    let e = scout(createExploration(), 1);
    const found: (string | null)[] = [];
    for (let i = 0; i < 8; i++) {
      const r = work(e, 1, 'forage');
      e = r.exploration;
      found.push(r.found);
    }
    expect(level(e, 1, 'forage')).toBe(3);
    expect(found.filter(Boolean)).toEqual(['forage']); // exactly one find
    expect(hasFind(e, 1, 'forage')).toBe(true);
    // Other domains only ever get to "suspected" from spillover.
    expect(level(e, 1, 'stone')).toBe(1);
    expect(e.known[1].stone).toBeLessThanOrEqual(1);

    // Working an unexplored ring explores it: four trips scout the far ring's overview.
    let far = createExploration();
    for (let i = 0; i < 4; i++) far = work(far, 2, 'timber').exploration;
    expect(scouted(far, 2)).toBe(true);
    expect(level(far, 2, 'routes')).toBe(1);
    expect(level(far, 2, 'timber')).toBe(1); // 4 × 0.35
  });

  // 3. A drawn-down supply lowers yields to a floor (#1304); outer rings are richer but cost travel.
  it('lowers yields with supply and rewards pushing outward', () => {
    let e = survey(scout(createExploration(), 1), 1); // forage observed
    expect(tripYield(e, 1, 'forage', 3, 2)).toBe(5); // base 3 + 2 per level above suspected

    // Six trips' worth drawn down (set directly: working the land would also teach it, raising the base).
    e = { ...e, supply: { ...e.supply, 1: { ...e.supply[1], forage: 1 - 6 * SUPPLY_DRAW.forage } } };
    expect(supplyFactor(e, 1, 'forage')).toBeCloseTo(1 - 6 * SUPPLY_DRAW.forage);
    expect(tripYield(e, 1, 'forage', 3, 2)).toBe(Math.round(5 * (1 - 6 * SUPPLY_DRAW.forage)));
    expect(tripYield(e, 1, 'forage', 3, 2)).toBeLessThan(5);
    e = { ...e, supply: { ...e.supply, 1: { ...e.supply[1], forage: 0.05 } } };
    expect(supplyFactor(e, 1, 'forage')).toBe(SUPPLY_FLOOR);

    // Unknown land yields half; outer rings scale up.
    const fresh = createExploration();
    expect(tripYield(fresh, 1, 'forage', 4, 1)).toBe(2);
    const far = survey(scout(fresh, 2), 2);
    expect(tripYield(far, 2, 'forage', 4, 1)).toBe(Math.round(5 * RICHNESS[2]));
    expect(TRAVEL_HOURS[1]).toBe(0);
    expect(TRAVEL_HOURS[3]).toBeGreaterThan(TRAVEL_HOURS[2]);

    // Reach: the distant ring opens once the far ring is known.
    expect(reachable(fresh, 3)).toBe(false);
    expect(reachable(scout(fresh, 2), 3)).toBe(true);
  });
});
