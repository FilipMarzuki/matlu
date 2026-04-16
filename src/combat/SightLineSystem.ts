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
