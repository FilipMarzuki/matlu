import type { LdtkLevel } from './MapData';

export type OverviewCell = 'ground' | 'blocked' | 'road' | 'building' | 'entrance' | 'spawn';

export interface MapOverview {
  cols: number;
  rows: number;
  cells: OverviewCell[];
}

export function overviewCells(_level: LdtkLevel): MapOverview {
  throw new Error('not implemented');
}
