/**
 * LevelRegistry — unified index of all five levels in the FIL-143 arc.
 *
 * ## Why this file exists
 *
 * Each level's design data lives in its own file (Level1.ts – Level5.ts).
 * Those files are authoritative for zone coordinates, corruption values,
 * collectible placements, settlement positions, and meeting dialog. They
 * are also currently only consumed by GameScene, which hard-codes Level 1.
 *
 * This registry assembles all five levels into a single typed array so that
 * a future level-selection mechanism (NavScene, transition manager, or a
 * test harness) can call `getLevelConfig(n)` without importing all five
 * files individually or knowing their internal export names.
 *
 * ## How to add a new level
 *
 * 1. Create `src/world/Level6.ts` following the same pattern as the others.
 * 2. Import it below and append an entry to LEVEL_CONFIGS.
 * 3. `getLevelConfig(6)` will work automatically.
 *
 * ## Integration path (not yet implemented)
 *
 * When a level-switching mechanism lands, GameScene (or a new LevelScene)
 * should receive a `levelNumber` parameter, call `getLevelConfig(levelNumber)`,
 * and use the resulting `LevelConfig` to set up zones, collectibles, etc.
 * instead of importing Level1 constants directly.
 */

import type { LevelConfig } from './LevelTypes';

// Level data — each file owns its zone layout, collectibles, and narrative.
import * as L1 from './Level1';
import * as L2 from './Level2';
import * as L3 from './Level3';
import * as L4 from './Level4';
import * as L5 from './Level5';

/**
 * All five levels in arc order — index 0 = Level 1 (Höga Kusten Varnad),
 * index 4 = Level 5 (The Source).
 *
 * Use `getLevelConfig(n)` (1-based) rather than indexing this array directly.
 */
export const LEVEL_CONFIGS: ReadonlyArray<LevelConfig> = [
  {
    level: 1,
    // Earth dominant — familiar Swedish coast, but wrong
    name: 'Höga Kusten Varnad',
    zones: L1.ZONES,
    collectibles: L1.COLLECTIBLES,
    settlements: L1.SETTLEMENTS,
    secretPositions: L1.SECRET_POSITIONS,
    zoneBoundaryMarkers: L1.ZONE_BOUNDARY_MARKERS,
    meetingRadius: L1.MEETING_RADIUS,
    meetingPoint: L1.MEETING_POINT,
    pathChoices: L1.PATH_CHOICES,
    meetingOpeningLine: L1.meetingOpeningLine,
    passiveCleanseRate: L1.PASSIVE_CLEANSE_RATE,
    passiveCleanseCap: L1.PASSIVE_CLEANSE_CAP,
  },
  {
    level: 2,
    // Spinaria dominant — bioluminescent ruins, enormous arthropods
    name: 'The Spine Reaches',
    zones: L2.ZONES,
    collectibles: L2.COLLECTIBLES,
    settlements: L2.SETTLEMENTS,
    secretPositions: L2.SECRET_POSITIONS,
    zoneBoundaryMarkers: L2.ZONE_BOUNDARY_MARKERS,
    meetingRadius: L2.MEETING_RADIUS,
    meetingPoint: L2.MEETING_POINT,
    pathChoices: L2.PATH_CHOICES,
    meetingOpeningLine: L2.meetingOpeningLine,
    passiveCleanseRate: L2.PASSIVE_CLEANSE_RATE,
    passiveCleanseCap: L2.PASSIVE_CLEANSE_CAP,
  },
  {
    level: 3,
    // Mistheim dominant — mist valleys, bamboo highlands, panda scholars
    name: 'Mistheim Mist',
    zones: L3.ZONES,
    collectibles: L3.COLLECTIBLES,
    settlements: L3.SETTLEMENTS,
    secretPositions: L3.SECRET_POSITIONS,
    zoneBoundaryMarkers: L3.ZONE_BOUNDARY_MARKERS,
    meetingRadius: L3.MEETING_RADIUS,
    meetingPoint: L3.MEETING_POINT,
    pathChoices: L3.PATH_CHOICES,
    meetingOpeningLine: L3.meetingOpeningLine,
    passiveCleanseRate: L3.PASSIVE_CLEANSE_RATE,
    passiveCleanseCap: L3.PASSIVE_CLEANSE_CAP,
  },
  {
    level: 4,
    // Convergence — all three worlds at equal weight, physics uncertain
    name: 'The Seam',
    zones: L4.ZONES,
    collectibles: L4.COLLECTIBLES,
    settlements: L4.SETTLEMENTS,
    secretPositions: L4.SECRET_POSITIONS,
    zoneBoundaryMarkers: L4.ZONE_BOUNDARY_MARKERS,
    meetingRadius: L4.MEETING_RADIUS,
    meetingPoint: L4.MEETING_POINT,
    pathChoices: L4.PATH_CHOICES,
    meetingOpeningLine: L4.meetingOpeningLine,
    passiveCleanseRate: L4.PASSIVE_CLEANSE_RATE,
    passiveCleanseCap: L4.PASSIVE_CLEANSE_CAP,
  },
  {
    level: 5,
    // Ground zero — no birdsong, no wind, the wound itself
    name: 'The Source',
    zones: L5.ZONES,
    collectibles: L5.COLLECTIBLES,
    settlements: L5.SETTLEMENTS,
    secretPositions: L5.SECRET_POSITIONS,
    zoneBoundaryMarkers: L5.ZONE_BOUNDARY_MARKERS,
    meetingRadius: L5.MEETING_RADIUS,
    meetingPoint: L5.MEETING_POINT,
    pathChoices: L5.PATH_CHOICES,
    meetingOpeningLine: L5.meetingOpeningLine,
    passiveCleanseRate: L5.PASSIVE_CLEANSE_RATE,
    passiveCleanseCap: L5.PASSIVE_CLEANSE_CAP,
  },
];

/**
 * Returns the config for a given 1-based level number.
 *
 * Throws a descriptive error if the level is out of range, so call sites
 * get a clear message rather than a silent `undefined` dereference.
 *
 * ```ts
 * // In a future level-selection scene:
 * const cfg = getLevelConfig(this.data.get('level') as number);
 * scene.setupZones(cfg.zones);
 * scene.setupCollectibles(cfg.collectibles);
 * ```
 */
export function getLevelConfig(level: number): LevelConfig {
  const cfg = LEVEL_CONFIGS[level - 1];
  if (cfg === undefined) {
    throw new RangeError(
      `getLevelConfig: level ${level} is out of range (1–${LEVEL_CONFIGS.length})`
    );
  }
  return cfg;
}

/** Total number of levels in the arc. Useful for range checks and UI. */
export const LEVEL_COUNT = LEVEL_CONFIGS.length;
