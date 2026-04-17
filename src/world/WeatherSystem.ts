// src/world/WeatherSystem.ts
import * as Phaser from 'phaser';
import type { GameSystem, WorldState, WeatherCondition } from './WorldState';

/**
 * WeatherSystem — FIL-58
 *
 * Implements the `GameSystem` interface so it can be registered with WorldState
 * and auto-ticked each frame.  Randomly schedules rain periods and drives
 * weather transitions via `worldState.setWeather()`, which in turn emits the
 * `ws:weather-changed` event that this system also listens to for visual effect
 * changes.
 *
 * ## Scheduler
 * Rain periods trigger at random intervals (30–120 s gap) and last random
 * durations (10–30 s).  The initial gap is randomised on construction so the
 * first rain never starts immediately.
 *
 * ## Visual effects
 * - **Rain overlay**: semi-transparent dark Rectangle (screen-space, scrollFactor 0)
 *   that tweens to alpha 0.35 on rain start and tweens back to 0 on clear.
 * - **Rain particles**: dense diagonal blue-grey streaks (screen-space) using a
 *   procedurally generated 2×8 px texture.  Depth 4 — above terrain (0–3),
 *   below HUD (200+).
 * - **Ash particles**: slow drifting grey flecks for future 'ash' weather condition.
 *
 * ## Audio
 * A dedicated rain ambient sound would need a `sfx-rain.ogg` asset in
 * `public/assets/audio/`.  When that file is added, uncomment the audio block
 * in `startRain()` and load it in `GameScene.preload()`.  Until then the system
 * skips audio silently per the FIL-58 spec.
 *
 * ## Particles are screen-space
 * `setScrollFactor(0)` is called on both the emitter and the overlay so they
 * fill the viewport regardless of camera position — the same approach used by
 * leavesEmitter in `GameScene.spawnParticleEffects()`.
 */
export class WeatherSystem implements GameSystem {
  readonly systemId = 'weather';

  private readonly scene: Phaser.Scene;
  private readonly worldState: WorldState;

  // ── Scheduler state ───────────────────────────────────────────────────────
  /** Countdown in ms until the next weather transition. */
  private cooldownMs: number;
  /** Whether it is currently raining (drives the scheduler state machine). */
  private isRaining = false;

  // ── Visual state ──────────────────────────────────────────────────────────
  /** Currently active particle emitter. Null when weather is clear. */
  private activeEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  /**
   * Full-screen dark overlay that fades in/out with rain.
   * Created once and re-used for every rain period — only its alpha changes.
   */
  private overlay: Phaser.GameObjects.Rectangle | null = null;

  constructor(scene: Phaser.Scene, worldState: WorldState) {
    this.scene      = scene;
    this.worldState = worldState;

    // First rain triggers after a random gap so it doesn't start immediately.
    this.cooldownMs = this.randomGapMs();

    // Apply current weather (handles the edge case of a scene loading mid-rain).
    this.applyWeather(worldState.weather);

    // React to externally triggered weather changes (e.g. zone events).
    scene.events.on(
      'ws:weather-changed',
      (payload: { weather: WeatherCondition }) => this.applyWeather(payload.weather),
      this,
    );
  }

  // ── GameSystem interface ──────────────────────────────────────────────────

  /**
   * Called once per frame.  Counts down the scheduler and fires weather
   * transitions when the timer expires.
   *
   * The scheduler runs an alternating state machine:
   *   [clear → countdown] → [rain → duration] → [clear → countdown] → …
   */
  update(delta: number): void {
    this.cooldownMs -= delta;
    if (this.cooldownMs > 0) return;

    if (this.isRaining) {
      // Rain period over → clear sky; schedule next gap.
      this.isRaining  = false;
      this.worldState.setWeather('clear');
      this.cooldownMs = this.randomGapMs();
    } else {
      // Gap over → start rain; schedule end-of-rain.
      this.isRaining  = true;
      this.worldState.setWeather('rain');
      this.cooldownMs = this.randomDurationMs();
    }
  }

  destroy(): void {
    this.clearEffects();
    this.scene.events.off('ws:weather-changed', undefined, this);
  }

  // ── Scheduler helpers ─────────────────────────────────────────────────────

  /** Random clear-sky gap: 30–120 seconds in milliseconds. */
  private randomGapMs(): number {
    return 30_000 + Math.random() * 90_000;
  }

  /** Random rain duration: 10–30 seconds in milliseconds. */
  private randomDurationMs(): number {
    return 10_000 + Math.random() * 20_000;
  }

  // ── Weather effect dispatch ───────────────────────────────────────────────

  private applyWeather(condition: WeatherCondition): void {
    this.clearEffects();
    if (condition === 'rain') this.startRain();
    if (condition === 'ash')  this.startAsh();
    // 'clear' intentionally has no visual beyond clearEffects()
  }

  // ── Rain ──────────────────────────────────────────────────────────────────

  /**
   * Start rain: fade in a dark overlay then launch particle streaks.
   *
   * Rain design:
   *   - Overlay: black Rectangle at 0 alpha, tweened to 0.35 over 1.5 s.
   *     Dims the world subtly without hiding gameplay.
   *   - Particles: dense diagonal blue-grey streaks (2×8 px) spawned across
   *     the full viewport width, falling mostly downward with a slight SE drift.
   *     `scrollFactor(0)` keeps them screen-space — they follow the camera.
   */
  private startRain(): void {
    this.fadeOverlayIn();

    // Procedurally generated rain-streak texture — avoids needing a sprite asset.
    // Re-using the same key is safe because Phaser replaces the cached texture.
    const g = this.scene.add.graphics().setVisible(false);
    g.fillStyle(0x8ab4cc, 1);
    g.fillRect(0, 0, 2, 8);
    g.generateTexture('particle-rain', 2, 8);
    g.destroy();

    this.activeEmitter = this.scene.add.particles(0, -10, 'particle-rain', {
      // Spread across the full viewport width; y starts above the viewport top.
      x:         { min: 0, max: 1920 },
      // Blown slightly SE: mostly downward (speedY) with gentle rightward drift.
      speedX:    { min: 60,  max: 100  },
      speedY:    { min: 400, max: 600  },
      angle:     { min: 265, max: 285  },
      alpha:     { start: 0.6, end: 0.3 },
      scale:     { min: 0.8, max: 1.4  },
      lifespan:  800,
      frequency: 8,   // ms between emissions — lower = denser
      quantity:  3,   // drops per emission burst
    }).setScrollFactor(0).setDepth(4);

    // ── Audio (placeholder) ────────────────────────────────────────────────
    // Add a rain ambient sound asset at public/assets/audio/rain-ambience.ogg
    // then uncomment:
    // if (this.scene.cache.audio.has('sfx-rain')) {
    //   this.rainSound = this.scene.sound.add('sfx-rain', { loop: true, volume: 0.3 });
    //   this.rainSound.play();
    // }
  }

  // ── Ash ───────────────────────────────────────────────────────────────────

  /**
   * Ash: slow drifting grey flecks at a shallow angle.
   * Sparser and slower than rain — a post-apocalyptic dusting effect.
   * No overlay: ash weather implies a hazy sky, not darkness.
   */
  private startAsh(): void {
    const g = this.scene.add.graphics().setVisible(false);
    g.fillStyle(0xaaaaaa, 1);
    g.fillCircle(2, 2, 2);
    g.generateTexture('particle-ash', 4, 4);
    g.destroy();

    this.activeEmitter = this.scene.add.particles(0, -10, 'particle-ash', {
      x:         { min: 0, max: 1920 },
      speedX:    { min: 20, max: 60  },
      speedY:    { min: 60, max: 120 },
      angle:     { min: 250, max: 280 },
      alpha:     { start: 0.5, end: 0 },
      scale:     { min: 0.5, max: 1.2 },
      lifespan:  3000,
      frequency: 50,
      quantity:  1,
    }).setScrollFactor(0).setDepth(4);
  }

  // ── Overlay helpers ───────────────────────────────────────────────────────

  /**
   * Create (or reuse) the overlay and tween its alpha to 0.35.
   *
   * The overlay is a large black Rectangle with scrollFactor 0, created once
   * and reused across rain periods to avoid repeated object allocation.
   * Starting alpha is always 0 so the tween animates from fully transparent
   * regardless of whether a previous rain already brought it up.
   */
  private fadeOverlayIn(): void {
    if (!this.overlay) {
      const cam = this.scene.cameras.main;
      const cx  = cam.width  / 2;
      const cy  = cam.height / 2;
      // Slightly oversized (×1.5) so it covers the viewport even with small
      // camera shake or letterboxing.
      this.overlay = this.scene.add
        .rectangle(cx, cy, cam.width * 1.5, cam.height * 1.5, 0x000000, 0)
        .setScrollFactor(0)
        .setDepth(3.9); // just below rain particles (4), above terrain (0–3)
    }

    this.overlay.setAlpha(0);
    this.scene.tweens.add({
      targets:  this.overlay,
      alpha:    0.35,
      duration: 1500,
      ease:     'Sine.easeIn',
    });
  }

  /**
   * Tween the overlay back to 0 alpha (does not destroy it — it is reused).
   * Particles are destroyed immediately; the overlay fades out gracefully.
   */
  private fadeOverlayOut(): void {
    if (!this.overlay) return;
    this.scene.tweens.add({
      targets:  this.overlay,
      alpha:    0,
      duration: 2000,
      ease:     'Sine.easeOut',
    });
  }

  /**
   * Stop all active visual effects.
   * Particles are destroyed; the overlay is only faded out (not destroyed)
   * so it can be reused for the next rain period.
   */
  private clearEffects(): void {
    if (this.activeEmitter) {
      this.activeEmitter.destroy();
      this.activeEmitter = null;
    }
    this.fadeOverlayOut();
  }
}
