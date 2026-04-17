/**
 * WindSystem — CPU-side wind animation for decoration sprites (FIL-240).
 *
 * Implements the tween-pool / per-frame oscillation tier from the wind
 * animation design doc (FIL-239).  Applies a smooth sinusoidal y-offset
 * to decoration `Image` objects within 2× the camera viewport.  Objects
 * outside that range have their y restored to the original position so they
 * don't drift when the camera scrolls back to them.
 *
 * ## Why y-offset and not rotation?
 * The decorations are drawn from a slightly elevated top-down perspective.
 * A small vertical bob (±2 px) reads as wind sway in that projection without
 * breaking the pixel-art aesthetic.  Full rotation would make sprites point
 * in unnatural directions.
 *
 * ## Performance contract (FIL-239 budget)
 * - Zero allocations per frame (no tweens, no Array creation).
 * - Processes only sprites inside 2× camera viewport.
 * - Max 800 decorations total; typically 50–200 visible at any zoom.
 * - Math.sin calls: one per visible sprite per frame — negligible CPU.
 *
 * ## Biome amplitude table
 * Matches the "Wind Behavior by Biome" table in docs/wind-animation-design.md.
 */

import * as Phaser from 'phaser';
import type { WeatherCondition } from '../world/WorldState';

// ── Biome params ──────────────────────────────────────────────────────────────
// Sorted ascending by max elevation.  sampleBiomeParams() walks the table
// to find the entry whose maxElev ≥ the sampled elevation.

interface BiomeWindParams {
  maxElev:   number;  // upper elevation bound for this row
  amplitude: number;  // 0–1 normalised swing magnitude
  freqHz:    number;  // oscillations per second
}

const BIOME_TABLE: BiomeWindParams[] = [
  { maxElev: 0.28, amplitude: 0.00, freqHz: 0.00 }, // water — no sway
  { maxElev: 0.33, amplitude: 0.55, freqHz: 0.70 }, // sandy shore
  { maxElev: 0.50, amplitude: 0.50, freqHz: 0.55 }, // marsh / bog
  { maxElev: 0.65, amplitude: 0.60, freqHz: 0.80 }, // plains / coastal heath
  { maxElev: 0.78, amplitude: 0.25, freqHz: 0.40 }, // mixed forest
  { maxElev: 0.90, amplitude: 0.15, freqHz: 0.30 }, // dense spruce
  { maxElev: 0.96, amplitude: 0.70, freqHz: 1.00 }, // granite / highland
  { maxElev: 1.00, amplitude: 0.90, freqHz: 1.20 }, // snow / klipptoppen
];

/** Maximum pixel swing at amplitude = 1.0. */
const MAX_SWING_PX = 2.5;

/** Camera view multiplier — animate within 2× the visible area. */
const VIEW_MULT = 2.0;

// ── WeatherCondition → amplitude multiplier ───────────────────────────────────
const WEATHER_MULT: Record<WeatherCondition, number> = {
  clear: 1.00,
  rain:  1.35,
  ash:   0.90,
};

// ── WindSystem ────────────────────────────────────────────────────────────────

export class WindSystem {
  private readonly scene:       Phaser.Scene;
  private readonly decorImages: Phaser.GameObjects.Image[];
  /** Elevation grid from GameScene — same Float32Array passed to drawProceduralTerrain. */
  private readonly elevGrid:    Float32Array | null;
  /** Number of tile columns in the elevation grid. */
  private readonly gridW:       number;
  /** World pixels per tile (source 16 px × display scale 2 = 32 px). */
  private readonly tileSize:    number;
  /** Original y position for each decoration — restored when outside viewport. */
  private readonly baseY:       Map<Phaser.GameObjects.Image, number>;

  constructor(
    scene:       Phaser.Scene,
    decorImages: Phaser.GameObjects.Image[],
    elevGrid:    Float32Array | null,
    gridW:       number,
    tileSize    = 32,
  ) {
    this.scene       = scene;
    this.decorImages = decorImages;
    this.elevGrid    = elevGrid;
    this.gridW       = gridW;
    this.tileSize    = tileSize;

    // Snapshot each decoration's original y so we can restore it.
    this.baseY = new Map();
    for (const img of decorImages) {
      this.baseY.set(img, img.y);
    }
  }

  /**
   * Call from GameScene.update() every frame.
   *
   * @param timeSec       Elapsed game time in seconds (`game.loop.time * 0.001`).
   * @param corruption    Global corruption level 0–1 (0 = clean, 1 = full corruption).
   * @param weather       Current weather condition.
   */
  update(
    timeSec:    number,
    corruption  = 0,
    weather:    WeatherCondition = 'clear',
  ): void {
    const cam = this.scene.cameras.main;

    // World-space viewport bounds at 2× radius for the animation zone.
    const vw    = cam.width  / cam.zoom;
    const vh    = cam.height / cam.zoom;
    const pad   = Math.max(vw, vh) * (VIEW_MULT - 1) / 2;
    const left  = cam.scrollX - pad;
    const top   = cam.scrollY - pad;
    const right = cam.scrollX + vw + pad;
    const bot   = cam.scrollY + vh + pad;

    const wMult  = WEATHER_MULT[weather] ?? 1.0;
    // chaosLevel rises from 0 at corruption=0.3 to 1.0 at corruption=1.0.
    const chaosLevel = Math.max(0, (corruption - 0.3) / 0.7);

    for (const img of this.decorImages) {
      if (!img.active || !img.visible) continue;

      const by = this.baseY.get(img);
      if (by === undefined) continue;

      // Viewport cull — restore y for off-screen sprites and skip.
      if (img.x < left || img.x > right || img.y < top || img.y > bot) {
        if (img.y !== by) img.y = by;
        continue;
      }

      // ── Biome lookup ────────────────────────────────────────────────────
      const tx   = Math.floor(img.x / this.tileSize);
      const ty   = Math.floor(img.y / this.tileSize);
      const idx  = ty * this.gridW + tx;
      const elev = (this.elevGrid && idx >= 0 && idx < this.elevGrid.length)
        ? this.elevGrid[idx]
        : 0.60; // default to plains if grid unavailable

      const params = sampleBiomeParams(elev);
      if (params.amplitude < 0.01) {
        // No sway in water or zero-amplitude zones.
        if (img.y !== by) img.y = by;
        continue;
      }

      // ── Wind parameters (possibly chaos-boosted) ────────────────────────
      const amp  = lerp(params.amplitude * wMult, 0.80, chaosLevel);
      const freq = lerp(params.freqHz,            2.50, chaosLevel);

      // Position-based phase offset — neighbouring sprites swing out of sync
      // with each other, producing a natural ripple rather than a wall of
      // identical movement.
      const posPhase = img.x * 0.017 + img.y * 0.013;

      // In corrupted zones, inject a chaotic phase wobble driven by a fast
      // secondary sine to break the smooth periodicity.
      const chaosNoise = chaosLevel > 0
        ? Math.sin(timeSec * 7.3 + posPhase * 2.1) * chaosLevel * 1.2
        : 0;

      const swing = Math.sin(timeSec * freq * Math.PI * 2 + posPhase + chaosNoise)
        * MAX_SWING_PX * amp;

      img.y = by + swing;
    }
  }

  /**
   * Restore all decorations to their original y position.
   * Call when pausing or when the scene shuts down.
   */
  restore(): void {
    for (const [img, by] of this.baseY) {
      if (img.active) img.y = by;
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sampleBiomeParams(elev: number): BiomeWindParams {
  for (const row of BIOME_TABLE) {
    if (elev <= row.maxElev) return row;
  }
  return BIOME_TABLE[BIOME_TABLE.length - 1];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
