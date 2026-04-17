import { Bao } from './Bao';

/**
 * HERO_ROSTER — all playable heroes, in selection order.
 * Master Fen will be added in a sibling issue.
 */
export const HERO_ROSTER = [Bao] as const;
export { TheTorrent } from './TheTorrent';
export type { TorrentConfig } from './TheTorrent';
import { MasterFen } from './MasterFen';

// TODO: Bao added in FIL-282-A
export const HERO_ROSTER = [MasterFen] as const;
export { StormSovereign } from './StormSovereign';
export type { EnemyHostScene } from './StormSovereign';
