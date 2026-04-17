import * as Phaser from 'phaser';
import type { Damageable } from './Projectile';

export interface BurrowHoleConfig {
  maxHp?: number;
}

const HOLE_R = 10;  // visual radius of the tunnel mouth
const BAR_W  = 22;
const BAR_H  = 3;
const BAR_Y  = -17;

/**
 * BurrowHole — a static, damageable arena obstacle.
 *
 * Represents a tunnel entrance carved into the arena floor. It accepts damage
 * from hero melee swings and projectile hits. When HP reaches zero it emits
 * 'hole-destroyed' on the scene event bus and disables its physics body so
 * entities can walk through the collapsed opening.
 *
 * Physics body is added externally by CombatArenaScene (same pattern as
 * CombatEntity): scene.physics.add.existing(hole, true).
 *
 * No BehaviourTree or aggro logic — purely a damageable static object.
 */
export class BurrowHole extends Phaser.GameObjects.Container implements Damageable {
  readonly maxHp: number;
  private _hp: number;
  private _dead = false;
  private readonly hpBarFill: Phaser.GameObjects.Rectangle;

  get isAlive(): boolean {
    return !this._dead;
  }

  constructor(scene: Phaser.Scene, x: number, y: number, config: BurrowHoleConfig = {}) {
    super(scene, x, y);
    // Register with the scene's display list so it renders automatically.
    scene.add.existing(this);

    this.maxHp = config.maxHp ?? 60;
    this._hp   = this.maxHp;

    // ── Visual ────────────────────────────────────────────────────────────────
    // Outer ring — stone-edged entrance lip.
    const outerRing = scene.add.arc(0, 0, HOLE_R, 0, 360, false, 0x3a1a08);
    outerRing.setStrokeStyle(2, 0x7a4820);
    this.add(outerRing);

    // Inner void — the dark tunnel below.
    const inner = scene.add.arc(0, 0, HOLE_R - 3, 0, 360, false, 0x050200);
    this.add(inner);

    // HP bar background (full width, dark).
    const barBg = scene.add.rectangle(0, BAR_Y, BAR_W, BAR_H, 0x222222);
    this.add(barBg);

    // HP bar fill — anchored at left edge; scaleX shrinks it as HP drops.
    // Origin (0, 0.5) keeps the bar anchored at the left edge when scaling.
    this.hpBarFill = scene.add.rectangle(-BAR_W / 2, BAR_Y, BAR_W, BAR_H, 0x44cc44);
    this.hpBarFill.setOrigin(0, 0.5);
    this.add(this.hpBarFill);

    // Y-sort depth: floor tiles are at -1; holes sit just above at depth = y.
    this.setDepth(y);
  }

  /**
   * Apply damage to the hole. Emits 'hole-damaged' on each hit and
   * 'hole-destroyed' when HP reaches zero (also disables the physics body).
   * Returns the actual damage dealt (clamped to remaining HP).
   */
  takeDamage(amount: number): number {
    if (this._dead) return 0;
    const actual = Math.min(amount, this._hp);
    this._hp -= actual;
    this.hpBarFill.scaleX = this._hp / this.maxHp;
    this.scene.events.emit('hole-damaged', this, actual);
    if (this._hp <= 0) {
      this._dead = true;
      this.scene.events.emit('hole-destroyed', this);
      // Disable the static physics body so entities can walk over the collapsed hole.
      const body = this.body as Phaser.Physics.Arcade.StaticBody | undefined;
      if (body) body.enable = false;
      this.setAlpha(0.3);
    }
    return actual;
  }
}
