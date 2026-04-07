/**
 * PathSystem — manages path types, conditions, and movement modifiers (FIL-33).
 *
 * Paths in Matlu are not static tiles but living data that degrades with
 * corruption and improves when the player cleanses the world.
 *
 * Four path types exist, each with different speed bonuses, animal affinity,
 * enemy patrol behaviour, and weather responses.
 *
 * ## Usage
 * ```ts
 * const ps = new PathSystem();
 * ps.addSegment({ id: 'road-1', type: 'dirt', rect: { x: 0, y: 950, w: 600, h: 80 } });
 *
 * // In update():
 * const multiplier = ps.getSpeedMultiplier(player.x, player.y, 'clear');
 * const speed = PLAYER_SPEED * multiplier;
 * ```
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PathType = 'animal' | 'forest' | 'dirt' | 'paved';

export type CurveStyle = 'organic' | 'intentional' | 'straight' | 'grid';

export type WeatherCondition = 'clear' | 'rain' | 'ash';

export interface PathDefinition {
  type:                PathType;
  baseSpeedMultiplier: number;           // at 100% condition, clear weather
  widthTiles:          number;           // average tile width
  curveStyle:          CurveStyle;
  animalAffinity:      number;           // –1 to +1: animals prefer positive values
  enemyPatrol:         boolean;
  conditionDecayRate:  number;           // multiplier on corruption influence
  weatherMultipliers:  Record<WeatherCondition, number>;
  decorations:         string[];         // tile keys for detail props
}

export const PATH_DEFS: Record<PathType, PathDefinition> = {
  animal: {
    type:                'animal',
    baseSpeedMultiplier: 1.15,
    widthTiles:          1.5,
    curveStyle:          'organic',
    animalAffinity:      1,
    enemyPatrol:         false,
    conditionDecayRate:  1.25,
    weatherMultipliers:  { clear: 1.15, rain: 1.10, ash: 1.05 },
    decorations:         ['pawprint', 'trampled-flower', 'burrow-hole'],
  },
  forest: {
    type:                'forest',
    baseSpeedMultiplier: 1.20,
    widthTiles:          2.5,
    curveStyle:          'intentional',
    animalAffinity:      0,
    enemyPatrol:         true,
    conditionDecayRate:  1.0,
    weatherMultipliers:  { clear: 1.20, rain: 1.15, ash: 1.10 },
    decorations:         ['axe-mark', 'crude-marker', 'dropped-item'],
  },
  dirt: {
    type:                'dirt',
    baseSpeedMultiplier: 1.25,
    widthTiles:          4,
    curveStyle:          'straight',
    animalAffinity:      -0.5,
    enemyPatrol:         true,
    conditionDecayRate:  0.9,
    weatherMultipliers:  { clear: 1.25, rain: 0.90, ash: 0.80 },
    decorations:         ['wheel-rut', 'footprint-cluster', 'milestone'],
  },
  paved: {
    type:                'paved',
    baseSpeedMultiplier: 1.35,
    widthTiles:          5,
    curveStyle:          'grid',
    animalAffinity:      -1,
    enemyPatrol:         true,
    conditionDecayRate:  0.7,
    weatherMultipliers:  { clear: 1.35, rain: 1.35, ash: 1.25 },
    decorations:         ['glyph', 'pillar', 'crest', 'torch-sconce'],
  },
};

// ─── PathSegment ─────────────────────────────────────────────────────────────

/**
 * A single named path segment in the world.
 *
 * Rather than a tile list (used in the LDtk path), segments here are defined
 * by an axis-aligned bounding rect for efficient hit testing. For diagonal or
 * curved paths, break them into several shorter segments.
 */
export interface PathSegmentRect {
  /** World X of the top-left corner */
  x: number;
  /** World Y of the top-left corner */
  y: number;
  w: number;
  h: number;
}

export interface PathSegment {
  id:        string;
  type:      PathType;
  rect:      PathSegmentRect;
  condition: number;              // 0–100, starts at 100
  underlay:  PathType | null;     // older road underneath — null if none
  crossings: string[];            // IDs of segments that cross this one
}

// ─── PathSystem ──────────────────────────────────────────────────────────────

export class PathSystem {
  private segments: Map<string, PathSegment> = new Map();

  // ── Manual / programmatic loading ──────────────────────────────────────────

  /**
   * Register a path segment from code (e.g. from Level1Paths.ts).
   * Duplicate IDs are silently overwritten.
   */
  addSegment(def: Omit<PathSegment, 'condition' | 'crossings'>): void {
    const seg: PathSegment = { ...def, condition: 100, crossings: [] };
    this.segments.set(seg.id, seg);
    this.detectCrossings();
  }

  /**
   * Register multiple segments at once. Convenience wrapper around addSegment.
   */
  addSegments(defs: Array<Omit<PathSegment, 'condition' | 'crossings'>>): void {
    defs.forEach(d => {
      const seg: PathSegment = { ...d, condition: 100, crossings: [] };
      this.segments.set(seg.id, seg);
    });
    this.detectCrossings();
  }

  // ── LDtk loading (future-facing) ───────────────────────────────────────────

  /**
   * Load path segments from an LDtk entity layer.
   * Expects entities with __identifier === 'PathSegment' and fields:
   *   PathType (enum), Rect ({x,y,w,h}), Underlay (optional enum)
   */
  loadFromLDtk(entities: unknown[]): void {
    (entities as Array<Record<string, unknown>>)
      .filter(e => e['__identifier'] === 'PathSegment')
      .forEach(e => {
        type FieldInstance = { __identifier: string; __value: unknown };
        const fields = e['fieldInstances'] as FieldInstance[];
        const field  = (key: string) =>
          fields.find(f => f.__identifier === key)?.__value;

        const rawRect = field('Rect') as { x: number; y: number; w: number; h: number } | undefined;
        if (!rawRect) return;

        const seg: PathSegment = {
          id:        e['iid'] as string,
          type:      field('PathType') as PathType,
          rect:      rawRect,
          condition: 100,
          underlay:  (field('Underlay') as PathType | null) ?? null,
          crossings: [],
        };
        this.segments.set(seg.id, seg);
      });

    this.detectCrossings();
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  /** Return the topmost (first matched) segment at a world position, or null. */
  getSegmentAt(worldX: number, worldY: number): PathSegment | null {
    for (const seg of this.segments.values()) {
      const r = seg.rect;
      if (worldX >= r.x && worldX <= r.x + r.w &&
          worldY >= r.y && worldY <= r.y + r.h) {
        return seg;
      }
    }
    return null;
  }

  /**
   * Speed multiplier at a world position.
   * Returns 1.0 when not on any path.
   * Condition scales between 0.5× (fully degraded) and 1.0× of the weather speed.
   */
  getSpeedMultiplier(
    worldX: number,
    worldY: number,
    weather: WeatherCondition = 'clear',
  ): number {
    const seg = this.getSegmentAt(worldX, worldY);
    if (!seg) return 1.0;

    const def            = PATH_DEFS[seg.type];
    const weatherSpeed   = def.weatherMultipliers[weather];
    const conditionFactor = this.conditionToFactor(seg.condition);

    // Full formula: weather-adjusted speed × condition factor.
    // e.g. paved at 100% condition, clear weather = 1.35 × 1.0 = 1.35
    //      paved at   0% condition, clear weather = 1.35 × 0.5 = 0.675
    return weatherSpeed * conditionFactor;
  }

  /**
   * Animal affinity score at a world position (–1 to +1).
   * Animals should prefer paths with high affinity (animal trails)
   * and avoid paths with low affinity (paved roads).
   * Returns 0 when not on any path.
   */
  getAnimalAffinity(worldX: number, worldY: number): number {
    const seg = this.getSegmentAt(worldX, worldY);
    if (!seg) return 0;
    return PATH_DEFS[seg.type].animalAffinity;
  }

  /**
   * Whether enemies should patrol along the segment at this position.
   * Returns false when not on any path.
   */
  shouldEnemyPatrol(worldX: number, worldY: number): boolean {
    const seg = this.getSegmentAt(worldX, worldY);
    if (!seg) return false;
    return PATH_DEFS[seg.type].enemyPatrol;
  }

  /** All crossing points in the world — useful for placing landmark objects. */
  getCrossings(): Array<{ x: number; y: number; types: PathType[] }> {
    const result: Array<{ x: number; y: number; types: PathType[] }> = [];

    this.segments.forEach(seg => {
      seg.crossings.forEach(otherId => {
        const other = this.segments.get(otherId);
        if (!other) return;

        const ix = this.rectIntersect(seg.rect, other.rect);
        if (ix) {
          // Use centre of the intersection rect as the crossing point
          result.push({
            x:     ix.x + ix.w / 2,
            y:     ix.y + ix.h / 2,
            types: [seg.type, other.type],
          });
        }
      });
    });

    // Deduplicate (each pair is detected from both sides)
    const seen = new Set<string>();
    return result.filter(c => {
      const key = `${Math.round(c.x)},${Math.round(c.y)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Condition management ───────────────────────────────────────────────────

  /**
   * Degrade a segment's condition based on zone corruption.
   * Called periodically (e.g. every second) by GameScene.
   *
   * @param segmentId    ID of the segment to degrade
   * @param corruption   Zone corruption 0–1
   */
  degradeCondition(segmentId: string, corruption: number): void {
    const seg = this.segments.get(segmentId);
    if (!seg) return;
    const def  = PATH_DEFS[seg.type];
    const decay = (corruption / 10) * def.conditionDecayRate;
    seg.condition = Math.max(0, seg.condition - decay);
  }

  /**
   * Restore a segment's condition after a cleanse event.
   * @param amount  Points to restore (default 2)
   */
  restoreCondition(segmentId: string, amount = 2): void {
    const seg = this.segments.get(segmentId);
    if (!seg) return;
    seg.condition = Math.min(100, seg.condition + amount);
  }

  /**
   * Restore all segments that overlap a given area (called on cleanse burst).
   */
  restoreConditionInArea(worldX: number, worldY: number, radius: number, amount = 5): void {
    this.segments.forEach(seg => {
      const cx = seg.rect.x + seg.rect.w / 2;
      const cy = seg.rect.y + seg.rect.h / 2;
      const dist = Math.hypot(cx - worldX, cy - worldY);
      if (dist <= radius + Math.max(seg.rect.w, seg.rect.h) / 2) {
        seg.condition = Math.min(100, seg.condition + amount);
      }
    });
  }

  /** Expose segment map for debugging / serialisation. */
  getSegments(): ReadonlyMap<string, PathSegment> {
    return this.segments;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** condition 0 → 0.5, condition 100 → 1.0 */
  private conditionToFactor(condition: number): number {
    return 0.5 + (condition / 100) * 0.5;
  }

  /** Axis-aligned rectangle intersection. Returns null if no overlap. */
  private rectIntersect(
    a: PathSegmentRect,
    b: PathSegmentRect,
  ): PathSegmentRect | null {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    if (x2 <= x1 || y2 <= y1) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /** Find all pairs of segments whose rects overlap and mark them as crossings. */
  private detectCrossings(): void {
    const segs = Array.from(this.segments.values());
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i];
        const b = segs[j];
        if (!this.rectIntersect(a.rect, b.rect)) continue;
        if (!a.crossings.includes(b.id)) a.crossings.push(b.id);
        if (!b.crossings.includes(a.id)) b.crossings.push(a.id);
      }
    }
  }
}
