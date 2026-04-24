import * as Phaser from 'phaser';
import {
  BtNode,
  BtSelector,
  BtSequence,
  BtCondition,
  BtAction,
  BtCooldown,
} from '../ai/BehaviorTree';
import { EarthHero } from './EarthHero';

// ── Anchor constants ──────────────────────────────────────────────────────────

/** Duration of the Anchor signature in ms. */
const ANCHOR_DURATION_MS = 6000;

/**
 * Rampart — Tier 4 Earth hero. Tank-sized heavy siege mech.
 *
 * ## Anchor (signature)
 * Locks the mech in place (velocity → 0) and doubles fire rate for 6 s by
 * halving `attackCooldownMs`. Guarded by `private anchored` so the ability
 * can't stack if triggered again while already active.
 *
 * ## Combat
 * High-damage, slow artillery shells at medium range; heavy melee as a
 * close-range fallback. Does not dash — far too heavy.
 *
 * ## Visual
 * 3× the base ENTITY_SIZE rectangle (60 px) in weathered rust-brown.
 * Real sprite to be swapped in when the Rampart Aseprite sheet is ready.
 */
export class Rampart extends EarthHero {
  readonly name = 'Rampart';
  readonly signatureCooldownMs = 9000;

  /** True while the Anchor signature is active — blocks re-activation. */
  private anchored = false;

  /**
   * Original attackCooldownMs value captured after super() runs so we can
   * restore it faithfully when Anchor expires, even if the value is odd.
   */
  private readonly baseAttackCooldown: number;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:               200,
      speed:               55,
      aggroRadius:         350,
      attackDamage:        35,
      color:               0x8b5e3c,   // weathered rust-brown placeholder
      spriteKey:           'tinkerer', // TODO: replace with 'rampart' once PixelLab sprite is assembled
      meleeRange:          48,
      attackCooldownMs:    1400,
      projectileDamage:    55,          // heavy artillery shell — punishing
      projectileSpeed:     160,         // slow but unavoidable at range
      projectileColor:     0xff6600,    // molten-orange round
      // No dash — Rampart is a siege platform, not a skirmisher.
    });

    // `attackCooldownMs` is assigned by CombatEntity's constructor (super chain),
    // so reading it here gives the correct value even though it's declared readonly.
    this.baseAttackCooldown = this.attackCooldownMs;

    // Scale the Container so the placeholder rectangle reads as tank-sized.
    // ENTITY_SIZE is 20 px; 3× = 60 px visible body.
    this.setScale(3);
  }

  // ── Signature ─────────────────────────────────────────────────────────────────

  /**
   * Anchor — slam the mech in place and unleash suppression fire.
   *
   * Sets velocity to zero and halves attackCooldownMs for ANCHOR_DURATION_MS,
   * then restores both. A pulsing blue ring renders for the duration so the
   * player can see when the mode is active.
   */
  useSignature(): void {
    if (this.anchored) return;
    this.anchored = true;

    const physBody = this.getPhysicsBody();
    physBody?.setVelocity(0, 0);

    // `attackCooldownMs` is declared readonly on CombatEntity to prevent
    // accidental mutation at call sites, but it's a plain writable property at
    // runtime. The cast through unknown lets us override it here intentionally.
    (this as unknown as { attackCooldownMs: number }).attackCooldownMs =
      Math.round(this.baseAttackCooldown / 2);

    // Blue pulsing ring signals Anchor is active to the player.
    const ring = this.scene.add.circle(this.x, this.y, 44, 0x2255ff, 0.2);
    ring.setDepth(5).setStrokeStyle(2, 0x4488ff);
    const tween = this.scene.tweens.add({
      targets: ring, alpha: 0.05, yoyo: true, repeat: -1, duration: 500,
    });

    this.scene.time.delayedCall(ANCHOR_DURATION_MS, () => {
      this.anchored = false;
      (this as unknown as { attackCooldownMs: number }).attackCooldownMs =
        this.baseAttackCooldown;
      tween.stop();
      if (ring.active) ring.destroy();
    });
  }

  // ── Frame tick ────────────────────────────────────────────────────────────────

  override updateBehaviour(delta: number): void {
    // Re-zero velocity every frame while anchored because the BT's wander /
    // moveToward branches would otherwise keep writing new velocity values.
    if (this.anchored) {
      (this.getPhysicsBody())?.setVelocity(0, 0);
    }
    super.updateBehaviour(delta);
  }

  // ── Behavior tree ─────────────────────────────────────────────────────────────

  protected buildTree(): BtNode {
    const MELEE_R       = this.meleeRange;
    const ARTILLERY_MIN = 80;
    const ARTILLERY_MAX = 300;

    return new BtSelector([

      // 1. Artillery shell at medium range.
      // BtCooldown mirrors attackCooldownMs so the BT doesn't re-fire every frame.
      new BtCooldown(
        new BtSequence([
          new BtCondition(ctx => {
            if (!ctx.opponent) return false;
            const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
            return d >= ARTILLERY_MIN && d <= ARTILLERY_MAX;
          }),
          new BtAction(ctx => {
            ctx.shootAt(ctx.opponent!.x, ctx.opponent!.y);
            return 'success';
          }),
        ]),
        1400,
      ),

      // 2. Heavy melee when adjacent.
      new BtSequence([
        new BtCondition(ctx => {
          if (!ctx.opponent) return false;
          const d = Phaser.Math.Distance.Between(ctx.x, ctx.y, ctx.opponent.x, ctx.opponent.y);
          return d < MELEE_R;
        }),
        new BtAction(ctx => {
          ctx.attack();
          ctx.stop();
          return 'success';
        }),
      ]),

      // 3. Chase — skipped while anchored so Anchor's zero-velocity holds.
      new BtSequence([
        new BtCondition(ctx => ctx.opponent !== null && !this.anchored),
        new BtAction(ctx => {
          ctx.moveToward(ctx.opponent!.x, ctx.opponent!.y);
          return 'running';
        }),
      ]),

      // 4. Wander — also skipped while anchored.
      new BtAction((ctx, d) => {
        if (!this.anchored) ctx.wander(d);
        return 'running';
      }),
    ]);
  }
}
