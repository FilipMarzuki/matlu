/**
 * Spinolandet wave definitions — Level 3 (Mistheim Mist, zone-delta).
 *
 * Spinolandet is the colony-world faction whose creatures have begun crossing
 * into Mistheim's lower river delta (zone-delta in Level3.ts). Three creature
 * types represent different threat profiles within the invading force:
 *
 *   Spineling    — fragile fast swarmer; arrives in 20-unit groups that
 *                  overwhelm by sheer number before the player can react.
 *   Blightfrog   — corruption-touched amphibian; toxic spit from mid-range,
 *                  flees when cornered. Controls space rather than rushing.
 *   PackStalker  — coordinated wolf-analog; always three per pack. The front
 *                  runner charges while flankers circle to ±90° and close in
 *                  once the front engages. Defined in PackStalker.ts.
 *
 * Wave format
 * -----------
 * Each SpinelandetWave has two spawn lists:
 *   `singles` — standard enemies, one per EnemyCtor entry.
 *   `groups`  — factory functions that produce a set of coordinated enemies
 *               from a single center point (used for PackStalker trios).
 *
 * A scene consuming these waves should:
 *   1. Call each `singles[i](scene, x, y)` with a spread spawn position.
 *   2. Call each `groups[i](scene, cx, cy)` with a center spawn position;
 *      the function handles internal position offsets for the group.
 */

import { CombatEntity } from '../entities/CombatEntity';
import { Spineling, Blightfrog } from '../entities/CombatEntity';
import { PackStalker } from '../entities/PackStalker';
import { Venomantis } from '../entities/Venomantis';

type EnemyCtor = new (scene: Phaser.Scene, x: number, y: number) => CombatEntity;
type GroupSpawnFn = (scene: Phaser.Scene, cx: number, cy: number) => CombatEntity[];

export interface SpinelandetWave {
  label: string;
  /** Standard single-constructor enemies — spawned one per entry. */
  singles: EnemyCtor[];
  /**
   * Group spawn functions — each produces a coordinated set of enemies
   * from a single center coordinate. The function handles internal offsets.
   */
  groups: GroupSpawnFn[];
}

/**
 * Spawn a coordinated PackStalker trio centered at (cx, cy).
 * Hard-coded group size of 3 — the acceptance criterion requires this to be
 * explicit in the spawn definition.
 *
 * The three units are spread slightly so physics bodies don't overlap at spawn:
 *   index 0 (frontrunner)  — center-left
 *   index 1 (left flank)   — upper-center
 *   index 2 (right flank)  — center-right
 */
export function spawnPackStalkerTrio(
  scene: Phaser.Scene,
  cx: number,
  cy: number,
): CombatEntity[] {
  const spread = 24; // px — just enough to separate physics bodies
  return PackStalker.spawnTrio(scene, [
    { x: cx - spread, y: cy          }, // frontrunner
    { x: cx,          y: cy - spread }, // left flank
    { x: cx + spread, y: cy          }, // right flank
  ]);
}

/**
 * Spinolandet wave roster for Level 3 zone-delta.
 *
 * Waves cycle from pure-swarm through mixed encounters to pack hunts.
 * A scene may loop these indefinitely, scaling HP/damage with wave number.
 */
export const SPINOLANDET_WAVES: SpinelandetWave[] = [
  {
    // 20 Spinelings — first contact. Numbers are the only threat.
    label: 'Spine Swarm',
    singles: new Array<EnemyCtor>(20).fill(Spineling),
    groups:  [],
  },
  {
    // Blightfrogs hold range while Spinelings close in — mixed pressure.
    label: 'Blight Advance',
    singles: [
      Blightfrog, Blightfrog, Blightfrog,
      Spineling, Spineling, Spineling, Spineling,
    ],
    groups: [],
  },
  {
    // PackStalker trio hunts with a handful of Spinelings as distraction.
    label: 'Pack Hunt',
    singles: [Spineling, Spineling, Spineling],
    groups:  [spawnPackStalkerTrio], // PackStalker ×3 (hard-coded trio)
  },
  {
    // Full Spinolandet assault: swarm + ranged + coordinated pack.
    label: 'Full Assault',
    singles: [
      Spineling, Spineling, Spineling, Spineling, Spineling,
      Blightfrog, Blightfrog,
    ],
    groups: [spawnPackStalkerTrio], // PackStalker ×3 (hard-coded trio)
  },
  {
    // Venomantis introduction: two mantises flank while Spinelings distract.
    // Players learn to watch their backs — the mantis vanishes and reappears
    // behind them every 5 s after a 2 s invisible window.
    label: 'Shadow Strike',
    singles: [
      Venomantis, Venomantis,
      Spineling, Spineling, Spineling,
    ],
    groups: [],
  },
  {
    // Heavy flanking pressure: Venomantis teleport-flanks while Blightfrogs
    // hold range and PackStalkers close from the front.
    label: 'Flank & Poison',
    singles: [
      Venomantis,
      Blightfrog, Blightfrog,
    ],
    groups: [spawnPackStalkerTrio],
  },
];
