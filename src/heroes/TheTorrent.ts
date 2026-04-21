import * as Phaser from 'phaser';
import { LivingEntity, LivingEntityConfig } from '../entities/LivingEntity';

// ── Visual constants ──────────────────────────────────────────────────────────

/** Body is ~2× human height (human ≈ 24 px tall at this scale). */
const BODY_W = 24;
const BODY_H = 48;
const CRYSTAL_W = 12;
const CRYSTAL_H = 24;

/** Translucent water-blue outer shell. */
const BODY_COLOR = 0x44aaff;
/** Brighter ice-blue crystalline core. */
const CRYSTAL_COLOR = 0xaaeeff;

/** How long Fluid Form suppresses terrain collision (ms). */
const DEFAULT_FLUID_FORM_MS = 2000;

// ─────────────────────────────────────────────────────────────────────────────

export interface TorrentConfig extends LivingEntityConfig {
  /** Override the Fluid Form ability duration in milliseconds. */
  fluidFormDurationMs?: number;
}

/**
 * TheTorrent — Tier 3 Water Construct hero for Mistheim.
 *
 * A ~2× human-height humanoid composed of animated water and a crystal core.
 * Unlike other heroes The Torrent is completely immune to knockback — its mass
 * cannot be displaced by impact forces.
 *
 * ## Signature ability: Fluid Form
 * `fluidForm(solidLayer)` — briefly disables tilemap solid-layer collision so
 * the hero can pass through narrow terrain gaps. See method docs for the
 * two-step Phaser requirement (immovable + layer collision).
 */
export class TheTorrent extends LivingEntity {
  private readonly fluidFormDurationMs: number;
  /** Bright inner rect; tinted white while Fluid Form is active. */
  private readonly crystalCore: Phaser.GameObjects.Rectangle;
  /** Water-droplet particles layered over the crystal core. */
  private readonly waterEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private fluidFormActive = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: TorrentConfig = { maxHp: 120 },
  ) {
    super(scene, x, y, config);
    this.fluidFormDurationMs = config.fluidFormDurationMs ?? DEFAULT_FLUID_FORM_MS;

    // Outer water shell — wide, tall, semi-transparent blue.
    const outerBody = scene.add.rectangle(0, 0, BODY_W, BODY_H, BODY_COLOR);
    outerBody.setAlpha(0.75);
    this.add(outerBody);

    // Crystal core — inner bright rectangle suggesting a solid mineral centre.
    this.crystalCore = scene.add.rectangle(0, 0, CRYSTAL_W, CRYSTAL_H, CRYSTAL_COLOR);
    this.add(this.crystalCore);

    // Ensure the water-droplet texture exists. If the host scene has preloaded
    // the asset from public/assets/packs/heroes/water-droplet.png the cache
    // entry is already present. If not (e.g. unit tests, devtools), we generate
    // a tiny blue circle programmatically so the emitter always has a texture.
    if (!scene.textures.exists('water-droplet')) {
      const g = scene.add.graphics().setVisible(false);
      g.fillStyle(0x66ccff, 1);
      g.fillCircle(2, 2, 2);
      g.generateTexture('water-droplet', 4, 4);
      g.destroy();
    }

    // Particle emitter layered above the crystal core.
    // Particles drift upward and outward, evoking a body of water in constant
    // flux. Container.add() (exclusive mode) removes the emitter from the
    // scene display list automatically, so no manual removal is needed.
    this.waterEmitter = scene.add.particles(0, 0, 'water-droplet', {
      x:        { min: -BODY_W / 2, max: BODY_W / 2 },
      y:        { min: -BODY_H / 2, max: BODY_H / 2 },
      speedX:   { min: -10, max: 10 },
      speedY:   { min: -18, max: -2 },
      alpha:    { start: 0.85, end: 0 },
      scale:    { min: 0.4, max: 1.1 },
      lifespan: 700,
      frequency: 80,
      quantity:  1,
    });
    // Reparent into this Container so the emitter follows the hero's position.
    this.add(this.waterEmitter);
  }

  // LivingEntity requires this — no per-frame logic needed right now.
  override update(_delta: number): void {}

  /**
   * Knockback impulses are suppressed entirely — The Torrent's mass is
   * anchored in place by its crystalline core.
   *
   * Callers that would normally set velocity on a hit reaction should call
   * this method instead of manipulating the body directly, so subclasses and
   * future heroes can selectively override the behaviour.
   */
  applyKnockback(_vx: number, _vy: number): void {
    // Intentional no-op: The Torrent is immune to knockback.
  }

  /**
   * Fluid Form — The Torrent briefly dissolves its physical boundaries,
   * allowing it to slip through terrain gaps.
   *
   * **Why two steps are required:**
   *
   * 1. `body.setImmovable(false)` disables the Arcade physics "push-away"
   *    response between dynamic bodies. This is *not* enough to pass through
   *    tiles — tile collision is tracked per-layer, entirely separately from
   *    the body-vs-body resolution flag.
   *
   * 2. `solidLayer.setCollisionByProperty({ collides: true }, false)` finds
   *    all tiles tagged with the custom Tiled property `collides: true` and
   *    removes their physics collision flags. Without this step the entity
   *    still stops at tile edges even when immovable is false.
   *
   * Both are restored after `fluidFormDurationMs` milliseconds.
   * Calls while the ability is already active are silently ignored.
   */
  fluidForm(solidLayer?: Phaser.Tilemaps.TilemapLayer | null): void {
    if (this.fluidFormActive) return;
    this.fluidFormActive = true;

    const arcadeBody = this.body as Phaser.Physics.Arcade.Body;
    arcadeBody.setImmovable(false);
    // When a solid TilemapLayer is provided, temporarily disable its tile
    // collision so the body can pass through narrow terrain gaps. Scenes that
    // use a static physics group instead of a TilemapLayer (e.g. GameScene's
    // procedural world) simply omit the argument — the body-immovability change
    // alone still allows slipping past dynamic bodies.
    solidLayer?.setCollisionByProperty({ collides: true }, false);

    // Tint the crystal core white to give visual feedback that the ability is
    // active. Restored when the timer fires.
    this.crystalCore.setFillStyle(0xffffff);

    this.scene.time.delayedCall(this.fluidFormDurationMs, () => {
      if (!this.active) return; // hero may have been destroyed before the timer fired
      arcadeBody.setImmovable(true);
      solidLayer?.setCollisionByProperty({ collides: true }, true);
      this.crystalCore.setFillStyle(CRYSTAL_COLOR);
      this.fluidFormActive = false;
    });
  }

  /**
   * Explicit emitter cleanup on destroy.
   *
   * Phaser does not automatically destroy particle emitters when a Container
   * is destroyed. Without this override, the emitter would keep running
   * invisibly in the background across scene restarts, leaking GPU particles.
   */
  override destroy(fromScene?: boolean): void {
    this.waterEmitter.destroy();
    super.destroy(fromScene);
  }
}
