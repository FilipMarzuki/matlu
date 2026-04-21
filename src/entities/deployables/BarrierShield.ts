/**
 * BarrierShield — energy-wall cover deployed by the CombatEngineer.
 *
 * Spec (#519):
 *   HP 80 (tanky), lifetime 12 s. Static 48×16 rectangle blocking enemy
 *   movement and projectiles. Does NOT block the hero's own movement or shots.
 *   Oriented perpendicular to the owner's facing direction at deploy time.
 *
 * Physics: creates an immovable arcade static body so enemies cannot walk
 * through it. The arena must register a physics collider between enemies and
 * this barrier via the 'barrier-placed' scene event (done by CombatArenaScene).
 *
 * Placeholder visual: translucent blue rectangle.
 * Real sprite: "Translucent blue hex-grid energy wall with frame at top and
 * bottom, subtle flicker." — sprite-credit-burn agent.
 */

import * as Phaser from 'phaser';
import { Deployable } from '../Deployable';
import { SHIELD } from '../../data/deployableConfigs';

export class BarrierShield extends Deployable {
  private readonly visual: Phaser.GameObjects.Rectangle;
  /** True while the physics body is registered with the scene. */
  private bodyAdded = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    owner: Phaser.GameObjects.GameObject,
    /** Facing angle in radians at deploy time. Barrier is perpendicular to this. */
    facingAngle: number,
  ) {
    super(scene, x, y, '__DEFAULT', owner, SHIELD.lifetimeMs, SHIELD.maxHp);
    this.setVisible(false);

    // Perpendicular to the facing direction: rotate 90°.
    const barrierAngle = facingAngle + Math.PI / 2;

    // Visual placeholder: translucent blue rectangle.
    this.visual = scene.add
      .rectangle(x, y, SHIELD.width, SHIELD.height, 0x4488ff, 0.55)
      .setRotation(barrierAngle)
      .setDepth(1);

    // Static physics body so enemies physically collide with it.
    // The arcade body is added to the scene's physics world; the arena registers
    // the collider via the 'barrier-placed' scene event below.
    scene.physics.add.existing(this, true /* isStatic */);
    const body = this.body as Phaser.Physics.Arcade.StaticBody;
    // Rotate the physics body hitbox to match the visual rotation.
    // Arcade physics bodies are always axis-aligned rectangles — for diagonal
    // barriers this is an approximation. Good enough for a first pass.
    const bw = Math.abs(Math.cos(barrierAngle)) * SHIELD.width + Math.abs(Math.sin(barrierAngle)) * SHIELD.height;
    const bh = Math.abs(Math.sin(barrierAngle)) * SHIELD.width + Math.abs(Math.cos(barrierAngle)) * SHIELD.height;
    body.setSize(bw, bh);
    body.reset(x, y);
    this.bodyAdded = true;

    // Tell the arena to register a collider between enemies and this barrier.
    scene.events.emit('barrier-placed', this);
  }

  override tick(delta: number): boolean {
    if (this.hp <= 0) return false;

    this.lifetimeMs -= delta;
    if (this.lifetimeMs <= 0) return false;

    // Subtle flicker: fade alpha slightly on a low-frequency sine.
    const alpha = 0.45 + 0.1 * Math.sin(this.lifetimeMs / 150);
    this.visual.setAlpha(alpha);

    return true;
  }

  override cleanup(): void {
    this.visual.destroy();
    // Disable the static body before destroying the sprite so physics world
    // doesn't hold a reference to a destroyed game object.
    if (this.bodyAdded && this.body) {
      (this.body as Phaser.Physics.Arcade.StaticBody).enable = false;
    }
    super.cleanup();
  }
}
