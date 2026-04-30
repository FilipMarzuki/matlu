import * as Phaser from 'phaser';
import { CombatEntity } from './CombatEntity';
import { BtNode, BtAction } from '../ai/BehaviorTree';

const CLOUD_RADIUS   = 150;       // px
const CLOUD_LIFETIME = 4000;      // ms
const CLOUD_INTERVAL = 8000;      // ms between emissions
const DOT_PER_MS     = 3 / 1000; // 3 HP/s expressed in ms units

/**
 * SporeCloud — a lingering poison area dropped by the SporeDrifter every 8 s.
 *
 * Rendered as a translucent green Arc at 150 px radius. Any hero whose center
 * falls within the radius receives 3 HP/s DoT for the cloud's 4 s lifetime.
 *
 * DoT uses delta accumulation (continuous fractional damage per frame) rather
 * than scene.time.addEvent, so no timer events are left dangling if the cloud
 * is destroyed early via the SHUTDOWN cleanup path.
 */
export class SporeCloud {
  private readonly arc: Phaser.GameObjects.Arc;
  private timeMs = CLOUD_LIFETIME;

  readonly x: number;
  readonly y: number;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.x = x;
    this.y = y;
    this.arc = scene.add.arc(x, y, CLOUD_RADIUS, 0, 360, false, 0x44bb55, 0.35);
    this.arc.setDepth(5);
    // Fade the cloud out linearly so it visually dissolves over its full lifetime.
    scene.tweens.add({
      targets:  this.arc,
      alpha:    0,
      duration: CLOUD_LIFETIME,
      ease:     'Sine.easeIn',
    });
  }

  get isExpired(): boolean { return this.timeMs <= 0; }

  /**
   * Advance the cloud lifetime and apply DoT to every living hero within range.
   *
   * Called once per frame by DungeonForgeScene.update(). Damage is proportional
   * to delta so the rate is exactly 3 HP/s regardless of frame rate — no tick
   * buckets, no timer events, just continuous fractional application.
   */
  tick(delta: number, heroes: readonly CombatEntity[]): void {
    if (this.isExpired) return;
    this.timeMs -= delta;
    for (const hero of heroes) {
      if (!hero.isAlive) continue;
      if (Phaser.Math.Distance.Between(this.x, this.y, hero.x, hero.y) < CLOUD_RADIUS) {
        hero.takeDamage(delta * DOT_PER_MS);
      }
    }
    if (this.timeMs <= 0 && this.arc.active) {
      this.arc.destroy();
    }
  }

  /** Immediately destroy the visual Arc and mark the cloud expired. */
  destroy(): void {
    this.timeMs = 0;
    if (this.arc.active) this.arc.destroy();
  }
}

/**
 * SporeDrifter — a slow jellyfish enemy that never attacks directly.
 *
 * Behaviour:
 *   - Each frame, steer directly away from the nearest hero (flee vector).
 *   - Every 8 s, drop a SporeCloud at the current position.
 *
 * The cloud is handed off to DungeonForgeScene via the 'spore-cloud-spawned'
 * scene event so the scene owns its lifetime, DoT checks, and SHUTDOWN cleanup.
 *
 * aggroRadius is 0 (required by EnemyConfig) and is never consulted in the BT —
 * the flee-and-cloud loop runs unconditionally while the entity is alive.
 */
export class SporeDrifter extends CombatEntity {
  private cloudTimer = CLOUD_INTERVAL;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:            55,
      speed:            40,
      aggroRadius:      0,    // required by EnemyConfig; Drifter never aggros
      attackDamage:     0,    // no direct attacks
      color:            0x3a8a4a,
      meleeRange:       1,
      attackCooldownMs: 1000,
    });
  }

  protected buildTree(): BtNode {
    return new BtAction((ctx, delta) => {
      // Flee: move directly away from the nearest hero at the Drifter's base speed.
      if (ctx.opponent) {
        ctx.steerAway(ctx.opponent.x, ctx.opponent.y);
      } else {
        // No hero visible — drift aimlessly.
        ctx.wander(delta);
      }

      // Spore cloud emission — once every CLOUD_INTERVAL ms.
      this.cloudTimer -= delta;
      if (this.cloudTimer <= 0) {
        this.cloudTimer = CLOUD_INTERVAL;
        const cloud = new SporeCloud(this.scene, this.x, this.y);
        // DungeonForgeScene listens for this and takes ownership of the cloud.
        this.scene.events.emit('spore-cloud-spawned', cloud);
      }

      return 'running';
    });
  }
}
