import * as Phaser from 'phaser';
import { LivingEntity } from '../entities/LivingEntity';
import { Projectile } from '../entities/Projectile';

/**
 * Any scene that hosts StormSovereign must expose an `enemies` group so
 * Monsoon can iterate all active enemies without a spatial query.
 */
export interface EnemyHostScene extends Phaser.Scene {
  enemies: Phaser.GameObjects.Group;
}

// Texture keys — matches asset filenames without extension.
const RAIN_KEY   = 'hero-raindrop';
const BOLT_KEY   = 'hero-lightning-bolt';

const MONSOON_DMG  = 40;
const BOLT_SPEED   = 420;
// Lightning-blue colour for the Rectangle-based Projectile tracer.
const BOLT_COLOR   = 0xaaddff;

/**
 * StormSovereign — Tier 4 Weather Wielder hero for Vattenpandalandet.
 *
 * Emits a persistent rain-particle aura and exposes `monsoon()`, which:
 *   1. Deals flat damage to every enemy in the scene (not a spatial query).
 *   2. Fires a visual lightning-bolt Projectile toward each hit enemy.
 *   3. Spawns a one-shot rain-burst particle effect at the hero's position.
 *
 * Extends LivingEntity directly (not CombatEntity) because the hero uses
 * simple imperative ability calls rather than a behaviour-tree AI loop.
 */
export class StormSovereign extends LivingEntity {
  private readonly rainEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  // Visual bolt projectiles spawned during Monsoon — ticked manually each frame.
  private readonly pendingBolts: Projectile[] = [];

  constructor(scene: EnemyHostScene, x: number, y: number) {
    super(scene, x, y, { maxHp: 200 });
    StormSovereign.ensureTextures(scene);

    // Scene-level emitter; position synced to hero in update() so it follows movement.
    this.rainEmitter = scene.add.particles(x, y, RAIN_KEY, {
      x:        { min: -28, max: 28 },
      speedY:   { min: 90, max: 200 },
      speedX:   { min: -15, max: 15 },
      alpha:    { start: 0.8, end: 0 },
      scale:    { min: 0.5, max: 1.1 },
      lifespan: 550,
      frequency: 55,
      quantity:  2,
    });
  }

  override update(delta: number): void {
    if (!this.isAlive) return;

    // Keep rain aura centred on the hero as it moves.
    this.rainEmitter.setPosition(this.x, this.y);

    // Manually tick bolt projectiles (Projectile.tick() is not in Phaser's loop).
    for (const bolt of this.pendingBolts) bolt.tick(delta);
    for (let i = this.pendingBolts.length - 1; i >= 0; i--) {
      if (this.pendingBolts[i].isExpired) this.pendingBolts.splice(i, 1);
    }
  }

  /**
   * Monsoon — AoE signature ability.
   *
   * Iterates `scene.enemies.getChildren()` (not an overlap/spatial query) so
   * every enemy in the group is hit, even those at the edge of the screen.
   * Damage is applied directly via takeDamage(); the Projectile entities that
   * follow are purely visual — they carry no targets of their own.
   */
  monsoon(): void {
    if (!this.isAlive) return;

    const hostScene = this.scene as EnemyHostScene;

    this.spawnMonsoonBurst();

    for (const child of hostScene.enemies.getChildren()) {
      // Type-narrow at runtime: skip anything that isn't a LivingEntity subclass.
      if (!(child instanceof LivingEntity)) continue;
      if (!child.isAlive) continue;

      child.takeDamage(MONSOON_DMG);

      // Fire a visual bolt that travels to the enemy's current position, then expires.
      const angle = Math.atan2(child.y - this.y, child.x - this.x);
      const dist  = Phaser.Math.Distance.Between(this.x, this.y, child.x, child.y);
      const bolt  = new Projectile(
        this.scene,
        this.x,
        this.y,
        angle,
        BOLT_SPEED,
        0,          // damage = 0; harm is already dealt above
        BOLT_COLOR,
        [],         // no targets; bolt never triggers hit detection
        0,          // hitRadius 0 so the distance check never fires
        dist + 4,   // maxRange: expire just past the target
      );
      this.pendingBolts.push(bolt);
    }
  }

  override destroy(fromScene?: boolean): void {
    // Explicit destroy prevents orphaned emitters if the scene restarts.
    if (this.rainEmitter.active) this.rainEmitter.destroy();
    for (const bolt of this.pendingBolts) {
      if (!bolt.isExpired) bolt.destroy();
    }
    this.pendingBolts.length = 0;
    super.destroy(fromScene);
  }

  private spawnMonsoonBurst(): void {
    // One-shot burst — explode() fires all particles immediately then stops.
    const burst = this.scene.add.particles(this.x, this.y, RAIN_KEY, {
      speed:    { min: 60, max: 220 },
      angle:    { min: 0, max: 360 },
      scale:    { min: 0.6, max: 1.5 },
      alpha:    { start: 0.9, end: 0 },
      lifespan: 700,
    });
    burst.explode(30);
    // Clean up after the longest-lived particle finishes.
    this.scene.time.delayedCall(800, () => { if (burst.active) burst.destroy(); });
  }

  /**
   * Falls back to generated textures if the scene's preload() hasn't loaded
   * the hero asset pack yet. Generating at construction keeps the hero
   * self-contained — no mandatory preload step in every hosting scene.
   */
  private static ensureTextures(scene: Phaser.Scene): void {
    if (!scene.textures.exists(RAIN_KEY)) {
      const g = scene.add.graphics().setVisible(false);
      // Thin teardrop: narrow rectangle body + rounded cap.
      g.fillStyle(0x88ccff, 1);
      g.fillRect(1, 2, 2, 5);
      g.fillCircle(2, 2, 1.5);
      g.generateTexture(RAIN_KEY, 4, 8);
      g.destroy();
    }
    if (!scene.textures.exists(BOLT_KEY)) {
      const g = scene.add.graphics().setVisible(false);
      // Zigzag lightning bolt: upper-right segment then lower-left.
      g.fillStyle(0xffffaa, 1);
      g.fillRect(4, 0, 3, 10);
      g.fillRect(1, 8, 3, 10);
      g.generateTexture(BOLT_KEY, 8, 20);
      g.destroy();
    }
  }
}
