/**
 * Acceptance tests for #1170 — SettlementGenerator emits a map file.
 * One test per Given/When/Then criterion. Fixtures are hand-built
 * PlacementResults so the tests don't depend on placeBuildings' balance.
 */

import { describe, it, expect } from 'vitest';
import { emitSettlementMap, type EmitOptions } from './SettlementMapEmitter';
import { footprintSpan, type PlacedBuilding, type PlacementResult } from './SettlementPlacement';
import { parseLdtkLevel, entitiesOfType, intGridGet } from './MapData';
import type { ResolvedBuilding } from './SettlementGenerator';

function building(id: string, w: number, d = w): ResolvedBuilding {
  return { id, role: id, category: 'residential', zone: 'middle', w, d, heightHint: 'standard', placementHints: [], loreHook: '' };
}

function placed(id: string, tx: number, ty: number, w: number, d = w, extra: Partial<PlacedBuilding> = {}): PlacedBuilding {
  return { tx, ty, widthT: w, depthT: d, building: building(id, w, d), fallback: false, ...extra };
}

const OPTS: EmitOptions = { identifier: 'test-town', gridSize: 12, cellSize: 32, metersPerTile: 2, label: 'settlement' };

const ones = (values: number[]) => values.reduce((n, v) => n + (v === 1 ? 1 : 0), 0);

describe('emitSettlementMap (#1170 acceptance)', () => {
  it('1. given one 3×2 building at (4, 5) and cellSize 32, Collision has exactly the 6 footprint cells set to 1', () => {
    const result: PlacementResult = { buildings: [placed('smithy', 4, 5, 3, 2)], roads: [] };
    const level = parseLdtkLevel(emitSettlementMap(result, OPTS));
    const col = level.intGrids.Collision;
    expect(ones(col.values)).toBe(6);
    const [loX, hiX] = footprintSpan(3);
    const [loY, hiY] = footprintSpan(2);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const inside = x >= 4 + loX && x <= 4 + hiX && y >= 5 + loY && y <= 5 + hiY;
        expect(intGridGet(col, x, y), `cell ${x},${y}`).toBe(inside ? 1 : 0);
      }
    }
  });

  it('2. given the same settlement, Entities has one Building whose px bounds are the footprint × 32 and whose slug matches', () => {
    const result: PlacementResult = { buildings: [placed('smithy', 4, 5, 3, 2)], roads: [] };
    const level = parseLdtkLevel(emitSettlementMap(result, OPTS));
    const buildings = entitiesOfType(level.entityLayers.Entities, 'Building');
    expect(buildings).toHaveLength(1);
    const b = buildings[0];
    // footprintSpan(3) = [-1, 1] → x 3..5; footprintSpan(2) = [-1, 0] → y 4..5
    expect({ x: b.x, y: b.y, width: b.width, height: b.height }).toEqual({ x: 96, y: 128, width: 96, height: 64 });
    expect(b.fields.slug).toBe('smithy');
  });

  it('3. given two non-overlapping buildings, the Collision 1-count equals the sum of both footprint areas', () => {
    const result: PlacementResult = { buildings: [placed('a', 2, 2, 2, 2), placed('b', 8, 8, 3, 3)], roads: [] };
    const level = parseLdtkLevel(emitSettlementMap(result, OPTS));
    expect(ones(level.intGrids.Collision.values)).toBe(4 + 9);
  });

  it('4. given any emitted map, parseLdtkLevel accepts it and level.scale equals the opts scale', () => {
    const result: PlacementResult = { buildings: [placed('a', 5, 5, 2)], roads: [{ tx: 1, ty: 1, main: true }] };
    const level = parseLdtkLevel(emitSettlementMap(result, OPTS));
    expect(level.identifier).toBe('test-town');
    expect(level.scale).toEqual({ metersPerTile: 2, label: 'settlement' });
    expect(level.width).toBe(12 * 32);
    expect(level.height).toBe(12 * 32);
  });

  it('5. given the same result and opts, emitting twice gives deeply equal JSON', () => {
    const result: PlacementResult = {
      buildings: [placed('a', 3, 3, 2, 2, { entranceTx: 3, entranceTy: 5, entranceSide: 's' }), placed('b', 8, 8, 3)],
      roads: [{ tx: 0, ty: 6, main: true }, { tx: 1, ty: 6, main: false }],
    };
    expect(emitSettlementMap(result, OPTS)).toEqual(emitSettlementMap(result, OPTS));
  });

  it('6. given a building whose entrance is at (0, 5), Entities has one Entrance at that cell\'s pixel position', () => {
    const result: PlacementResult = { buildings: [placed('a', 2, 5, 3, 3, { entranceTx: 0, entranceTy: 5, entranceSide: 'w' })], roads: [] };
    const level = parseLdtkLevel(emitSettlementMap(result, OPTS));
    const entrances = entitiesOfType(level.entityLayers.Entities, 'Entrance');
    expect(entrances).toHaveLength(1);
    expect({ x: entrances[0].x, y: entrances[0].y }).toEqual({ x: 0, y: 160 });
    expect(entrances[0].fields.side).toBe('w');
  });
});
