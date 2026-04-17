import * as Phaser from 'phaser';
import { CombatEntity } from './CombatEntity';
import { BtNode, BtAction } from '../ai/BehaviorTree';

// ── Pack Stalker — Spinolandet coordinated hunter ─────────────────────────────
//
// Wolf-analog that always spawns in threes. The pack has one FRONT unit and two
// FLANK units. The frontrunner charges directly at the player; flankers circle
// to ±90° relative to the frontrunner–player axis and hold position until the
// front engages, then close in from the sides.
//
// Pack coordination happens via two mechanisms:
//   1. ArenaBlackboard.packStalkerFrontAttacking (keyed by packId) — the front
//      sets this each frame it is in melee range; flankers gate their attack on it.
//   2. packRegistry (module-level Map) — used to look up the frontrunner's
//      world position for the ±90° calculation, and to handle role promotion when
//      the frontrunner dies.

export const enum PackRole { FRONT, FLANK }

/**
 * Module-level registry of living PackStalker members, keyed by packId.
 * Entries are added at construction and removed at death.
 * Kept module-level (not static on class) to avoid class-level statics
 * that could accumulate across scene restarts.
 */
const packRegistry = new Map<string, PackStalker[]>();

export class PackStalker extends CombatEntity {
  private readonly packId: string;
  private readonly packIndex: number; // 0 = initial front, 1 = left flank, 2 = right flank
  private role: PackRole;

  /**
   * Create one member of a PackStalker trio.
   * Use `PackStalker.spawnTrio()` to spawn all three at once so they share
   * a packId and the pack coordination system works correctly.
   */
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    packId: string,
    packIndex: number,
  ) {
    super(scene, x, y, {
      maxHp:            60,
      speed:            88,
      aggroRadius:      380,
      attackDamage:     16,
      color:            0x3a4a1c, // dark olive — Spinolandet stalker
      meleeRange:       30,
      attackCooldownMs: 900,
    });
    this.packId    = packId;
    this.packIndex = packIndex;
    this.role      = packIndex === 0 ? PackRole.FRONT : PackRole.FLANK;

    // Register in the module-level pack registry so siblings can look up this
    // unit's world position for the flanking angle calculation.
    const pack = packRegistry.get(packId) ?? [];
    pack.push(this);
    packRegistry.set(packId, pack);
  }

  /**
   * Spawn a coordinated trio: one frontrunner (index 0) and two flankers (1, 2).
   * Hard-coded group size of 3 — PackStalkers are always hunted as a pack.
   *
   * @param positions  Three world positions for front, left flank, right flank.
   */
  static spawnTrio(
    scene: Phaser.Scene,
    positions: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }],
  ): [PackStalker, PackStalker, PackStalker] {
    // Unique id per trio — timestamp + random avoids collisions when multiple
    // packs are active simultaneously.
    const id = `ps-${scene.time.now}-${Math.floor(Math.random() * 1e6)}`;
    return [
      new PackStalker(scene, positions[0].x, positions[0].y, id, 0),
      new PackStalker(scene, positions[1].x, positions[1].y, id, 1),
      new PackStalker(scene, positions[2].x, positions[2].y, id, 2),
    ];
  }

  protected override onDeath(): void {
    if (this.role === PackRole.FRONT) {
      // Promote the surviving flanker with the lowest packIndex to FRONT so the
      // pack stays coordinated. Lower index = designated "second in command".
      const pack = packRegistry.get(this.packId);
      if (pack) {
        const survivors = pack
          .filter(m => m !== (this as PackStalker) && m.isAlive)
          .sort((a, b) => a.packIndex - b.packIndex);
        if (survivors.length > 0) {
          survivors[0].role = PackRole.FRONT;
        }
      }
    }

    // Remove self from the pack registry.
    const pack = packRegistry.get(this.packId);
    if (pack) {
      const idx = pack.indexOf(this);
      if (idx !== -1) pack.splice(idx, 1);
      if (pack.length === 0) packRegistry.delete(this.packId);
    }

    super.onDeath();
  }

  protected buildTree(): BtNode {
    // These constants are captured at construction time (after super() sets meleeRange).
    const MELEE_R      = this.meleeRange; // 30 px
    // Flankers orbit to this distance from the player before the front engages.
    const ORBIT_RADIUS = 80;

    // Single BtAction that dispatches on role each tick.
    // Role can change at runtime (promotion on frontrunner death), so we read
    // `this.role` inside the closure rather than capturing it at build time.
    return new BtAction((ctx, delta) => {
      if (!ctx.opponent) {
        ctx.wander(delta);
        return 'running';
      }

      if (this.role === PackRole.FRONT) {
        // ── Frontrunner: charge directly at the player ────────────────────────
        const dist = Phaser.Math.Distance.Between(
          ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y,
        );
        if (dist < MELEE_R) {
          // Signal flankers via the blackboard — cleared each frame by tick(),
          // so this must be written every frame the front is in range.
          this.blackboard?.packStalkerFrontAttacking.set(this.packId, true);
          ctx.attack();
          ctx.stop();
        } else {
          ctx.moveToward(ctx.opponent.x, ctx.opponent.y);
        }
      } else {
        // ── Flanker: orbit to ±90°, then close in once front engages ─────────
        const frontAttacking =
          this.blackboard?.packStalkerFrontAttacking.get(this.packId) ?? false;

        if (frontAttacking) {
          // Front is in melee range — flanker charges in from the side.
          const dist = Phaser.Math.Distance.Between(
            ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y,
          );
          if (dist < MELEE_R) {
            ctx.attack();
            ctx.stop();
          } else {
            ctx.moveToward(ctx.opponent.x, ctx.opponent.y);
          }
        } else {
          // Position at ±90° relative to the frontrunner–player axis.
          // The target updates every frame as the player and front move,
          // which creates smooth dynamic flanking without explicit orbit logic.
          const pack  = packRegistry.get(this.packId);
          const front = pack?.find(m => m.role === PackRole.FRONT);

          if (front) {
            // Unit vector from frontrunner to player (the "attack axis").
            const dx  = ctx.opponent.x - front.x;
            const dy  = ctx.opponent.y - front.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const nx  = dx / len;
            const ny  = dy / len;

            // Perpendicular directions:
            //   +90° (counter-clockwise): (-ny,  nx)
            //   -90° (clockwise):         ( ny, -nx)
            // packIndex 1 → left flank (+90°), packIndex 2 → right flank (-90°).
            const sign  = this.packIndex === 1 ? 1 : -1;
            const perpX = -ny * sign;
            const perpY =  nx * sign;

            ctx.moveToward(
              ctx.opponent.x + perpX * ORBIT_RADIUS,
              ctx.opponent.y + perpY * ORBIT_RADIUS,
            );
          } else {
            // No front found (can happen briefly after simultaneous deaths) —
            // close in directly so the flanker doesn't idle.
            const dist = Phaser.Math.Distance.Between(
              ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y,
            );
            if (dist < MELEE_R) {
              ctx.attack();
              ctx.stop();
            } else {
              ctx.moveToward(ctx.opponent.x, ctx.opponent.y);
            }
          }
        }
      }

      return 'running';
    });
  }
}
