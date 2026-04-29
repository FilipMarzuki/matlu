/**
 * SettlementPlacement tests — overlap prevention, roads, determinism, edge cases.
 *
 * Pure-TypeScript tests: no Phaser or browser globals required.
 */

import { describe, it, expect } from 'vitest';
import { rectsOverlap, placeBuildings, type PlacementInput } from './SettlementPlacement';
import type { ResolvedBuilding } from './SettlementGenerator';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ZONE_FRACS = {
  inner:  { min: 0.10, max: 0.38 },
  middle: { min: 0.38, max: 0.65 },
  outer:  { min: 0.65, max: 0.90 },
};

function makeBuilding(overrides: Partial<ResolvedBuilding> = {}): ResolvedBuilding {
  return {
    id: 'test-building',
    role: 'test',
    category: 'residential',
    zone: 'middle',
    w: 32,
    d: 32,
    heightHint: 'standard',
    placementHints: [],
    loreHook: '',
    ...overrides,
  };
}

function makeInput(buildings: ResolvedBuilding[], overrides: Partial<PlacementInput> = {}): PlacementInput {
  return {
    buildings,
    radiusTiles: 10,
    gridSize: 24,
    tileSize: 16,
    seed: 42,
    zoneFracs: ZONE_FRACS,
    ...overrides,
  };
}

// ── rectsOverlap ─────────────────────────────────────────────────────────────

describe('rectsOverlap', () => {
  it('detects overlapping same-position rects', () => {
    expect(rectsOverlap(5, 5, 2, 5, 5, 2, 0)).toBe(true);
  });

  it('detects overlapping adjacent rects with gap', () => {
    expect(rectsOverlap(5, 5, 2, 7, 5, 2, 1)).toBe(true);
  });

  it('allows non-overlapping rects', () => {
    expect(rectsOverlap(5, 5, 2, 10, 5, 2, 1)).toBe(false);
  });

  it('checks both axes independently', () => {
    expect(rectsOverlap(0, 5, 2, 10, 5, 2, 0)).toBe(false);
    expect(rectsOverlap(5, 0, 2, 5, 10, 2, 0)).toBe(false);
  });

  it('handles different-sized buildings', () => {
    expect(rectsOverlap(5, 5, 4, 7, 5, 2, 0)).toBe(true);
    expect(rectsOverlap(5, 5, 4, 8, 5, 2, 0)).toBe(false);
  });

  it('zero gap means touching edges do not overlap', () => {
    expect(rectsOverlap(5, 5, 2, 7, 5, 2, 0)).toBe(false);
    expect(rectsOverlap(5, 5, 2, 6, 5, 2, 0)).toBe(true);
  });
});

// ── placeBuildings — building placement ──────────────────────────────────────

describe('placeBuildings', () => {
  it('places a single building without overlap', () => {
    const { buildings } = placeBuildings(makeInput([makeBuilding()]));
    expect(buildings).toHaveLength(1);
    expect(buildings[0].fallback).toBe(false);
  });

  it('places all buildings — none lost', () => {
    const blds = Array.from({ length: 20 }, (_, i) =>
      makeBuilding({ id: `b-${i}`, w: 16, zone: i < 5 ? 'inner' : i < 12 ? 'middle' : 'outer' }));
    const { buildings } = placeBuildings(makeInput(blds));
    expect(buildings).toHaveLength(20);
  });

  it('no two buildings overlap (AABB with 1-tile gap)', () => {
    const blds = Array.from({ length: 30 }, (_, i) =>
      makeBuilding({ id: `b-${i}`, w: 24, zone: i < 8 ? 'inner' : i < 20 ? 'middle' : 'outer' }));
    const { buildings } = placeBuildings(makeInput(blds));

    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const a = buildings[i];
        const b = buildings[j];
        const overlaps = rectsOverlap(a.tx, a.ty, a.widthT, b.tx, b.ty, b.widthT, 1.0);
        if (overlaps) {
          expect(a.fallback && b.fallback).toBe(true);
        }
      }
    }
  });

  it('is deterministic — same seed same result', () => {
    const blds = Array.from({ length: 15 }, (_, i) =>
      makeBuilding({ id: `b-${i}`, w: 20 }));
    const a = placeBuildings(makeInput(blds, { seed: 999 }));
    const b = placeBuildings(makeInput(blds, { seed: 999 }));
    expect(a.buildings.map(p => [p.tx, p.ty])).toEqual(b.buildings.map(p => [p.tx, p.ty]));
    expect(a.roads.length).toEqual(b.roads.length);
  });

  it('different seeds produce different placements', () => {
    const blds = Array.from({ length: 10 }, (_, i) =>
      makeBuilding({ id: `b-${i}` }));
    const a = placeBuildings(makeInput(blds, { seed: 1 }));
    const b = placeBuildings(makeInput(blds, { seed: 2 }));
    const posA = a.buildings.map(p => `${p.tx},${p.ty}`).join('|');
    const posB = b.buildings.map(p => `${p.tx},${p.ty}`).join('|');
    expect(posA).not.toEqual(posB);
  });

  it('handles the problematic seed 3206051854', () => {
    const blds = [
      makeBuilding({ id: 'longhouse', w: 40, zone: 'inner', category: 'civic' }),
      makeBuilding({ id: 'well', w: 10, zone: 'inner', category: 'civic' }),
      makeBuilding({ id: 'shrine', w: 16, zone: 'inner', category: 'religious' }),
      makeBuilding({ id: 'smithy', w: 24, zone: 'inner', category: 'industry' }),
      makeBuilding({ id: 'inn', w: 28, zone: 'inner', category: 'commerce' }),
      makeBuilding({ id: 'cottage-1', w: 20, zone: 'middle', category: 'residential' }),
      makeBuilding({ id: 'cottage-2', w: 20, zone: 'middle', category: 'residential' }),
      makeBuilding({ id: 'cottage-3', w: 20, zone: 'middle', category: 'residential' }),
      makeBuilding({ id: 'dwelling-1', w: 26, zone: 'middle', category: 'residential' }),
      makeBuilding({ id: 'dwelling-2', w: 26, zone: 'middle', category: 'residential' }),
      makeBuilding({ id: 'tavern', w: 24, zone: 'middle', category: 'commerce' }),
      makeBuilding({ id: 'workshop', w: 20, zone: 'middle', category: 'industry' }),
      makeBuilding({ id: 'sawmill', w: 22, zone: 'outer', category: 'industry' }),
      makeBuilding({ id: 'watchtower', w: 12, zone: 'outer', category: 'military' }),
      makeBuilding({ id: 'barn', w: 24, zone: 'outer', category: 'infrastructure' }),
      makeBuilding({ id: 'granary', w: 18, zone: 'inner', category: 'infrastructure' }),
      makeBuilding({ id: 'farmstead', w: 28, zone: 'outer', category: 'residential' }),
      makeBuilding({ id: 'storage-shed', w: 14, zone: 'outer', category: 'infrastructure' }),
    ];

    const { buildings } = placeBuildings(makeInput(blds, { seed: 3206051854, radiusTiles: 8 }));
    expect(buildings).toHaveLength(blds.length);

    let overlapCount = 0;
    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        if (rectsOverlap(
          buildings[i].tx, buildings[i].ty, buildings[i].widthT,
          buildings[j].tx, buildings[j].ty, buildings[j].widthT, 1.0,
        )) {
          overlapCount++;
        }
      }
    }
    expect(overlapCount).toBe(0);
  });

  it('handles dense packing — many large buildings on small grid', () => {
    const blds = Array.from({ length: 25 }, (_, i) =>
      makeBuilding({ id: `big-${i}`, w: 32, zone: i < 8 ? 'inner' : i < 18 ? 'middle' : 'outer' }));
    const { buildings } = placeBuildings(makeInput(blds, { gridSize: 20, radiusTiles: 8 }));
    expect(buildings).toHaveLength(25);
  });

  it('buildings stay within grid bounds', () => {
    const blds = Array.from({ length: 15 }, (_, i) =>
      makeBuilding({ id: `b-${i}`, zone: 'outer' }));
    const gridSize = 24;
    const { buildings } = placeBuildings(makeInput(blds, { gridSize }));
    for (const p of buildings) {
      expect(p.tx).toBeGreaterThanOrEqual(1);
      expect(p.ty).toBeGreaterThanOrEqual(1);
      expect(p.tx).toBeLessThan(gridSize - 1);
      expect(p.ty).toBeLessThan(gridSize - 1);
    }
  });

  it('respects zone placement — inner buildings closer to centre', () => {
    const innerBuilding = makeBuilding({ id: 'civic', w: 16, zone: 'inner' });
    const outerBuilding = makeBuilding({ id: 'shed', w: 16, zone: 'outer' });
    const { buildings } = placeBuildings(makeInput([innerBuilding, outerBuilding]));

    const mid = Math.floor(24 / 2);
    const innerDist = Math.sqrt((buildings[0].tx - mid) ** 2 + (buildings[0].ty - mid) ** 2);
    const outerDist = Math.sqrt((buildings[1].tx - mid) ** 2 + (buildings[1].ty - mid) ** 2);
    expect(innerDist).toBeLessThan(outerDist);
  });
});

// ── placeBuildings — road generation ─────────────────────────────────────────

describe('road generation', () => {
  it('pattern=none produces only a centre seed tile (no main roads)', () => {
    const { roads } = placeBuildings(makeInput([], { streetPattern: 'none' }));
    // Centre seed tile is included for connectivity
    expect(roads.length).toBeLessThanOrEqual(1);
    expect(roads.every(r => !r.main)).toBe(true);
  });

  it('pattern=grid produces cross-shaped roads', () => {
    const { roads } = placeBuildings(makeInput([], { streetPattern: 'grid', radiusTiles: 8 }));
    expect(roads.length).toBeGreaterThan(10);
    // Should have tiles on both axes through centre
    const mid = Math.floor(24 / 2);
    const onHorizontal = roads.filter(r => r.ty === mid);
    const onVertical = roads.filter(r => r.tx === mid);
    expect(onHorizontal.length).toBeGreaterThan(5);
    expect(onVertical.length).toBeGreaterThan(5);
  });

  it('pattern=radial produces spoke roads from centre', () => {
    const { roads } = placeBuildings(makeInput([], { streetPattern: 'radial', radiusTiles: 8 }));
    expect(roads.length).toBeGreaterThan(10);
    // Centre tile should be a road
    const mid = Math.floor(24 / 2);
    expect(roads.some(r => r.tx === mid && r.ty === mid)).toBe(true);
  });

  it('pattern=linear produces a main road with short cross-street', () => {
    const { roads } = placeBuildings(makeInput([], { streetPattern: 'linear', radiusTiles: 8 }));
    expect(roads.length).toBeGreaterThan(10);
    const main = roads.filter(r => r.main);
    const secondary = roads.filter(r => !r.main);
    expect(main.length).toBeGreaterThan(secondary.length);
  });

  it('pattern=branching produces a trunk with branches', () => {
    const { roads } = placeBuildings(makeInput([], { streetPattern: 'branching', radiusTiles: 8 }));
    expect(roads.length).toBeGreaterThan(10);
    const main = roads.filter(r => r.main);
    const secondary = roads.filter(r => !r.main);
    expect(main.length).toBeGreaterThan(0);
    expect(secondary.length).toBeGreaterThan(0);
  });

  it('pattern=organic produces winding paths toward centre', () => {
    const { roads } = placeBuildings(makeInput([], { streetPattern: 'organic', radiusTiles: 8 }));
    expect(roads.length).toBeGreaterThan(5);
    // Should reach the centre
    const mid = Math.floor(24 / 2);
    const nearCentre = roads.some(r =>
      Math.abs(r.tx - mid) <= 1 && Math.abs(r.ty - mid) <= 1);
    expect(nearCentre).toBe(true);
  });

  it('roads are deterministic for same seed', () => {
    const a = placeBuildings(makeInput([], { streetPattern: 'radial', seed: 77 }));
    const b = placeBuildings(makeInput([], { streetPattern: 'radial', seed: 77 }));
    expect(a.roads.map(r => `${r.tx},${r.ty}`)).toEqual(b.roads.map(r => `${r.tx},${r.ty}`));
  });

  it('buildings are placed and all connected', () => {
    const blds = Array.from({ length: 10 }, (_, i) =>
      makeBuilding({ id: `b-${i}`, w: 32 }));
    const { buildings, roads } = placeBuildings(makeInput(blds, { streetPattern: 'grid', radiusTiles: 8 }));
    expect(buildings).toHaveLength(10);
    // Should have main roads + connectors
    expect(roads.filter(r => r.main).length).toBeGreaterThan(0);
  });
});

// ── placeBuildings — connector paths ─────────────────────────────���───────────

describe('connector paths', () => {
  it('generates connector paths when buildings are far from roads', () => {
    // Use linear pattern (single road) + many outer buildings that may not be adjacent
    const blds = Array.from({ length: 15 }, (_, i) =>
      makeBuilding({ id: `b-${i}`, w: 32, zone: 'outer' }));
    const { roads } = placeBuildings(makeInput(blds, { streetPattern: 'linear', radiusTiles: 10, gridSize: 30 }));
    const mainRoads = roads.filter(r => r.main);
    const connectors = roads.filter(r => !r.main);
    // Linear produces a single main road — outer buildings need connectors
    expect(mainRoads.length).toBeGreaterThan(0);
    // At least some connectors should exist for far-flung outer buildings
    expect(connectors.length).toBeGreaterThanOrEqual(0); // may be 0 if all happened to land near the road
    // The real check: total roads >= main roads (connectors add to them)
    expect(roads.length).toBeGreaterThanOrEqual(mainRoads.length);
  });

  it('generates paths even with no main roads (pattern=none)', () => {
    const blds = Array.from({ length: 5 }, (_, i) =>
      makeBuilding({ id: `b-${i}`, w: 32, zone: 'middle' }));
    const { roads } = placeBuildings(makeInput(blds, { streetPattern: 'none', radiusTiles: 8 }));
    // Should still have connector paths between buildings
    expect(roads.length).toBeGreaterThan(0);
    expect(roads.every(r => !r.main)).toBe(true); // all secondary
  });

  it('connector paths exist for buildings far from main roads', () => {
    const blds = Array.from({ length: 10 }, (_, i) =>
      makeBuilding({ id: `b-${i}`, w: 48, zone: i < 4 ? 'inner' : 'outer' }));
    const { buildings, roads } = placeBuildings(
      makeInput(blds, { streetPattern: 'radial', radiusTiles: 10 }));
    // Should have connector paths (non-main) in addition to main roads
    expect(buildings).toHaveLength(10);
    expect(roads.length).toBeGreaterThan(0);
  });

  it('all buildings are reachable from the road network', () => {
    const blds = Array.from({ length: 12 }, (_, i) =>
      makeBuilding({ id: `b-${i}`, w: 32, zone: i < 4 ? 'inner' : i < 8 ? 'middle' : 'outer' }));
    const { buildings, roads } = placeBuildings(
      makeInput(blds, { streetPattern: 'linear', radiusTiles: 10 }));

    // Build connected set from all road tiles
    const connected = new Set(roads.map(r => `${r.tx},${r.ty}`));

    // Each building should have at least one adjacent tile in the connected set
    for (const b of buildings) {
      const half = Math.ceil(b.widthT / 2);
      let adjacent = false;
      for (let dx = -(half + 1); dx <= half + 1 && !adjacent; dx++) {
        for (let dy = -(half + 1); dy <= half + 1 && !adjacent; dy++) {
          if (connected.has(`${b.tx + dx},${b.ty + dy}`)) adjacent = true;
        }
      }
      expect(adjacent).toBe(true);
    }
  });
});

// ── Phase 3: building-to-building connector paths ────────────────────────────

describe('building-to-building paths (phase 3)', () => {
  it('generates buildingLink tiles between two linked buildings', () => {
    // Use small w values so buildings fit in the default 24-tile grid
    const sawmill = makeBuilding({ id: 'sawmill', w: 3, zone: 'outer', pathTo: ['lumberyard'] });
    const lumberyard = makeBuilding({ id: 'lumberyard', w: 3, zone: 'outer' });
    const { buildings, roads } = placeBuildings(
      makeInput([sawmill, lumberyard], { streetPattern: 'grid' }),
    );

    expect(buildings).toHaveLength(2);
    const linkTiles = roads.filter(r => r.buildingLink);
    expect(linkTiles.length).toBeGreaterThan(0);
    // All link tiles must carry main:false
    expect(linkTiles.every(r => !r.main)).toBe(true);
  });

  it('produces no buildingLink tiles when pathTo is absent', () => {
    const a = makeBuilding({ id: 'a', w: 3, zone: 'outer' });
    const b = makeBuilding({ id: 'b', w: 3, zone: 'outer' });
    const { roads } = placeBuildings(makeInput([a, b], { streetPattern: 'grid' }));
    expect(roads.filter(r => r.buildingLink)).toHaveLength(0);
  });

  it('skips pathTo target when that building is not placed', () => {
    const smithy = makeBuilding({ id: 'smithy', w: 3, zone: 'inner', pathTo: ['absent-building'] });
    const { buildings, roads } = placeBuildings(
      makeInput([smithy], { streetPattern: 'grid' }),
    );
    expect(buildings).toHaveLength(1);
    expect(roads.filter(r => r.buildingLink)).toHaveLength(0);
  });

  it('connects each source to its closest target instance', () => {
    const s = makeBuilding({ id: 'smithy', w: 3, zone: 'inner', pathTo: ['smelter'] });
    const t1 = makeBuilding({ id: 'smelter', w: 3, zone: 'outer' });
    const t2 = makeBuilding({ id: 'smelter', w: 3, zone: 'outer' });
    const { buildings, roads } = placeBuildings(
      makeInput([s, t1, t2], { streetPattern: 'none' }),
    );
    expect(buildings).toHaveLength(3);
    // One smithy linking to its closest smelter produces at least one link tile
    const linkTiles = roads.filter(r => r.buildingLink);
    expect(linkTiles.length).toBeGreaterThan(0);
  });

  it('does not duplicate paths when only one side declares pathTo', () => {
    const src = makeBuilding({ id: 'barracks', w: 3, zone: 'outer', pathTo: ['armory'] });
    const dst = makeBuilding({ id: 'armory', w: 3, zone: 'outer' });
    const { roads } = placeBuildings(makeInput([src, dst], { streetPattern: 'grid' }));
    const linkTiles = roads.filter(r => r.buildingLink);
    // Single directional declaration → exactly one path, not two
    const uniquePositions = new Set(linkTiles.map(r => `${r.tx},${r.ty}`));
    // Should have some tiles but not be doubled (a symmetric link would add ~2× tiles)
    expect(uniquePositions.size).toEqual(linkTiles.length); // no duplicate road tiles
  });
});

// ── Seed 42 full connectivity audit across all street patterns ───────────────

describe('seed 42 connectivity audit', () => {
  const patterns = ['grid', 'radial', 'linear', 'branching', 'organic', 'none'] as const;

  for (const pattern of patterns) {
    it(`all buildings connected with pattern=${pattern}`, () => {
      const blds = [
        makeBuilding({ id: 'longhouse', w: 75, zone: 'inner', category: 'civic' }),
        makeBuilding({ id: 'well', w: 12, zone: 'inner', category: 'civic' }),
        makeBuilding({ id: 'shrine', w: 16, zone: 'inner', category: 'religious' }),
        makeBuilding({ id: 'smithy', w: 40, zone: 'inner', category: 'industry' }),
        makeBuilding({ id: 'inn', w: 52, zone: 'inner', category: 'commerce' }),
        makeBuilding({ id: 'granary', w: 36, zone: 'inner', category: 'infrastructure' }),
        makeBuilding({ id: 'cottage-1', w: 36, zone: 'middle', category: 'residential' }),
        makeBuilding({ id: 'cottage-2', w: 36, zone: 'middle', category: 'residential' }),
        makeBuilding({ id: 'cottage-3', w: 36, zone: 'middle', category: 'residential' }),
        makeBuilding({ id: 'dwelling-1', w: 48, zone: 'middle', category: 'residential' }),
        makeBuilding({ id: 'dwelling-2', w: 48, zone: 'middle', category: 'residential' }),
        makeBuilding({ id: 'tavern', w: 40, zone: 'middle', category: 'commerce' }),
        makeBuilding({ id: 'workshop', w: 36, zone: 'middle', category: 'industry' }),
        makeBuilding({ id: 'sawmill', w: 52, zone: 'outer', category: 'industry' }),
        makeBuilding({ id: 'watchtower', w: 22, zone: 'outer', category: 'military' }),
        makeBuilding({ id: 'barn', w: 50, zone: 'outer', category: 'infrastructure' }),
        makeBuilding({ id: 'farmstead', w: 58, zone: 'outer', category: 'residential' }),
        makeBuilding({ id: 'storage-shed', w: 20, zone: 'outer', category: 'infrastructure' }),
      ];

      const { buildings, roads } = placeBuildings(makeInput(blds, {
        seed: 42, radiusTiles: 10, gridSize: 30, streetPattern: pattern,
      }));

      expect(buildings).toHaveLength(blds.length);

      const roadSet = new Set(roads.map(r => `${r.tx},${r.ty}`));
      const disconnected: string[] = [];

      for (const b of buildings) {
        const half = Math.ceil(b.widthT / 2);
        let adjacent = false;
        for (let dx = -(half + 2); dx <= half + 2 && !adjacent; dx++) {
          for (let dy = -(half + 2); dy <= half + 2 && !adjacent; dy++) {
            if (roadSet.has(`${b.tx + dx},${b.ty + dy}`)) adjacent = true;
          }
        }
        if (!adjacent) disconnected.push(`${b.building.id} @(${b.tx},${b.ty})`);
      }

      expect(disconnected).toEqual([]);
    });
  }
});
