/**
 * Phaser-facing loader for dialog tree JSON files (#946).
 *
 * Files live under `public/data/dialog/<id>.json` and are served at the site
 * root, so dropping a new file there — with a matching `id` field inside —
 * is all a non-dev needs to do to add a new dialog tree. No TypeScript change
 * is required to author or edit dialog content.
 */

import * as Phaser from 'phaser';
import { validateDialogTree, type DialogTree } from './dialogTree';

/** Cache key NpcDialogScene / GameScene use to read back a loaded tree. */
export function dialogCacheKey(id: string): string {
  return `dialog-${id}`;
}

/** Queues a dialog tree JSON file for loading. Call during a scene's preload(). */
export function queueDialogTreeLoad(scene: Phaser.Scene, id: string): void {
  scene.load.json(dialogCacheKey(id), `data/dialog/${id}.json`);
}

/**
 * Reads a previously-queued dialog tree back out of the Phaser JSON cache and
 * validates its shape. Throws if the file failed the load-time shape check —
 * callers run this once at startup so a malformed file fails loudly.
 */
export function getDialogTree(scene: Phaser.Scene, id: string): DialogTree {
  const data: unknown = scene.cache.json.get(dialogCacheKey(id));
  const errors = validateDialogTree(data);
  if (errors.length > 0) {
    throw new Error(`Invalid dialog tree "${id}": ${errors.join('; ')}`);
  }
  return data as DialogTree;
}
