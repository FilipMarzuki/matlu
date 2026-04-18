import * as Phaser from 'phaser';

/**
 * How often (ms) each enemy rechecks line of sight. Exported so subclasses can
 * reference it in comments — the actual scheduling lives in CombatEntity.
 */
export const SIGHT_CHECK_INTERVAL_MS = 150;

/**
 * Returns true when there is an unobstructed straight-line path from (ax, ay)
 * to (bx, by) against the given static physics obstacle group.
 *
 * The check uses Phaser's built-in segment-vs-rectangle intersection test on
 * every body in the group. This is fast for a small number of obstacles (arena
 * pillars and walls number in the low dozens).
 *
 * When the obstacles group is empty (arena with no cover), the function always
 * returns true — enemies behave exactly as before. This satisfies the
 * acceptance criterion: "Arena combat still functions when there are no
 * obstacles (sight always clear)."
 *
 * Why raycasting instead of Phaser's overlap/intersects helpers?
 * Arcade physics doesn't expose ray-vs-world queries at runtime, so we iterate
 * the static bodies manually. For <50 obstacles this is negligible compared to
 * the physics broadphase already running each frame.
 *
 * @param ax        - ray origin X (enemy world position)
 * @param ay        - ray origin Y (enemy world position)
 * @param bx        - ray target X (player/target world position)
 * @param by        - ray target Y (player/target world position)
 * @param obstacles - arena's static physics group (pillars, walls, corners)
 */
export function hasLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  obstacles: Phaser.Physics.Arcade.StaticGroup,
): boolean {
  const line = new Phaser.Geom.Line(ax, ay, bx, by);

  for (const child of obstacles.getChildren()) {
    // Each child is a GameObject added to the static group by the arena builder.
    // The arcade physics body sits at body.x/y (top-left), not go.x/go.y
    // (which is the transform origin — often the visual center).
    const body = (child as { body?: Phaser.Physics.Arcade.StaticBody }).body;
    if (!body) continue;

    const rect = new Phaser.Geom.Rectangle(body.x, body.y, body.width, body.height);
    if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) {
      return false; // an obstacle blocks the sight line
    }
  }

  return true; // no obstacle intersected — clear line of sight
}

// ── Illumination sampling ─────────────────────────────────────────────────────

/**
 * Ambient luminance of the dungeon scene derived from its ambient color 0x1e1610.
 * R=30, G=22, B=16 → luminance = (30·0.2126 + 22·0.7152 + 16·0.0722) / 255 ≈ 0.091.
 * Used as the darkness floor — the scene is never completely pitch black.
 */
const DUNGEON_AMBIENT = 0.091;

/**
 * Samples the illumination level [0, 1] at world position (x, y) by summing
 * contributions from all registered Phaser point lights using the same
 * quadratic attenuation formula the Light2D shader applies:
 *
 *   contribution = (1 − dist / radius)² × intensity
 *
 * Returns 1 when the scene has no point lights (e.g. non-dungeon scenes that
 * never called `this.lights.enable()`) — no lights present means no penalty.
 *
 * Intended to be called at the 150 ms sight-check interval (not every frame),
 * so the per-entity cost is trivial even with 10+ lights in the scene.
 */
export function sampleIllumination(scene: Phaser.Scene, x: number, y: number): number {
  // LightsPlugin (extends LightsManager) exposes `.lights` as a public array
  // of all registered Phaser.GameObjects.Light instances.
  const allLights =
    (scene.lights as unknown as { lights: Phaser.GameObjects.Light[] }).lights ?? [];
  if (allLights.length === 0) return 1; // scene not using point lights — no effect

  let total = DUNGEON_AMBIENT;
  for (const light of allLights) {
    const dist = Phaser.Math.Distance.Between(light.x, light.y, x, y);
    if (dist >= light.radius) continue;
    const t = 1 - dist / light.radius;
    total += t * t * light.intensity; // quadratic falloff — matches Light2D shader
  }
  return Math.min(1, total);
}
