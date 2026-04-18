import * as Phaser from 'phaser';
export { calcSpread, applySpread, SPREAD_MIN_RAD, SPREAD_RANGE_RAD, RANGE_REFERENCE_PX, SPREAD_MOVE_RAD, SPREAD_COVER_RAD } from './AccuracyMath';

/**
 * How far (px) to offset the probe rays when checking partial cover.
 * 20 px ≈ one character-width — wide enough to catch adjacent walls without
 * false-positives from distant parallel surfaces.
 */
const COVER_PROBE_OFFSET_PX = 20;

/**
 * Detect whether the target has partial cover — a wall lies close to but not
 * on the direct LoS line.
 *
 * Two probe rays are cast parallel to the main shot line, offset by
 * ±COVER_PROBE_OFFSET_PX perpendicularly. If either probe hits a wall the
 * centre ray missed, the target is considered partially covered.
 *
 * This models a shooter peeking around a corner: they can see the target but
 * cannot draw a clean bead, so their accuracy suffers.
 *
 * Pass `this.wallRects` from inside CombatEntity — it's the same array the
 * LoS check uses, so the two systems stay in sync.
 *
 * @param fromX     Shooter world X.
 * @param fromY     Shooter world Y.
 * @param toX       Target world X.
 * @param toY       Target world Y.
 * @param wallRects Arena obstacle rectangles (walls, pillars).
 */
export function isPartialCover(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  wallRects: readonly Phaser.Geom.Rectangle[],
): boolean {
  if (wallRects.length === 0) return false;

  const dx  = toX - fromX;
  const dy  = toY - fromY;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  // Perpendicular unit vector (90° rotated from the shot direction).
  const perpX = -dy / len;
  const perpY =  dx / len;

  for (const offset of [-COVER_PROBE_OFFSET_PX, COVER_PROBE_OFFSET_PX]) {
    const line = new Phaser.Geom.Line(
      fromX + perpX * offset, fromY + perpY * offset,
      toX   + perpX * offset, toY   + perpY * offset,
    );
    for (const rect of wallRects) {
      if (Phaser.Geom.Intersects.LineToRectangle(line, rect)) {
        return true;
      }
    }
  }

  return false;
}
