/**
 * CombatPhysics — low-level helpers for the ISO combat system.
 *
 * ## What this module does
 *
 * Wraps Phaser's Arcade physics API to operate in **world space**:
 * physics bodies live at (wx, wy) world-pixel coordinates and know nothing
 * about isometric screen coordinates.  The visual side (where sprites appear
 * on screen and at what depth) is handled separately by `syncSpriteToWorld`
 * and `updateIsoDepths`, which read the same world coords and project them
 * through `worldToIso` / `isoDepth` only for display purposes.
 *
 * This separation is the core design of ISO Combat M1:
 *   - Physics   ← world space  (wx, wy)
 *   - Rendering ← iso space    (sx, sy = worldToIso(wx, wy))
 *   - Depth     ← isoDepth(wx, wy) + wz offset
 *
 * ## Usage
 *
 * ```ts
 * // On entity creation:
 * createEntityBody(scene, sprite, { footRadius: 8, wx: 100, wy: 200 });
 *
 * // On wall creation:
 * createWallBody(scene, wallGroup, { wx: 0, wy: 0, w: 16, h: 960 });
 *
 * // Each frame, after physics has moved bodies:
 * syncSpriteToWorld(sprite);
 *
 * // Or batch-update depth for many entities at once:
 * updateIsoDepths(aliveEntities);
 * ```
 *
 * ## Why sprite.data for world coords?
 *
 * Phaser's `sprite.x / sprite.y` are screen coordinates (iso-projected).
 * Storing wx/wy/wz in the sprite's Data Manager means callers can read them
 * without knowing the iso projection formula, and the data survives any
 * Phaser internal repositioning (camera scroll, container offsets, etc.).
 *
 * Iso Combat M1 — no call sites yet. This module is prepped for M2 wiring.
 */

import * as Phaser from 'phaser';
import { worldToIso, isoDepth, WORLD_TILE_SIZE } from '../lib/IsoTransform';
export { updateIsoDepths } from './IsoDepth';

// ── Entity body ───────────────────────────────────────────────────────────────

/** Config for attaching an arcade circle body to an entity sprite. */
export interface EntityBodyConfig {
  /** Circle radius in world-space pixels. Physics collision uses this size. */
  footRadius: number;
  /** Initial world-space X (will be stored in sprite.data and body position). */
  wx: number;
  /** Initial world-space Y (will be stored in sprite.data and body position). */
  wy: number;
  /**
   * Initial world-space Z height in pixels.
   * Used for painter-sort depth offset only — not a physics dimension.
   * 0 = ground level (default). Positive values lift the sprite visually.
   */
  wz?: number;
}

/**
 * Attach an Arcade physics circle body to `sprite` and store world-space
 * coordinates in its Data Manager.
 *
 * The sprite's display position is NOT updated here — call
 * `syncSpriteToWorld(sprite)` immediately after placement to project the
 * initial world coords to iso screen coords.
 *
 * Why a circle? Circle bodies resolve correctly against AABB walls in Arcade
 * physics and avoid the corner-catching that rectangle bodies produce when
 * sliding along iso-aligned corridors.
 *
 * @param scene  — the Phaser scene that owns the physics world
 * @param sprite — the sprite game object to attach physics to
 * @param cfg    — world-space position and circle radius
 */
export function createEntityBody(
  scene:  Phaser.Scene,
  sprite: Phaser.GameObjects.Sprite,
  cfg:    EntityBodyConfig,
): void {
  scene.physics.add.existing(sprite);
  const body = sprite.body as Phaser.Physics.Arcade.Body;

  // Circle body: radius r, offset (-r, -r) centres it on the sprite origin.
  // Phaser's setCircle(r, offsetX, offsetY) offsets from top-left, so
  // offsetting by (-r, -r) centres the circle when sprite origin is (0.5, 0.5).
  body.setCircle(cfg.footRadius, -cfg.footRadius, -cfg.footRadius);

  // Store world coords in Data Manager — this is the canonical position source.
  // Physics body.x/y mirror these but may lag by one frame during resolution.
  sprite.setData('wx', cfg.wx);
  sprite.setData('wy', cfg.wy);
  sprite.setData('wz', cfg.wz ?? 0);

  // Teleport the physics body to the initial world position.
  body.reset(cfg.wx, cfg.wy);
}

// ── Wall body ─────────────────────────────────────────────────────────────────

/** Config for a static AABB wall collision body. */
export interface WallBodyConfig {
  /** World-space X of the top-left corner of the wall rectangle. */
  wx: number;
  /** World-space Y of the top-left corner of the wall rectangle. */
  wy: number;
  /** Width of the wall in world-space pixels. */
  w:  number;
  /** Height of the wall in world-space pixels. */
  h:  number;
}

/**
 * Add a static AABB wall body to a StaticGroup in world space.
 *
 * Walls are axis-aligned rectangles in world coordinates — NOT iso diamonds.
 * Collision detection and resolution always happen in world space; the
 * isometric visuals are a rendering concern only.
 *
 * Using `scene.add.zone` (an invisible game object with no texture) keeps
 * wall bodies out of the display list while still participating in Arcade
 * physics overlaps and colliders.
 *
 * @param scene  — the Phaser scene that owns the physics world
 * @param group  — StaticGroup to add the wall body to
 * @param cfg    — top-left corner + dimensions in world-space pixels
 */
export function createWallBody(
  scene:  Phaser.Scene,
  group:  Phaser.Physics.Arcade.StaticGroup,
  cfg:    WallBodyConfig,
): void {
  // Zone positioned at the rectangle's centre (Arcade bodies are centre-anchored).
  const cx = cfg.wx + cfg.w / 2;
  const cy = cfg.wy + cfg.h / 2;

  const zone = scene.add.zone(cx, cy, cfg.w, cfg.h);
  group.add(zone);

  // StaticBody must be refreshed after repositioning — reset() does both.
  (zone.body as Phaser.Physics.Arcade.StaticBody).reset(cx, cy);
}

// ── Iso visual sync ───────────────────────────────────────────────────────────

/**
 * Project a sprite's world-space position to isometric screen coordinates and
 * update its display position and painter-sort depth.
 *
 * Call once per frame after physics has resolved body movement:
 *   1. Read (wx, wy, wz) from sprite.data.
 *   2. Project via worldToIso → set sprite.x, sprite.y.
 *   3. Subtract wz from screen y so the sprite appears "above ground".
 *   4. Compute depth so sprites behind (lower wx+wy) render first.
 *
 * @param sprite — any sprite whose Data Manager holds 'wx', 'wy', 'wz'
 */
export function syncSpriteToWorld(sprite: Phaser.GameObjects.Sprite): void {
  const wx: number = sprite.getData('wx') ?? 0;
  const wy: number = sprite.getData('wy') ?? 0;
  const wz: number = sprite.getData('wz') ?? 0;

  const { x, y } = worldToIso(wx, wy);

  // wz lifts the sprite on screen — a positive z-height shifts y up by wz px.
  sprite.setPosition(x, y - wz);

  // Depth: lower wx+wy = further north = drawn first (behind).
  // wz contributes a small depth boost so a flying entity appears in front of
  // ground entities at the same (wx, wy) — divided by WORLD_TILE_SIZE to keep
  // the z offset proportional to the tile-based depth scale.
  sprite.setDepth(isoDepth(wx, wy) + wz / WORLD_TILE_SIZE);
}

// updateIsoDepths is exported above (re-exported from ./IsoDepth) so it is
// available to callers that import from CombatPhysics.
