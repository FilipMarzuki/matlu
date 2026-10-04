import type { PlacementResult } from './SettlementPlacement';

export interface EmitOptions {
  identifier: string;
  gridSize: number;
  cellSize: number;
  metersPerTile: number;
  label: string;
}

export function emitSettlementMap(_result: PlacementResult, _opts: EmitOptions): unknown {
  throw new Error('not implemented');
}
