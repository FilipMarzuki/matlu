/**
 * LPC spritesheet animation helper.
 *
 * The Universal LPC Spritesheet Generator outputs a single PNG with all
 * animations laid out in rows of 64×64 px frames.  This utility registers
 * Phaser animations from that sheet using the {key}_{state}_{dir} naming
 * convention expected by CombatEntity.updateSpriteAnimation() and HumanoidNPC.
 *
 * ## Standard LPC layout (Universal LPC Spritesheet Generator)
 *
 *   Frame size : 64 × 64 px
 *   Sheet width: 832 px  (13 cols — shoot row is the widest)
 *
 *   Animation block        Start row   Frames per dir
 *   ─────────────────────  ─────────   ──────────────
 *   Spellcast              0           7
 *   Thrust                 4           8
 *   Walk                   8           9
 *   Slash (attack)         12          6
 *   Shoot                  16          13
 *   Hurt / die             20          6
 *
 *   Direction order within each 4-row block:
 *     +0 = North (facing up)
 *     +1 = West  (facing left)
 *     +2 = South (facing down — most common "default" pose)
 *     +3 = East  (facing right)
 *
 * ## Verification tip
 *
 * Open your sheet in an image editor.  Row 0, frame 0 should show the
 * character mid-cast facing UPWARD.  Row 2 should face the camera (south).
 * Row 3 should face right (east).  If your sheet uses a different order,
 * edit the `DIR` constant below to match.
 *
 * ## Usage
 *
 *   // In preload():
 *   this.load.spritesheet('guard', 'assets/sprites/characters/humanoid/guard.png', {
 *     frameWidth:  LPC_FRAME_W,
 *     frameHeight: LPC_FRAME_H,
 *   });
 *
 *   // In create():
 *   registerLpcAnims(this.anims, 'guard');
 */

import * as Phaser from 'phaser';

export const LPC_FRAME_W = 64;
export const LPC_FRAME_H = 64;

/** Number of columns in a standard LPC sheet (shoot row = 13 frames). */
const LPC_COLS = 13;

/**
 * Row offsets within each 4-row animation block, keyed by the direction names
 * used by CombatEntity / HumanoidNPC.  West and its diagonals are handled by
 * setFlipX() in those classes, so we only register right-side & cardinal dirs.
 *
 * Change these if your sheet uses a different direction order.
 */
const DIR: Record<string, number> = {
  'north':      0,   // +0 row = facing up
  'south':      2,   // +2 row = facing camera
  'east':       3,   // +3 row = facing right
  'south-east': 2,   // diagonal → nearest cardinal (south)
  'north-east': 0,   // diagonal → nearest cardinal (north)
};

/** Frame indices for one row: `startRow * LPC_COLS + 0 … frameCount-1`. */
function rowFrames(startRow: number, frameCount: number): number[] {
  return Array.from({ length: frameCount }, (_, i) => startRow * LPC_COLS + i);
}

/**
 * Register all animation keys for an LPC spritesheet.
 *
 * @param anims     The scene's `Phaser.Animations.AnimationManager`
 * @param key       The spritesheet key used in `load.spritesheet()`
 * @param frameRate Base walk frame rate (default 9 fps); attack runs faster
 */
export function registerLpcAnims(
  anims:     Phaser.Animations.AnimationManager,
  key:       string,
  frameRate  = 9,
): void {
  // Skip if already registered (scene restart safety).
  if (anims.exists(`${key}_walk_south`)) return;

  const WALK_START  = 8;
  const WALK_FRAMES = 9;
  const SLASH_START = 12;
  const SLASH_FRAMES = 6;
  const HURT_START  = 20;
  const HURT_FRAMES = 6;

  for (const [dir, rowOffset] of Object.entries(DIR)) {
    // ── Walk ──────────────────────────────────────────────────────────────────
    anims.create({
      key:       `${key}_walk_${dir}`,
      frames:    anims.generateFrameNumbers(key, {
        frames: rowFrames(WALK_START + rowOffset, WALK_FRAMES),
      }),
      frameRate,
      repeat:    -1,
    });

    // ── Idle — first frame of the walk row (standing pose). ───────────────────
    // LPC has no dedicated idle; the stand frame is frame 0 of walk.
    anims.create({
      key:       `${key}_idle_${dir}`,
      frames:    anims.generateFrameNumbers(key, {
        frames: [(WALK_START + rowOffset) * LPC_COLS],
      }),
      frameRate: 1,
      repeat:    -1,
    });

    // ── Attack (slash) ────────────────────────────────────────────────────────
    anims.create({
      key:       `${key}_attack_${dir}`,
      frames:    anims.generateFrameNumbers(key, {
        frames: rowFrames(SLASH_START + rowOffset, SLASH_FRAMES),
      }),
      frameRate: frameRate * 1.5,  // attacks play faster than walk
      repeat:    0,
    });

    // ── Death — hurt row (south-only in LPC, mirrored to all dirs) ────────────
    anims.create({
      key:       `${key}_death_${dir}`,
      frames:    anims.generateFrameNumbers(key, {
        frames: rowFrames(HURT_START, HURT_FRAMES),
      }),
      frameRate: 8,
      repeat:    0,
    });
  }
}
