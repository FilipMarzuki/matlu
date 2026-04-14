/**
 * SoundEventSystem — translates loud in-game events into enemy alert calls.
 *
 * Implements the `GameSystem` interface so it can be registered with a
 * `WorldState` instance and torn down cleanly with the rest of the systems.
 *
 * ## How it works
 *
 * Callers emit one of three events on the Phaser scene event bus:
 *
 *   scene.events.emit('sound:gunshot',   { x, y, radius })
 *   scene.events.emit('sound:death',     { x, y, radius })
 *   scene.events.emit('sound:explosion', { x, y, radius })
 *
 * For each event, `SoundEventSystem` checks every registered enemy against
 * the event radius. Enemies within range receive `alertTo(x, y)`, which
 * triggers the `alerted` detection state — they heard the sound even if they
 * didn't have line-of-sight.
 *
 * ## Integration
 *
 *   // In CombatArenaScene.create():
 *   const soundSystem = new SoundEventSystem(this);
 *   this.worldState.registerSystem(soundSystem);
 *
 *   // After spawning a wave:
 *   soundSystem.setEnemies(this.enemies);
 *
 *   // After each wave ends (before setEnemies for the next):
 *   soundSystem.setEnemies([]);
 *
 * ## Future: FIL-190 full implementation
 *
 * When FIL-190 (detection FSM) is complete and obstacle walls are added to
 * the arena, extend `handleSoundEvent` to account for wall attenuation:
 * sounds that pass through solid geometry lose intensity and may not alert
 * enemies on the other side.
 */

import type { GameSystem } from './WorldState';
import type { CombatEntity } from '../entities/CombatEntity';

// ── Sound event shape ─────────────────────────────────────────────────────────

/** Payload emitted with scene events like `sound:gunshot`. */
export interface SoundEvent {
  /** World X of the sound origin. */
  x: number;
  /** World Y of the sound origin. */
  y: number;
  /** Radius in px — enemies within this distance are alerted. */
  radius: number;
}

// ── System ────────────────────────────────────────────────────────────────────

export class SoundEventSystem implements GameSystem {
  readonly systemId = 'sound-event-system';

  private readonly scene: Phaser.Scene;
  /** Live enemy roster for the current wave. Updated by setEnemies(). */
  private enemies: ReadonlyArray<CombatEntity> = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // Bind event listeners on the scene bus rather than using arrow functions
    // so we can cleanly remove them by reference in destroy().
    scene.events.on('sound:gunshot',   this.handleSoundEvent, this);
    scene.events.on('sound:death',     this.handleSoundEvent, this);
    scene.events.on('sound:explosion', this.handleSoundEvent, this);
  }

  /**
   * Replace the enemy roster.
   * Call from CombatArenaScene at the start of each wave and with an empty
   * array at the end so dead enemies from a completed wave aren't alerted.
   */
  setEnemies(enemies: ReadonlyArray<CombatEntity>): void {
    this.enemies = enemies;
  }

  /** No per-frame logic needed — the system is entirely event-driven. */
  update(_delta: number): void { /* no-op */ }

  /** Remove listeners when the WorldState (and the scene) shuts down. */
  destroy(): void {
    this.scene.events.off('sound:gunshot',   this.handleSoundEvent, this);
    this.scene.events.off('sound:death',     this.handleSoundEvent, this);
    this.scene.events.off('sound:explosion', this.handleSoundEvent, this);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private handleSoundEvent(event: SoundEvent): void {
    for (const e of this.enemies) {
      if (!e.isAlive) continue;
      const d = Phaser.Math.Distance.Between(event.x, event.y, e.x, e.y);
      if (d <= event.radius) {
        // alertTo() transitions the enemy from Idle → Alerted with the
        // sound origin as the investigation point — even around corners.
        e.alertTo(event.x, event.y);
      }
    }
  }
}
