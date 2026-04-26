/**
 * Biome → tile-pack mapping, plus the shared preloader that all scenes
 * which render iso terrain (GameScene, CombatArenaScene, WorldForgeScene,
 * SettlementScene) call from `preload()`.
 *
 * Each pack ships 4 individual PNGs (0–3) under
 * `public/assets/packs/<pack-name>-tiles/<i>.png`. They are loaded as
 * single-image textures keyed `${packName}-${i}` so renderers can call
 * `setTexture(`${packName}-${tileHash}`)` directly without a frame index.
 *
 * Biome 0 (Sea) is intentionally absent — the ocean strip renderer handles
 * it separately.
 *
 * Single source of truth: keep this file in sync with `src/world/biomes.ts`.
 * Adding a new biome with custom art? Add the entry here AND make sure the
 * pack folder exists under `public/assets/packs/`.
 */

import type * as Phaser from 'phaser';

export const CUSTOM_TILE_PACKS: Record<number, string> = {
  1:  'rocky-shore',
  2:  'sandy-shore',
  3:  'marsh',
  4:  'dry-heath',
  5:  'coastal-heath',
  6:  'meadow',
  7:  'forest',
  8:  'spruce',
  9:  'cold-granite',
  10: 'bare-summit',
  11: 'snow-field',
};

/** Number of tile variants per pack (0.png … 3.png). */
export const TILE_VARIANTS_PER_PACK = 4;

/**
 * Queue all biome floor-tile images on the scene's loader. Call from
 * `preload()` — Phaser will resolve the images before `create()` runs.
 *
 * Texture keys are `${packName}-0` … `${packName}-3`.
 */
export function preloadTilePacks(scene: Phaser.Scene): void {
  for (const packName of Object.values(CUSTOM_TILE_PACKS)) {
    for (let i = 0; i < TILE_VARIANTS_PER_PACK; i++) {
      scene.load.image(`${packName}-${i}`, `/assets/packs/${packName}-tiles/${i}.png`);
    }
  }
}
