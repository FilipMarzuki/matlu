/**
 * PathSystem — typed road segments that affect player speed and animal routing.
 *
 * ## Core idea
 * Roads are invisible axis-aligned rectangles with a "type" (dirt, forest path,
 * animal trail, paved) and a live "condition" value (0–100). Two things use them:
 *
 *  1. **Player speed** — `getSpeedMultiplier(x, y)` returns a 0.7–1.35 multiplier
 *     based on which segment the player is standing on and how worn it is.
 *
 *  2. **Animal affinity** — `getAffinityScore(x, y)` returns a positive score for
 *     animal trails (+1) and a negative score for paved roads (−1). Ground animals
 *     sample a few candidate roam directions and pick the highest-scoring one,
 *     so wildlife naturally clusters on paths without explicit waypoints.
 *
 * ## Why axis-aligned rects instead of tile lists?
 * The map is procedurally generated without a Tiled/LDtk path layer, so we define
 * roads as simple { x, y, w, h } bounding boxes in world coordinates. Lookup is a
 * linear scan over ~15 segments per frame — negligible cost.
 *
 * ## Condition degradation
 * Condition decreases slowly while zone corruption is high, recovers when the player
 * acts (kills a rabbit, picks up a collectible). Call `degradeAll(corruptionPct)` on
 * a timer and `restoreNear(x, y, radius, amount)` on player actions.
 */

export type PathType = 'dirt' | 'forest' | 'animal' | 'paved' | 'wading';

/** Static config for a path type — does not change at runtime. */
interface PathDefinition {
  /** Base speed multiplier at 100% condition */
  baseSpeedMult: number;
  /**
   * Animal affinity score. Positive → animals prefer this path.
   * Negative → animals avoid it. Used to bias roam direction selection.
   */
  animalAffinity: number;
  /**
   * How fast condition degrades per corruption-weighted tick.
   * Higher = crumbles faster. Animal trails (unpaved) crumble fastest.
   */
  conditionDecayRate: number;
  /** Color used when drawing the path on the terrain (as a Graphics overlay). */
  drawColor: number;
  drawAlpha: number;
}

const PATH_DEFS: Record<PathType, PathDefinition> = {
  dirt:   { baseSpeedMult: 1.10, animalAffinity:  0.3, conditionDecayRate: 1.0, drawColor: 0xb8905a, drawAlpha: 0.35 },
  forest: { baseSpeedMult: 0.90, animalAffinity:  0.5, conditionDecayRate: 1.1, drawColor: 0x507838, drawAlpha: 0.25 },
  animal: { baseSpeedMult: 1.00, animalAffinity:  1.0, conditionDecayRate: 1.3, drawColor: 0xa87848, drawAlpha: 0.20 },
  paved:  { baseSpeedMult: 1.35, animalAffinity: -1.0, conditionDecayRate: 0.7, drawColor: 0x989888, drawAlpha: 0.40 },
  // Wading: shallow river ford. Speed reduced to 55% — thigh-deep water resists movement.
  // Animals avoid water (negative affinity). Decay rate 0 — water is a permanent feature.
  wading: { baseSpeedMult: 0.55, animalAffinity: -0.3, conditionDecayRate: 0.0, drawColor: 0x5588cc, drawAlpha: 0.40 },
};

/** A single road segment — one axis-aligned rectangle in world space. */
export interface PathSegment {
  id: string;
  type: PathType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 0–100. Lower = worn-out road, slower and less animal-friendly. */
  condition: number;
}

export class PathSystem {
  private segments: PathSegment[];

  constructor(segments: PathSegment[]) {
    this.segments = segments;
  }

  /** Return the segment the point (wx, wy) falls inside, or null. */
  getSegmentAt(wx: number, wy: number): PathSegment | null {
    for (const seg of this.segments) {
      if (wx >= seg.x && wx <= seg.x + seg.w &&
          wy >= seg.y && wy <= seg.y + seg.h) {
        return seg;
      }
    }
    return null;
  }

  /**
   * Speed multiplier for a player standing at (wx, wy).
   * Off-road returns 1.0 (base speed, no bonus or penalty).
   *
   * Formula: baseSpeedMult × conditionFactor
   * conditionFactor = 0.5 + (condition / 100) × 0.5
   * → At 100% condition: full base mult (1.35 for paved)
   * → At   0% condition: half the base mult (0.675 for paved)
   */
  getSpeedMultiplier(wx: number, wy: number): number {
    const seg = this.getSegmentAt(wx, wy);
    if (!seg) return 1.0;
    const def = PATH_DEFS[seg.type];
    const conditionFactor = 0.5 + (seg.condition / 100) * 0.5;
    return def.baseSpeedMult * conditionFactor;
  }

  /**
   * Animal affinity score at (wx, wy).
   * Used by ground animals to bias their roam direction.
   * Returns 0 off-road, positive on animal trails, negative on paved roads.
   */
  getAffinityScore(wx: number, wy: number): number {
    const seg = this.getSegmentAt(wx, wy);
    if (!seg) return 0;
    return PATH_DEFS[seg.type].animalAffinity;
  }

  /**
   * Degrade all segment conditions based on current corruption level.
   * Call this every ~5 seconds while corruption > 0.
   *
   * @param corruptionPct 0–100
   */
  degradeAll(corruptionPct: number): void {
    if (corruptionPct <= 0) return;
    const factor = corruptionPct / 100;
    for (const seg of this.segments) {
      const decay = factor * PATH_DEFS[seg.type].conditionDecayRate * 2;
      seg.condition = Math.max(0, seg.condition - decay);
    }
  }

  /**
   * Degrade segment conditions using per-position local corruption intensity.
   * Accepts a callback so PathSystem stays decoupled from CorruptionField.
   *
   * `getLocalCorruption(cx, cy)` should return a 0–1 value for the segment
   * centre. Segments deep inside a corruption hotspot degrade faster than
   * segments in cleaner areas, giving roads organic wear patterns.
   *
   * @param getLocalCorruption  Function returning 0–1 intensity at (cx, cy)
   */
  degradeLocal(getLocalCorruption: (cx: number, cy: number) => number): void {
    for (const seg of this.segments) {
      const cx = seg.x + seg.w / 2;
      const cy = seg.y + seg.h / 2;
      const factor = getLocalCorruption(cx, cy);
      if (factor <= 0) continue;
      const decay = factor * PATH_DEFS[seg.type].conditionDecayRate * 2;
      seg.condition = Math.max(0, seg.condition - decay);
    }
  }

  /**
   * Restore condition for all segments within `radius` pixels of (wx, wy).
   * Call on player actions (rabbit kill, item pickup).
   */
  restoreNear(wx: number, wy: number, radius: number, amount: number): void {
    for (const seg of this.segments) {
      const cx = seg.x + seg.w / 2;
      const cy = seg.y + seg.h / 2;
      const dist = Math.sqrt((cx - wx) ** 2 + (cy - wy) ** 2);
      if (dist <= radius) {
        seg.condition = Math.min(100, seg.condition + amount);
      }
    }
  }

  /**
   * Draw all path segments as semi-transparent rectangles onto a Graphics object.
   * Can be called repeatedly — clears before redrawing, so condition changes are reflected.
   *
   * Color fades toward muted gray (0x888888) as condition drops from 100 → 0, giving
   * the player a subtle visual cue that roads are degrading under corruption.
   */
  drawPaths(graphics: Phaser.GameObjects.Graphics): void {
    graphics.clear();
    for (const seg of this.segments) {
      const def = PATH_DEFS[seg.type];
      const t = seg.condition / 100; // 1 = full health, 0 = worn out

      // Lerp each channel toward gray (0x88, 0x88, 0x88) as condition degrades
      const r0 = (def.drawColor >> 16) & 0xff;
      const g0 = (def.drawColor >>  8) & 0xff;
      const b0 =  def.drawColor        & 0xff;
      const gray = 0x88;
      const r = Math.round(r0 * t + gray * (1 - t));
      const g = Math.round(g0 * t + gray * (1 - t));
      const b = Math.round(b0 * t + gray * (1 - t));
      const blendedColor = (r << 16) | (g << 8) | b;

      // Also reduce alpha when worn — barely visible paths feel abandoned
      const alpha = def.drawAlpha * (0.5 + t * 0.5);

      graphics.fillStyle(blendedColor, alpha);
      graphics.fillRect(seg.x, seg.y, seg.w, seg.h);
    }
  }

  /**
   * Reposition a segment by ID with new bounds.
   *
   * Used by GameScene to patch the wading ford segments (river-a-wading,
   * river-b-wading) after `initRiverTileGrids()` computes the actual diagonal
   * river positions at runtime — those positions depend on the elevation grid and
   * can't be hardcoded in Level1Paths.ts.
   *
   * @param id  Segment ID to update (no-op if not found).
   * @param x   New left edge in world pixels.
   * @param y   New top edge in world pixels.
   * @param w   New width in pixels.
   * @param h   New height in pixels.
   */
  updateSegmentBounds(id: string, x: number, y: number, w: number, h: number): void {
    const seg = this.segments.find(s => s.id === id);
    if (!seg) return;
    seg.x = x;
    seg.y = y;
    seg.w = w;
    seg.h = h;
  }

  getSegments(): PathSegment[] {
    return this.segments;
  }
}
