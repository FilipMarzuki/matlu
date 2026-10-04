/**
 * Acceptance tests for #1169 — per-map scale metadata on LdtkLevel.
 * One test per Given/When/Then criterion in the issue.
 */

import { describe, it, expect } from 'vitest';
import { parseLdtkLevel, emptyLdtkLevel, worldToCell, intGridGet, DEFAULT_MAP_SCALE } from './MapData';

/** Minimal raw LDtk level: one 4×2 IntGrid layer plus optional level fields. */
function rawLevel(fieldInstances: unknown[] = []) {
  return {
    identifier: 'Test',
    pxWid: 128,
    pxHei: 64,
    fieldInstances,
    layerInstances: [
      {
        __identifier: 'Collision',
        __type: 'IntGrid',
        __gridSize: 32,
        __cWid: 4,
        __cHei: 2,
        intGridCsv: [0, 1, 0, 0, 1, 1, 0, 0],
      },
    ],
  };
}

describe('MapData scale (#1169 acceptance)', () => {
  it('1. given level fieldInstances metersPerTile 2 and scaleLabel "settlement", parse yields that scale', () => {
    const level = parseLdtkLevel(rawLevel([
      { __identifier: 'metersPerTile', __value: 2 },
      { __identifier: 'scaleLabel', __value: 'settlement' },
    ]));
    expect(level.scale).toEqual({ metersPerTile: 2, label: 'settlement' });
  });

  it('2. given no scale fields, parse yields the default scale and does not throw', () => {
    const level = parseLdtkLevel(rawLevel());
    expect(level.scale).toEqual({ metersPerTile: 1, label: 'unscaled' });
    expect(level.scale).toEqual(DEFAULT_MAP_SCALE);
  });

  it('3. given emptyLdtkLevel() with no arguments, scale is the default', () => {
    expect(emptyLdtkLevel().scale).toEqual({ metersPerTile: 1, label: 'unscaled' });
  });

  it('4. given metersPerTile 1000 vs 1 on the same grid, worldToCell and intGridGet are identical — scale is metadata only', () => {
    const big = parseLdtkLevel(rawLevel([{ __identifier: 'metersPerTile', __value: 1000 }]));
    const one = parseLdtkLevel(rawLevel([{ __identifier: 'metersPerTile', __value: 1 }]));
    const a = big.intGrids.Collision;
    const b = one.intGrids.Collision;
    expect(worldToCell(a, 100, 40)).toEqual(worldToCell(b, 100, 40));
    expect(worldToCell(a, 100, 40)).toEqual({ col: 3, row: 1 });
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) {
        expect(intGridGet(a, col, row)).toBe(intGridGet(b, col, row));
      }
    }
    expect(intGridGet(a, 1, 0)).toBe(1);
  });
});
