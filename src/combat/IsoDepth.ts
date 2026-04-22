/**
 * IsoDepth — per-frame painter-sort depth helper for ISO combat entities.
 *
 * Kept Phaser-free so it can be unit-tested in isolation. The structural
 * interface IsoSprite captures the only two methods this module needs; Phaser's
 * GameObjects.Sprite satisfies it structurally, so call sites that pass Sprite
 * arrays work without any cast.
 *
 * Iso Combat M1.2
 */

import { isoDepth, WORLD_TILE_SIZE } from '../lib/IsoTransform';

/**
 * Structural subset of Phaser.GameObjects.Sprite that updateIsoDepths requires.
 *
 * Declaring only the two methods we actually call keeps this module free of
 * Phaser imports, which means it can be exercised in a plain Node/vitest
 * environment without a browser or canvas.
 */
interface IsoSprite {
  /** Returns the value stored under `key` in the sprite's Data Manager. */
  getData(key: string | string[]): unknown;
  /** Sets the painter-sort depth; Phaser returns `this`, callers ignore it. */
  setDepth(value: number): unknown;
}

/**
 * Read a numeric value from a sprite's Data Manager, returning 0 if absent or
 * non-numeric (e.g. the key was never set via setData).
 */
function getNumber(sprite: IsoSprite, key: string): number {
  const v = sprite.getData(key);
  return typeof v === 'number' ? v : 0;
}

/**
 * Update the painter-sort depth for every sprite in `entities` each frame.
 *
 * Designed to be called in the scene's `update()` loop after physics:
 *   `updateIsoDepths(this.aliveEntities);`
 *
 * Performance: reads two/three numbers and sets one number per sprite — no
 * object allocation, no Phaser event emission. Safe to call for 50+ sprites
 * at 60 fps.
 *
 * Missing wx / wy / wz values default to 0 (ground level, world origin).
 *
 * @param entities — any iterable of sprites that carry wx/wy/wz in sprite.data
 */
export function updateIsoDepths(entities: Iterable<IsoSprite>): void {
  for (const sprite of entities) {
    const wx = getNumber(sprite, 'wx');
    const wy = getNumber(sprite, 'wy');
    const wz = getNumber(sprite, 'wz');
    // wz adds a small depth boost so an airborne entity renders in front of a
    // ground entity at the same (wx, wy). Divided by WORLD_TILE_SIZE keeps it
    // proportional to the tile-based depth scale used by isoDepth.
    sprite.setDepth(isoDepth(wx, wy) + wz / WORLD_TILE_SIZE);
  }
}
