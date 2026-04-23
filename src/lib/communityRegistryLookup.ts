import type { CommunityAttribution } from '../entities/communityAttribution';
import registry from '../entities/entity-registry.json';

/** Registry row shape — only fields needed for community credit lookup. */
interface RegistryEntityRow {
  class: string;
  /** Optional public name for UI (e.g. Swedish creature name). Falls back to `class`. */
  display_name?: string;
  source?: string;
  attribution?: CommunityAttribution | null;
}

interface RegistryFile {
  entities: RegistryEntityRow[];
}

export interface CommunityCreditMeta {
  /** Registry `class` — emitted as entityId on community-creature-spawned. */
  readonly entityId: string;
  readonly creatureSubmissionId: string;
  readonly displayName: string;
  readonly makerName?: string;
}

const raw = registry as unknown as RegistryFile;

const byClass = new Map<string, CommunityCreditMeta>();

for (const e of raw.entities) {
  if (e.source !== 'community') continue;
  const sid = e.attribution?.creature_submission_id;
  if (!sid) continue;
  const displayName = typeof e.display_name === 'string' && e.display_name.length > 0
    ? e.display_name
    : e.class;
  const meta: CommunityCreditMeta = {
    entityId: e.class,
    creatureSubmissionId: sid,
    displayName,
    makerName: e.attribution?.maker_name,
  };
  byClass.set(e.class, meta);
}

export function getCommunityCreditMeta(entityClassName: string): CommunityCreditMeta | null {
  return byClass.get(entityClassName) ?? null;
}

/** Creator line for the credit card — Anonymous when maker opted out or name absent. */
export function getCommunityCreatorLine(meta: CommunityCreditMeta): string {
  return meta.makerName ? `created by ${meta.makerName}` : 'created by Anonymous';
}
