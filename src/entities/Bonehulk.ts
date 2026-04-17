import * as Phaser from 'phaser';
import { Enemy } from './Enemy';
import { LivingEntity } from './LivingEntity';

// ── Timing constants ────────────────────────────────────────────────────────

/** ms the Bonehulk spends in normal (carapace) state before rearing. */
const REAR_COOLDOWN_MS = 4000;

/** ms the underside is exposed (damage window for heroes). */
const REAR_DURATION_MS = 1200;

/** px — melee reach for the snap attack at the end of the rear window. */
const MELEE_RANGE = 48;

// ── Visual constants ────────────────────────────────────────────────────────

/** Dark mahogany — carapace in normal state. */
const COLOR_CARAPACE  = 0x5c3a1e;
/** Pale tan — exposed underside during vulnerability window. */
const COLOR_UNDERSIDE = 0xd4a880;

// ── Player locator ──────────────────────────────────────────────────────────

let _getPlayerPos: () => { x: number; y: number } | null = () => null;
let _getPlayer: () => LivingEntity | null = () => null;

/**
 * Bonehulk — slow, near-immune beetle with a timed vulnerability window.
 *
 * ## Mechanics
 *
 * Alternates between two states driven by a timer accumulated in
 * `updateBehaviour(delta)`:
 *
 * **Normal (carapace):** `damageReduction = 0.15` — only 15% of incoming
 * damage reaches HP. Drifts slowly toward the player but does not attack.
 *
 * **Rear (underside exposed):** `damageReduction = 1`, `damageMultiplier = 3`
 * — full damage, amplified 3×. The Bonehulk stops and turns pale. After
 * REAR_DURATION_MS the snap attack fires against any hero in melee range,
 * then the cycle resets to normal.
 *
 * The attack fires at the *end* of the rear window so heroes have the full
 * 1.2 s to deal damage before the snap lands.
 *
 * ## damageReduction semantics
 *
 * `actual = incoming × damageReduction × damageMultiplier`
 *
 * 0.15 → 85% damage reduction (near-immune).
 * 1.0  → no reduction, combined with damageMultiplier = 3 → triple damage.
 */
export class Bonehulk extends Enemy {
  /** Accumulates delta in both states; resets on each state transition. */
  private rearTimer  = 0;
  private rearActive = false;

  /** Ellipse that visually represents the carapace / underside. */
  private readonly carapace: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:        220,
      speed:        28,          // deliberately slow — threat is the rear window
      aggroRadius:  300,
      attackDamage: 35,
    });

    // Large ellipse — beetle-ish proportions, wider than tall
    this.carapace = scene.add.ellipse(0, 0, 32, 24, COLOR_CARAPACE);
    this.add(this.carapace);

    // Start in near-immune carapace state
    this.damageReduction  = 0.15;
    this.damageMultiplier = 1;
  }

  // ── Static API ─────────────────────────────────────────────────────────────

  /**
   * Register callbacks so every Bonehulk can locate the player without
   * importing the scene. Call once before spawning any Bonehulk instance.
   *
   * @param posFn   Returns {x, y} of the current player, or null if unavailable.
   * @param entityFn Returns the player LivingEntity for damage calls, or null.
   */
  static setPlayerGetter(
    posFn:    () => { x: number; y: number } | null,
    entityFn: () => LivingEntity | null,
  ): void {
    _getPlayerPos = posFn;
    _getPlayer    = entityFn;
  }

  // ── Behaviour ──────────────────────────────────────────────────────────────

  protected override updateBehaviour(delta: number): void {
    // `this.body` is the Arcade physics body added by the scene via
    // physics.add.existing(). Cast to the concrete body type for velocity calls.
    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;

    this.rearTimer += delta;

    if (!this.rearActive) {
      this.tickNormal(physBody);
    } else {
      this.tickRear(physBody);
    }
  }

  // ── Normal state ───────────────────────────────────────────────────────────

  private tickNormal(physBody: Phaser.Physics.Arcade.Body | undefined): void {
    // Drift slowly toward the player
    const pos = _getPlayerPos();
    if (pos && physBody) {
      const dx  = pos.x - this.x;
      const dy  = pos.y - this.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      physBody.setVelocity((dx / len) * this.speed, (dy / len) * this.speed);
    } else if (physBody) {
      physBody.setVelocity(0, 0);
    }

    if (this.rearTimer >= REAR_COOLDOWN_MS) this.enterRear(physBody);
  }

  // ── Rear state ─────────────────────────────────────────────────────────────

  private tickRear(physBody: Phaser.Physics.Arcade.Body | undefined): void {
    // Stand still while the vulnerability window is open
    physBody?.setVelocity(0, 0);

    if (this.rearTimer >= REAR_DURATION_MS) this.exitRear(physBody);
  }

  // ── State transitions ──────────────────────────────────────────────────────

  private enterRear(physBody: Phaser.Physics.Arcade.Body | undefined): void {
    this.rearActive       = true;
    this.rearTimer        = 0;
    // Expose underside: full damage, triple multiplier
    this.damageReduction  = 1;
    this.damageMultiplier = 3;
    this.carapace.setFillStyle(COLOR_UNDERSIDE);
    physBody?.setVelocity(0, 0);
  }

  private exitRear(physBody: Phaser.Physics.Arcade.Body | undefined): void {
    // Snap attack fires at the end of the window — after heroes had time to hit.
    const player = _getPlayer();
    if (player?.isAlive) {
      const d = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
      if (d <= MELEE_RANGE) this.attack(player);
    }

    this.rearActive       = false;
    this.rearTimer        = 0;
    this.damageReduction  = 0.15;
    this.damageMultiplier = 1;
    this.carapace.setFillStyle(COLOR_CARAPACE);
    physBody?.setVelocity(0, 0);
  }
}
