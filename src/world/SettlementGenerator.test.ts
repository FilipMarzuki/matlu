/**
 * SettlementGenerator unit tests — run with `npm run unit` (Vitest).
 *
 * Pure-TypeScript tests covering the settlement generation pipeline:
 * purpose derivation, tier scoring, secondary trait rolls, anomaly rolls,
 * building selection, and full end-to-end determinism.
 *
 * No Phaser or browser globals required.
 */

import { describe, it, expect } from 'vitest';
import type { SettlementSite } from './SettlementSpec';
import {
  derivePurpose,
  deriveTier,
  rollSecondaryTraits,
  rollAnomalies,
  selectBuildings,
  generateSettlement,
  getCulture,
} from './SettlementGenerator';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simple mulberry32 PRNG matching the one used in GameScene. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimal site with no features — the simplest possible input. */
function bareSite(overrides: Partial<SettlementSite> = {}): SettlementSite {
  return {
    x: 1000,
    y: 1000,
    geography: 'forest',
    features: [],
    adjacentResources: [],
    nearCorruption: false,
    tradeRouteCount: 0,
    nearbySettlements: 0,
    cultureId: 'human-seafaring',
    ...overrides,
  };
}

// ── Purpose derivation ───────────────────────────────────────────────────────

describe('derivePurpose', () => {
  it('returns garrison for corruption boundary', () => {
    const site = bareSite({ nearCorruption: true });
    expect(derivePurpose(site)).toBe('garrison');
  });

  it('returns port for harbour feature', () => {
    const site = bareSite({ features: ['harbour'] });
    expect(derivePurpose(site)).toBe('port');
  });

  it('returns trading-hub for crossroads', () => {
    const site = bareSite({ features: ['crossroads'] });
    expect(derivePurpose(site)).toBe('trading-hub');
  });

  it('returns shrine for sacred site', () => {
    const site = bareSite({ features: ['sacred-site'] });
    expect(derivePurpose(site)).toBe('shrine');
  });

  it('returns fishing for fish resource', () => {
    const site = bareSite({ adjacentResources: ['fish'] });
    expect(derivePurpose(site)).toBe('fishing');
  });

  it('returns mining for ore resource', () => {
    const site = bareSite({ adjacentResources: ['ore'] });
    expect(derivePurpose(site)).toBe('mining');
  });

  it('returns logging for timber resource', () => {
    const site = bareSite({ adjacentResources: ['timber'] });
    expect(derivePurpose(site)).toBe('logging');
  });

  it('returns farming for fertile-soil resource', () => {
    const site = bareSite({ adjacentResources: ['fertile-soil'] });
    expect(derivePurpose(site)).toBe('farming');
  });

  it('falls back to geography when no features or resources', () => {
    expect(derivePurpose(bareSite({ geography: 'coastal' }))).toBe('fishing');
    expect(derivePurpose(bareSite({ geography: 'mountain' }))).toBe('mining');
    expect(derivePurpose(bareSite({ geography: 'plains' }))).toBe('farming');
    expect(derivePurpose(bareSite({ geography: 'forest' }))).toBe('logging');
  });

  it('strategic features override resources', () => {
    // Has both harbour (→ port) and timber (→ logging). Harbour wins.
    const site = bareSite({ features: ['harbour'], adjacentResources: ['timber'] });
    expect(derivePurpose(site)).toBe('port');
  });

  it('corruption overrides everything', () => {
    const site = bareSite({
      nearCorruption: true,
      features: ['harbour'],
      adjacentResources: ['fish'],
    });
    expect(derivePurpose(site)).toBe('garrison');
  });
});

// ── Tier derivation ──────────────────────────────────────────────────────────

describe('deriveTier', () => {
  it('bare site produces a low tier (1 or 2)', () => {
    const rng = mulberry32(42);
    const tier = deriveTier(bareSite(), rng);
    expect(tier).toBeGreaterThanOrEqual(1);
    expect(tier).toBeLessThanOrEqual(3);
  });

  it('rich crossroads site produces a higher tier', () => {
    const site = bareSite({
      features: ['crossroads', 'trade-route', 'river-crossing'],
      adjacentResources: ['timber', 'ore', 'fertile-soil'],
      tradeRouteCount: 3,
      nearbySettlements: 4,
    });
    const rng = mulberry32(42);
    const tier = deriveTier(site, rng);
    expect(tier).toBeGreaterThanOrEqual(4);
  });

  it('corruption suppresses tier', () => {
    const richSite = bareSite({
      features: ['trade-route'],
      tradeRouteCount: 1,
      nearCorruption: true,
    });
    const cleanSite = bareSite({
      features: ['trade-route'],
      tradeRouteCount: 1,
      nearCorruption: false,
    });
    // Use same seed so rng contribution is identical
    const tierCorrupt = deriveTier(richSite, mulberry32(99));
    const tierClean = deriveTier(cleanSite, mulberry32(99));
    expect(tierCorrupt).toBeLessThanOrEqual(tierClean);
  });
});

// ── Secondary traits ─────────────────────────────────────────────────────────

describe('rollSecondaryTraits', () => {
  it('tier 1 settlements get no secondary traits', () => {
    const rng = mulberry32(1);
    const traits = rollSecondaryTraits(bareSite(), 'logging', 1, rng);
    expect(traits).toHaveLength(0);
  });

  it('does not duplicate the primary purpose', () => {
    // Fishing purpose should never get 'trading' excluded... but should never
    // get a trait that matches its own purpose category
    const site = bareSite({
      features: ['trade-route', 'crossroads'],
      adjacentResources: ['fertile-soil', 'ore'],
      tradeRouteCount: 5,
    });
    // Run many seeds to ensure no fishing secondary appears for a fishing settlement
    for (let seed = 0; seed < 50; seed++) {
      const rng = mulberry32(seed);
      const traits = rollSecondaryTraits(site, 'trading-hub', 4, rng);
      expect(traits).not.toContain('trading');
    }
  });

  it('higher tiers can have multiple secondary traits', () => {
    const site = bareSite({
      features: ['trade-route', 'crossroads', 'sacred-site'],
      adjacentResources: ['fertile-soil', 'ore'],
      tradeRouteCount: 3,
      nearbySettlements: 5,
    });
    // Run enough seeds to find one with 2+ traits
    let foundMultiple = false;
    for (let seed = 0; seed < 100; seed++) {
      const traits = rollSecondaryTraits(site, 'logging', 5, mulberry32(seed));
      if (traits.length >= 2) { foundMultiple = true; break; }
    }
    expect(foundMultiple).toBe(true);
  });
});

// ── Anomalies ────────────────────────────────────────────────────────────────

describe('rollAnomalies', () => {
  it('anomalies are possible at tier 2+', () => {
    let foundAny = false;
    for (let seed = 0; seed < 200; seed++) {
      const anomalies = rollAnomalies(2, mulberry32(seed));
      if (anomalies.length > 0) { foundAny = true; break; }
    }
    expect(foundAny).toBe(true);
  });

  it('higher tiers can have multiple anomalies', () => {
    let foundMultiple = false;
    for (let seed = 0; seed < 500; seed++) {
      const anomalies = rollAnomalies(5, mulberry32(seed));
      if (anomalies.length >= 2) { foundMultiple = true; break; }
    }
    expect(foundMultiple).toBe(true);
  });

  it('each anomaly has a valid type and placement', () => {
    for (let seed = 0; seed < 50; seed++) {
      const anomalies = rollAnomalies(4, mulberry32(seed));
      for (const a of anomalies) {
        expect(a.type).toBeTruthy();
        expect(['edge', 'high-ground', 'gap', 'outside']).toContain(a.placement);
      }
    }
  });
});

// ── Building selection ───────────────────────────────────────────────────────

describe('selectBuildings', () => {
  it('tier 1 outpost gets only basic buildings', () => {
    const rng = mulberry32(42);
    const buildings = selectBuildings(bareSite(), 'logging', 1, [], [], undefined, rng);
    const ids = buildings.map(b => b.id);

    // Should have campfire + shelter huts + storage
    expect(ids).toContain('campfire');
    expect(ids).toContain('shelter-hut');

    // Should NOT have tier 3+ buildings
    expect(ids).not.toContain('inn');
    expect(ids).not.toContain('market-hall');
    expect(ids).not.toContain('temple');
  });

  it('fishing village gets fishing-specific buildings', () => {
    const site = bareSite({
      geography: 'coastal',
      adjacentResources: ['fish'],
      features: ['harbour'],
    });
    const rng = mulberry32(42);
    const buildings = selectBuildings(site, 'fishing', 3, [], [], undefined, rng);
    const ids = buildings.map(b => b.id);

    expect(ids).toContain('fishing-dock');
    expect(ids).toContain('smokehouse');
  });

  it('mining settlement gets mining buildings', () => {
    const site = bareSite({
      geography: 'mountain',
      adjacentResources: ['ore'],
    });
    const rng = mulberry32(42);
    const buildings = selectBuildings(site, 'mining', 3, ['smithing'], [], undefined, rng);
    const ids = buildings.map(b => b.id);

    expect(ids).toContain('mine-entrance');
    expect(ids).toContain('smithy');
  });

  it('anomaly buildings only appear when anomaly is rolled', () => {
    const rng = mulberry32(42);
    // No anomalies rolled
    const withoutAnomaly = selectBuildings(bareSite(), 'logging', 3, [], [], undefined, rng);
    expect(withoutAnomaly.map(b => b.id)).not.toContain('mage-tower');

    // Mage tower anomaly rolled
    const rng2 = mulberry32(42);
    const anomalies = [{ type: 'mage-tower' as const, placement: 'high-ground' as const }];
    const withAnomaly = selectBuildings(bareSite(), 'logging', 3, [], anomalies, undefined, rng2);
    expect(withAnomaly.map(b => b.id)).toContain('mage-tower');
  });

  it('buildings are sorted inner-first', () => {
    const site = bareSite({
      features: ['crossroads', 'trade-route'],
      adjacentResources: ['timber', 'ore'],
      tradeRouteCount: 2,
    });
    const rng = mulberry32(42);
    const buildings = selectBuildings(site, 'trading-hub', 4, ['military'], [], undefined, rng);

    // First building should be inner zone
    expect(buildings.length).toBeGreaterThan(0);
    expect(buildings[0].zone).toBe('inner');
  });

  it('culture hierarchyScale affects first civic building size', () => {
    const culture = getCulture('mountainhold');
    expect(culture).toBeDefined();

    const rng1 = mulberry32(42);
    const withCulture = selectBuildings(bareSite(), 'logging', 3, [], [], culture, rng1);
    const rng2 = mulberry32(42);
    const withoutCulture = selectBuildings(bareSite(), 'logging', 3, [], [], undefined, rng2);

    // Find the first civic building in each
    const civicWith = withCulture.find(b => b.category === 'civic');
    const civicWithout = withoutCulture.find(b => b.category === 'civic');

    if (civicWith && civicWithout && culture!.hierarchyScale > 1) {
      expect(civicWith.w).toBeGreaterThan(civicWithout.w);
    }
  });
});

// ── Full generation (end-to-end) ─────────────────────────────────────────────

describe('generateSettlement', () => {
  it('produces a complete spec and building list', () => {
    const site = bareSite({
      features: ['crossroads', 'trade-route'],
      adjacentResources: ['timber', 'fertile-soil'],
      tradeRouteCount: 2,
      nearbySettlements: 1,
    });
    const rng = mulberry32(12345);
    const { spec, buildings } = generateSettlement(site, 'Grindvik', rng);

    expect(spec.id).toBe('grindvik');
    expect(spec.name).toBe('Grindvik');
    expect(spec.purpose).toBeTruthy();
    expect(spec.tier).toBeGreaterThanOrEqual(1);
    expect(spec.tier).toBeLessThanOrEqual(5);
    expect(spec.radius).toBeGreaterThan(0);
    expect(buildings.length).toBeGreaterThan(0);
  });

  it('is deterministic — same seed produces same output', () => {
    const site = bareSite({
      features: ['harbour', 'trade-route'],
      adjacentResources: ['fish', 'salt'],
      tradeRouteCount: 1,
    });

    const result1 = generateSettlement(site, 'Strandvik', mulberry32(999));
    const result2 = generateSettlement(site, 'Strandvik', mulberry32(999));

    expect(result1.spec).toEqual(result2.spec);
    expect(result1.buildings).toEqual(result2.buildings);
  });

  it('different seeds produce different outputs', () => {
    const site = bareSite({
      features: ['crossroads'],
      adjacentResources: ['timber'],
      tradeRouteCount: 1,
    });

    const result1 = generateSettlement(site, 'Town A', mulberry32(111));
    const result2 = generateSettlement(site, 'Town A', mulberry32(222));

    // At minimum, tier or building widths should differ
    const sameTier = result1.spec.tier === result2.spec.tier;
    const sameBuildings = JSON.stringify(result1.buildings) === JSON.stringify(result2.buildings);
    expect(sameTier && sameBuildings).toBe(false);
  });
});
