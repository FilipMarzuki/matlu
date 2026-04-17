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
 *   Bonehulk     — armoured brute; rears up (invulnerable) then snaps with 3×
 *                  damage. Defined in Bonehulk.ts; extends Enemy not CombatEntity.
 *   SporeDrifter — floating spore cloud that lingers and poisons. Defined in
 *                  SporeDrifter.ts; extends CombatEntity.
 *   Thornvine    — immobile plant that grabs the nearest hero and holds them
 *                  until killed. Defined in Thornvine.ts; extends CombatEntity.
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

import { LivingEntity } from '../entities/LivingEntity';
import { Spineling, Blightfrog } from '../entities/CombatEntity';
import { PackStalker } from '../entities/PackStalker';
import { Bonehulk } from '../entities/Bonehulk';
import { SporeDrifter } from '../entities/SporeDrifter';
import { Thornvine } from '../entities/Thornvine';
import { MimicCrawler } from '../entities/MimicCrawler';
import { Venomantis } from '../entities/Venomantis';

/**
 * Constructor signature for any Spinolandet enemy — widened to LivingEntity
 * so both CombatEntity subclasses (Thornvine, SporeDrifter) and plain Enemy
 * subclasses (Bonehulk) can appear in the same wave list.
 */
type EnemyCtor = new (scene: Phaser.Scene, x: number, y: number) => LivingEntity;
type GroupSpawnFn = (scene: Phaser.Scene, cx: number, cy: number) => LivingEntity[];

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
): LivingEntity[] {
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
    // Thornvine ambush: two plants anchor the arena while Spinelings swarm.
    // Heroes must kill the Thornvines to free their grabbed allies.
    label: 'Root Trap',
    singles: [
      Thornvine, Thornvine,
      Spineling, Spineling, Spineling, Spineling,
    ],
    groups: [],
  },
  {
    // SporeDrifter cloud with Bonehulk support — poison zones force movement
    // while the Bonehulk rears and punishes fleeing heroes.
    label: 'Blight & Bone',
    singles: [
      SporeDrifter, SporeDrifter, SporeDrifter,
      Bonehulk,
    ],
    groups: [],
  },
  {
    // Ambush wave: 3 MimicCrawlers disguised among terrain props.
    // They sit still until a hero walks within 80 px, then reveal and attack.
    // The first hit deals 1.5× damage — punishes players who don't sweep AoE.
    label: 'Ambush',
    singles: [MimicCrawler, MimicCrawler, MimicCrawler],
    groups:  [],
  },
  {
    // Mixed threat: ambush crawlers + flanking pack.
    // Crawlers bait heroes into flanking positions for the PackStalker trio.
    label: 'Stalker Ambush',
    singles: [MimicCrawler, MimicCrawler],
    groups:  [spawnPackStalkerTrio],
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
  {
    // Full colony escalation: every Spinolandet type in one wave.
    // Thornvines anchor, Bonehulk punishes clusters, SporeDrifters poison retreats.
    label: 'Colony Strike',
    singles: [
      Thornvine,
      Bonehulk,
      SporeDrifter, SporeDrifter,
      Spineling, Spineling, Spineling,
    ],
    groups: [spawnPackStalkerTrio],
  },
];
