/**
 * Acceptance tests for #1177 — top-down map overview (pure part).
 * One test per Given/When/Then criterion. Levels are built from
 * emptyLdtkLevel() plus hand-filled layers; criterion 6 reads the committed
 * settlement-demo.json.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { overviewCells, type OverviewCell } from './MapOverview';
import { emptyLdtkLevel, parseLdtkLevel, type LdtkLevel, type LdtkEntity } from './MapData';

const CELL = 32;

function level(cols: number, rows: number): LdtkLevel {
  return emptyLdtkLevel(cols * CELL, rows * CELL, CELL);
}

function set(l: LdtkLevel, layer: string, x: number, y: number, v: number): void {
  const g = l.intGrids[layer];
  g.values[y * g.cols + x] = v;
}

function entity(identifier: string, x: number, y: number, width = CELL, height = CELL): LdtkEntity {
  return { identifier, iid: `${identifier}-${x}-${y}`, x, y, width, height, fields: {} };
}

const at = (o: { cols: number; cells: OverviewCell[] }, x: number, y: number) => o.cells[y * o.cols + x];

describe('overviewCells (#1177 acceptance)', () => {
  it('1. given a 4×3 level with nothing in it, cols 4, rows 3 and all 12 cells are ground', () => {
    const o = overviewCells(level(4, 3));
    expect(o.cols).toBe(4);
    expect(o.rows).toBe(3);
    expect(o.cells).toHaveLength(12);
    expect(o.cells.every(c => c === 'ground')).toBe(true);
  });

  it('2. given Collision 1 at (1,1) with no building over it, that cell is blocked and the rest ground', () => {
    const l = level(4, 3);
    set(l, 'Collision', 1, 1, 1);
    const o = overviewCells(l);
    expect(at(o, 1, 1)).toBe('blocked');
    expect(o.cells.filter(c => c !== 'ground')).toHaveLength(1);
  });

  it('3. given a Building entity at px (32,32) sized 64×32, cells (1,1) and (2,1) are building and (3,1) is not', () => {
    const l = level(4, 3);
    l.entityLayers.Entities.entities.push(entity('Building', 32, 32, 64, 32));
    const o = overviewCells(l);
    expect(at(o, 1, 1)).toBe('building');
    expect(at(o, 2, 1)).toBe('building');
    expect(at(o, 3, 1)).not.toBe('building');
  });

  it('4. given PathSegments 4 and Collision 1 at (0,2) with no building, that cell is road — road wins over blocked', () => {
    const l = level(4, 3);
    set(l, 'PathSegments', 0, 2, 4);
    set(l, 'Collision', 0, 2, 1);
    expect(at(overviewCells(l), 0, 2)).toBe('road');
  });

  it('5. given an Entrance at px (64,0) under a Building covering the same cell, cell (2,0) is entrance — entrance wins over building', () => {
    const l = level(4, 3);
    l.entityLayers.Entities.entities.push(entity('Building', 32, 0, 96, 32));
    l.entityLayers.Entities.entities.push(entity('Entrance', 64, 0));
    expect(at(overviewCells(l), 2, 0)).toBe('entrance');
  });

  it('6. given the committed settlement-demo.json, 26×26, building cells == Collision 1s, exactly one spawn', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, '..', '..', 'public', 'assets', 'maps', 'settlement-demo.json'), 'utf8'));
    const l = parseLdtkLevel(raw);
    const o = overviewCells(l);
    expect(o.cols).toBe(26);
    expect(o.rows).toBe(26);
    const collisionOnes = l.intGrids.Collision.values.filter(v => v === 1).length;
    // Entrances sit outside footprints, so they don't steal building cells.
    expect(o.cells.filter(c => c === 'building').length).toBe(collisionOnes);
    expect(o.cells.filter(c => c === 'spawn')).toHaveLength(1);
  });
});
