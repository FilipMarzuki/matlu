/**
 * DryShade — semi-transparent ability-drain enemy in Mistheim.
 *
 * Visually a faint, ghostly wisp (alpha 0.5) that drifts straight toward the
 * player. It deals no HP damage; instead, on contact it drains one ability
 * charge. A per-instance cooldown (1.5 s) prevents a single Shade from
 * draining multiple charges on the same pass.
 *
 * ## Drain handshake
 * When GameScene detects an overlap, it calls `shade.tryDrain(now)`. If the
 * Shade's internal cooldown has expired, this returns `true` and resets the
 * timer. GameScene then emits `'player-charge-drain'` so the charge system
 * (future work) can react without this class depending on GameScene internals.
 *
 * ## Static getter pattern (same as Dustling)
 * DryShade.setPlayerGetter() is called once by the spawning scene. Every
 * instance reads the shared lambda for its chase target.
 */

import * as Phaser from 'phaser';
import { Enemy } from './Enemy';

const SPEED         = 55;   // px/s — slower than the player but relentless
const BODY_RADIUS   = 8;
const BODY_COLOR    = 0x99ccff;  // pale blue-white, ghostly
const DRAIN_CD_MS   = 1500;      // ms between drains from a single Shade

// Module-level registry — mirrors the Dustling pattern.
const _registry: DryShade[] = [];

let _getPlayerPos: () => { x: number; y: number } = () => ({ x: 0, y: 0 });

export class DryShade extends Enemy {
  /** ms remaining before this Shade can drain again. */
  private drainCooldown = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, {
      maxHp:        30,
      speed:        SPEED,
      aggroRadius:  0,     // handled by drift logic, not aggro radius
      attackDamage: 0,     // no HP damage — drain only
    });

    // Semi-transparent pale circle — visually distinct from opaque enemies.
    const orb = scene.add.arc(0, 0, BODY_RADIUS, 0, 360, false, BODY_COLOR);
    this.add(orb);

    // The defining trait: render at half opacity so the Shade looks ethereal.
    this.setAlpha(0.5);

    _registry.push(this);
  }

  // ── Static API ──────────────────────────────────────────────────────────────

  /** Set the shared player-position getter. Call once from the spawning scene. */
  static setPlayerGetter(fn: () => { x: number; y: number }): void {
    _getPlayerPos = fn;
  }

  /** Clear the registry on scene shutdown/reset. */
  static clearRegistry(): void {
    _registry.length = 0;
  }

  // ── Drain handshake ─────────────────────────────────────────────────────────

  /**
   * Called by GameScene's overlap handler. Returns `true` if this Shade
   * successfully applies a drain (cooldown was up) — the caller should then
   * emit `'player-charge-drain'`. Returns `false` when the cooldown is still
   * running, so a single contact frame can't drain all charges at once.
   *
   * @param now - Current scene time in ms (pass `this.time.now` from the scene)
   */
  tryDrain(_now: number): boolean {
    if (this.drainCooldown > 0) return false;
    this.drainCooldown = DRAIN_CD_MS;
    return true;
  }

  // ── Behaviour ───────────────────────────────────────────────────────────────

  protected override updateBehaviour(delta: number): void {
    // Tick down drain cooldown.
    this.drainCooldown = Math.max(0, this.drainCooldown - delta);

    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    if (!physBody) return;

    // Drift straight toward the player — no boids, no wander.
    const target = _getPlayerPos();
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;

    physBody.setVelocity((dx / len) * SPEED, (dy / len) * SPEED);
  }

  // ── Death ───────────────────────────────────────────────────────────────────

  protected override onDeath(): void {
    const idx = _registry.indexOf(this);
    if (idx !== -1) _registry.splice(idx, 1);

    const physBody = this.body as Phaser.Physics.Arcade.Body | undefined;
    physBody?.setVelocity(0, 0);

    // Soft fade-out instead of a pop — Shades dissolve.
    this.scene.tweens.add({
      targets:    this,
      alpha:      0,
      duration:   300,
      ease:       'Cubic.easeOut',
      onComplete: () => this.destroy(),
    });
  }
}
