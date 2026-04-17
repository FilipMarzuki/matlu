import { Bao } from './Bao';
import { MasterFen } from './MasterFen';

export { TheTorrent } from './TheTorrent';
export type { TorrentConfig } from './TheTorrent';
export { StormSovereign } from './StormSovereign';
export type { EnemyHostScene } from './StormSovereign';
export { TheLivingSea } from './TheLivingSea';
export type { AbilityTag } from './TheLivingSea';

/** HERO_ROSTER — all playable heroes, in selection order. */
export const HERO_ROSTER = [Bao, MasterFen] as const;
