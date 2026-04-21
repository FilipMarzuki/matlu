import * as Phaser from 'phaser';
import { LivingEntity } from '../entities/LivingEntity';
import { Projectile, Damageable } from '../entities/Projectile';

// ── Visual constants ──────────────────────────────────────────────────────────

/** Width of the main wave body in px. */
const WAVE_W = 42;
/** Height of each wave crest bar in px. */
const CREST_H = 8;
/** Vertical oscillation amplitude in px for each crest. */
const CREST_AMP = 6;
/** Duration of a single oscillation cycle (ms). */
const CREST_PERIOD = 900;
/** Deep ocean blue for the wave body. */
const WAVE_COLOR = 0x1a5fa8;
/** Bright seafoam for the crests. */
const CREST_COLOR = 0x7de8ff;

// ── Ability constants ─────────────────────────────────────────────────────────

/** Damage dealt when Sea Remembers fires back a projectile. */
const REFLECTION_DAMAGE = 35;
/** Speed of the reflected water bolt in px/s. */
const REFLECTION_SPEED  = 340;
/** Tint of the reflected bolt (deep indigo — ancient water). */
const REFLECTION_COLOR  = 0x3322cc;
/** How long the silhouette overlay stays visible in ms. */
const SILHOUETTE_SHOW_MS = 1500;

// ── Death animation constants ─────────────────────────────────────────────────

/** How long the wave-receding death animation plays before the entity is destroyed. */
const DEATH_ANIM_MS = 900;

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Tags that describe the type of ability that struck The Living Sea.
 * The scene or ability code passes one of these to `recordAbilityHit()`
 * so Sea Remembers knows what to mirror.
 */
export type AbilityTag = 'projectile' | 'melee' | 'aoe' | 'unknown';

/**
 * The Living Sea — Tier 5 Mistheim hero.
 *
 * Has no fixed form: rendered as oscillating wave crests layered above a
 * deep-blue body, with a separate silhouette overlay that briefly appears
 * on signature-ability activation — hinting at the ancient vastness beneath.
 *
 * ## Wave rendering
 * Three horizontal bar-shaped rectangles oscillate on Y independently with
 * staggered phase offsets, producing a rolling-sea feel without a sprite.
 * Crest bars are contained inside the Container so they follow position.
 *
 * ## Sea Remembers (signature)
 * `recordAbilityHit(tag, attacker)` is called by the scene whenever an
 * ability strikes the hero. It stores the tag and attacker reference.
 * On `useSeaRemembers(targets)` the hero mirrors the ability once, then
 * resets — "once per encounter" means the stored state persists until
 * used, and is cleared on scene restart via normal hero construction.
 *
 * ## Death
 * `die()` override plays a wave-flattening tween for DEATH_ANIM_MS, then
 * calls `super.destroy()`. This prevents the entity popping out instantly.
 */
export class TheLivingSea extends LivingEntity {
  // ── Wave visual objects ───────────────────────────────────────────────────

  /** Three crest bars — oscillate independently to simulate rolling waves. */
  private readonly crests: Phaser.GameObjects.Rectangle[];
  /** Crest oscillation tweens — stopped on death. */
  private readonly crestTweens: Phaser.Tweens.Tween[];

  /**
   * Silhouette overlay — a tall dark rectangle revealed during Sea Remembers.
   * Kept as a separate child so it can be toggled independently of the crests.
   */
  private readonly silhouette: Phaser.GameObjects.Rectangle;

  // ── Sea Remembers state ───────────────────────────────────────────────────

  /** Last ability tag recorded via recordAbilityHit(). Null = nothing stored. */
  private storedAbilityTag: AbilityTag | null = null;
  /** Last attacker reference — may be destroyed by the time Sea Remembers fires. */
  private storedAttacker: LivingEntity | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, { maxHp: 160 });

    // ── Wave body ───────────────────────────────────────────────────────────

    // Base body — the dark, still deep water beneath the surface crests.
    const body = scene.add.rectangle(0, 0, WAVE_W, CREST_H * 5, WAVE_COLOR);
    body.setAlpha(0.8);
    this.add(body);

    // ── Wave crests ─────────────────────────────────────────────────────────

    // Three oscillating crest bars placed at different Y offsets.
    // Phase offsets (delay) stagger them so they roll rather than pulse in sync.
    const CREST_OFFSETS = [-10, 0, 10]; // px above / at / below center
    const PHASE_DELAYS  = [0, CREST_PERIOD / 3, (CREST_PERIOD * 2) / 3];

    this.crests = CREST_OFFSETS.map((yOff, i) => {
      const c = scene.add.rectangle(0, yOff, WAVE_W * 0.85, CREST_H, CREST_COLOR);
      c.setAlpha(0.9 - i * 0.15);
      this.add(c);
      return c;
    });

    // Oscillation tweens — yoyo between +amp and −amp relative to base Y.
    this.crestTweens = this.crests.map((c, i) => {
      const baseY = CREST_OFFSETS[i];
      return scene.tweens.add({
        targets:  c,
        y:        baseY + CREST_AMP,
        duration: CREST_PERIOD / 2,
        ease:     'Sine.easeInOut',
        yoyo:     true,
        repeat:   -1,
        delay:    PHASE_DELAYS[i],
      });
    });

    // ── Silhouette overlay ──────────────────────────────────────────────────

    // The silhouette hints at something ancient and vast; starts invisible.
    // Slightly taller and wider than the body so it frames it. Using a
    // very dark navy at low alpha so it doesn't obscure the wave crests.
    this.silhouette = scene.add.rectangle(0, -4, WAVE_W + 10, CREST_H * 7, 0x050510);
    this.silhouette.setAlpha(0);
    this.add(this.silhouette);

    // Z-order: body → crests → silhouette (on top, modulated by alpha).
    // Silhouette is added last so it draws over crests when it appears.

    // The wave entity renders above the ground layer using Y-sort depth
    // (same convention as the player in GameScene).
    this.setDepth(this.y);
  }

  // ── LivingEntity contract ─────────────────────────────────────────────────

  override update(delta: number): void {
    // Y-sort depth — keeps the wave stacking correctly with other entities.
    this.setDepth(this.y);
    // No per-frame movement logic; driven externally by the scene controller.
    void delta;
  }

  // ── Sea Remembers ─────────────────────────────────────────────────────────

  /**
   * Record the type and source of an ability that just struck The Living Sea.
   *
   * Called by the scene (or ability code) immediately after damage is applied.
   * Only stores the *first* unresolved hit — subsequent hits before the
   * ability is used overwrite the stored tag so the most recent attack wins.
   *
   * @param tag      - The ability category (e.g. 'projectile', 'aoe').
   * @param attacker - The entity responsible for the hit, if known.
   */
  recordAbilityHit(tag: AbilityTag, attacker?: LivingEntity): void {
    this.storedAbilityTag = tag;
    this.storedAttacker   = attacker ?? null;
  }

  /**
   * Activate Sea Remembers — mirror the last stored ability back at its origin.
   *
   * Fires once per recorded hit and immediately resets storage, so the next
   * activation does nothing until another ability hits the hero.
   *
   * @param damageableTargets - Living or static targets projectile can hit.
   *   Pass the current enemy group from the scene.
   */
  useSeaRemembers(damageableTargets: Damageable[]): void {
    if (!this.storedAbilityTag || !this.isAlive) return;

    const tag      = this.storedAbilityTag;
    const attacker = this.storedAttacker;

    // Reset immediately — prevents double-firing even if caller calls twice.
    this.storedAbilityTag = null;
    this.storedAttacker   = null;

    // Show the silhouette overlay briefly.
    this.revealSilhouette();

    // Mirror the ability based on its tag.
    if (tag === 'projectile' && attacker?.isAlive) {
      // Fire a reflected water bolt back toward the attacker.
      const angle = Math.atan2(attacker.y - this.y, attacker.x - this.x);
      const bolt  = new Projectile(
        this.scene, this.x, this.y,
        angle, REFLECTION_SPEED, REFLECTION_DAMAGE,
        REFLECTION_COLOR,
        damageableTargets,
      );
      this.scene.events.emit('projectile-spawned', bolt);
    } else if ((tag === 'melee' || tag === 'aoe') && attacker?.isAlive) {
      // AoE water burst — knockback pulse expanding from The Living Sea.
      const burst = this.scene.add.circle(this.x, this.y, 20, 0x44aaff, 0.55);
      burst.setDepth(this.depth + 1);
      this.scene.tweens.add({
        targets:  burst,
        scaleX:   5,
        scaleY:   5,
        alpha:    0,
        duration: 350,
        ease:     'Cubic.easeOut',
        onComplete: () => { if (burst.active) burst.destroy(); },
      });
      // Apply knockback-like damage to the attacker if still alive.
      attacker.takeDamage(REFLECTION_DAMAGE);
    } else {
      // Unknown tag — generic reflected bolt toward nearest enemy.
      const closestTarget = (damageableTargets as Array<{ x: number; y: number; takeDamage?: unknown }>)
        .filter(t => t !== (this as unknown))
        .sort((a, b) =>
          Phaser.Math.Distance.Between(this.x, this.y, a.x, a.y) -
          Phaser.Math.Distance.Between(this.x, this.y, b.x, b.y),
        )[0];
      if (closestTarget) {
        const angle = Math.atan2(closestTarget.y - this.y, closestTarget.x - this.x);
        const bolt  = new Projectile(
          this.scene, this.x, this.y,
          angle, REFLECTION_SPEED, REFLECTION_DAMAGE,
          REFLECTION_COLOR,
          damageableTargets,
        );
        this.scene.events.emit('projectile-spawned', bolt);
      }
    }

    this.scene.events.emit('sea-remembers-fired', this.x, this.y, tag);
  }

  /** Whether Sea Remembers has a stored ability ready to mirror. */
  get hasStoredAbility(): boolean {
    return this.storedAbilityTag !== null;
  }

  // ── Death ─────────────────────────────────────────────────────────────────

  /**
   * Wave-receding death animation.
   *
   * Flattens the wave crests and fades the entire entity over DEATH_ANIM_MS
   * before calling `super.destroy()`. This prevents the entity from popping
   * out of existence immediately, giving the player a visual signal.
   */
  protected override onDeath(): void {
    if (!this.active) return;

    // Stop the rolling oscillation tweens so the crests freeze mid-motion.
    for (const t of this.crestTweens) t.stop();

    // Play the receding animation on the whole Container.
    this.scene.tweens.add({
      targets:  this,
      scaleY:   0,
      alpha:    0,
      duration: DEATH_ANIM_MS,
      ease:     'Cubic.easeIn',
      onComplete: () => {
        if (this.active) this.destroy();
      },
    });
  }

  // ── Destroy ───────────────────────────────────────────────────────────────

  override destroy(fromScene?: boolean): void {
    for (const t of this.crestTweens) t.stop();
    super.destroy(fromScene);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Flash the silhouette overlay for SILHOUETTE_SHOW_MS.
   *
   * The silhouette is a separate child rectangle drawn on top of the crests
   * so it can be toggled independently. It fades in quickly, holds briefly,
   * then fades out — hinting at the vast form beneath the waves.
   */
  private revealSilhouette(): void {
    if (!this.active) return;
    // Fade in to 0.45 alpha (dark but not fully opaque), hold, then fade out.
    this.scene.tweens.add({
      targets:  this.silhouette,
      alpha:    0.45,
      duration: 180,
      ease:     'Cubic.easeOut',
      onComplete: () => {
        if (!this.active) return;
        this.scene.time.delayedCall(SILHOUETTE_SHOW_MS - 360, () => {
          if (!this.active) return;
          this.scene.tweens.add({
            targets: this.silhouette,
            alpha:   0,
            duration: 220,
            ease:    'Cubic.easeIn',
          });
        });
      },
    });
  }
}
