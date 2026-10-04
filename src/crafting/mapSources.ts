import type { LdtkLevel } from '../world/MapData';
import type { HarvestSource } from './ActionQueue';
import type { ResourceNodeYield } from './actions';

/** Shape of a public/macro-world/resource-nodes.json entry the sim needs. */
export interface NodeTypeDef {
  id: string;
  label: string;
  yields: ResourceNodeYield[];
  respawnMs: number;
}

/** The slice of a registry item the sim reads. */
export interface ItemBiomes {
  biomes?: string[];
}

export function sourcesFromMap(_level: LdtkLevel, _nodeTypes: NodeTypeDef[], _registry: Map<string, ItemBiomes>): HarvestSource[] {
  throw new Error('not implemented');
}

export function biomesFromMap(_level: LdtkLevel): string[] {
  throw new Error('not implemented');
}
