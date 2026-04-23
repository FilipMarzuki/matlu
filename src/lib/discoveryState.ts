/**
 * Discovery state — persists which biomes and creatures the player has
 * encountered across play sessions.  Stored in a single localStorage entry.
 *
 * Biomes are tracked per world (only 'earth' is playable today; others are
 * placeholders for future worlds).  Creatures are stored as a flat set of
 * class names and filtered by world when displayed in DiscoveryScene.
 */

export type WorldId = 'earth' | 'mistheim' | 'spinolandet';

/** Canonical world order for the world selector in DiscoveryScene. */
export const WORLD_ORDER: readonly WorldId[] = ['earth', 'mistheim', 'spinolandet'];

export const WORLD_LABELS: Record<WorldId, string> = {
  earth:       'Earth',
  mistheim:    'Mistheim',
  spinolandet: 'Spinolandet',
};

const LS_KEY = 'matlu-discovery-v1';

export interface DiscoveryData {
  /** Discovered biome indices per world (key = WorldId). */
  biomesByWorld: Partial<Record<string, number[]>>;
  /**
   * Class names of creatures ever seen on screen (flat, not per-world).
   * DiscoveryScene filters by the selected world's entity-registry entries.
   */
  seenCreatureClasses: string[];
}

function empty(): DiscoveryData {
  return { biomesByWorld: {}, seenCreatureClasses: [] };
}

export function loadDiscovery(): DiscoveryData {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<DiscoveryData>;
    return {
      biomesByWorld:       parsed.biomesByWorld       ?? {},
      seenCreatureClasses: parsed.seenCreatureClasses ?? [],
    };
  } catch {
    return empty();
  }
}

export function saveDiscovery(data: DiscoveryData): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    // localStorage quota exceeded or unavailable — silently skip.
  }
}
