import * as Phaser from 'phaser';
import { CombatEntity } from './CombatEntity';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
} from '../ai/BehaviorTree';
import { Projectile, Damageable } from './Projectile';

/**
 * Blightfrog — a ranged ambusher that fires a sticky tongue at the hero and
 * immediately leaps away after it connects.
 *
 * Attack loop:
 *   1. When in aggro range and line-of-sight, fire a bright-green tongue
 *      Projectile toward the hero on an 1800 ms cooldown.
 *   2. On hit the tongue roots the target for 2 s (zeroes velocity and
 *      bypasses its behavior tree via CombatEntity.applyRoot).
 *   3. Immediately after the tongue connects the Blightfrog leaps to a random
 *      position within 80–200 px, clamped to arena bounds.
 *
 * It has a melee fallback for when targets blunder inside its meleRange (28 px),
 * but its low HP (25) means it relies on the gap created by the root + leap.
 */
export class Blightfrog extends CombatEntity {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            25,
      speed:            55,
      aggroRadius:      350,
      attackDamage:     4,
      color:            0x336633,
      meleeRange:       28,
      attackCooldownMs: 1800,
      projectileDamage: 8,
      projectileSpeed:  220,
      projectileColor:  0x55ff88,
    });
  }

  protected buildTree(): BtNode {
    const MELEE_R = this.meleeRange;

    return new BtSelector([
      // 1. Melee fallback — only when the target stumbles into melee range.
      new BtSequence([
        new BtCondition(ctx =>
          ctx.opponent !== null &&
          Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y) < MELEE_R,
        ),
        new BtAction(ctx => { ctx.attack(); ctx.stop(); return 'success'; }),
      ]),

      // 2. Tongue shot — gated behind a cooldown. Spawns a Projectile directly
      //    (instead of ctx.shootAt) so we can attach an onHit callback that
      //    roots the target and triggers the post-shot leap.
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => ctx.opponent !== null),
          new BtAction(ctx => {
            const opp = ctx.opponent!;
            const angle = Math.atan2(opp.y - this.y, opp.x - this.x);
            const p = new Projectile(
              this.scene, this.x, this.y, angle,
              220, 8, 0x55ff88,
              // opponents is typed as CombatEntity[] but Projectile only needs
              // Damageable (x, y, isAlive, takeDamage) — the cast is safe.
              this.opponents as unknown as Damageable[],
              18, 350,
              (target) => {
                // Root the target if it supports applyRoot (i.e. is a CombatEntity).
                if (target instanceof CombatEntity) target.applyRoot(2000);
                // Leap immediately after the tongue connects.
                this.leap();
              },
            );
            this.scene.events.emit('projectile-spawned', p);
            ctx.stop(); // plant feet while shooting
            return 'success';
          }),
        ]),
        1800,
      ),

      // 3. Chase — close the gap so the tongue shot stays in range.
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 4. Wander when no target is visible.
      new BtAction((ctx, delta) => { ctx.wander(delta); return 'running'; }),
    ]);
  }

  /**
   * Leap to a random position within 80–200 px of the current location.
   * The destination is clamped to the arena's physics world bounds so the
   * Blightfrog can never escape through a wall.
   */
  private leap(): void {
    if (!this.active) return;
    const bounds = this.scene.physics.world.bounds;
    const angle  = Math.random() * Math.PI * 2;
    const dist   = Phaser.Math.Between(80, 200);
    const tx = Phaser.Math.Clamp(
      this.x + Math.cos(angle) * dist,
      bounds.left  + 20,
      bounds.right - 20,
    );
    const ty = Phaser.Math.Clamp(
      this.y + Math.sin(angle) * dist,
      bounds.top    + 20,
      bounds.bottom - 20,
    );
    this.setPosition(tx, ty);
    // Reset the physics body position to match — without this the body stays at
    // the old coordinates for one frame, causing a visible "ghost" step.
    (this.getPhysicsBody())?.reset(tx, ty);
  }
}
