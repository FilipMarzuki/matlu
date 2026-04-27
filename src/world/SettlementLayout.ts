/**
 * SettlementLayout — JRPG-style grid-aligned settlement placement.
 *
 * ## Approach
 * Classic top-down RPGs (Zelda, Final Fantasy, Chrono Trigger) hand-place
 * buildings on a tile grid with a clear spatial hierarchy:
 *
 *   1. Central plaza defined first — the civic heart
 *   2. Key buildings seat around the plaza (they face it)
 *   3. Secondary buildings fill a loose grid around those
 *   4. Streets run south → plaza (main), east-west (cross), and north → landmark
 *
 * We replicate those rules procedurally using per-settlement templates. Each
 * template hard-codes slot positions in tile-grid coordinates relative to the
 * settlement centre so layouts are readable and tunable, not random.
 *
 * RNG is used only for minor ±8 % size variation per building instance —
 * enough to break the "copy-paste" feel without disrupting the grid logic.
 *
 * ## Grid
 * TILE = 16 px. All positions are snapped to the nearest tile so buildings
 * align with the world tile grid and paths feel intentional.
 *
 * ## Output
 * Returns a `SettlementLayout` containing:
 *   - `buildings`  — array of placed buildings (same interface as before)
 *   - `plaza`      — centre + size of the civic square
 *   - `streets`    — axis-aligned rect segments for dirt paths
 *
 * GameScene consumes all three to draw the settlement ground layer before
 * stamping building sprites and physics bodies.
 */

import type { Settlement } from './Level1';

/** One tile in world pixels — all positions snap to this grid. */
const TILE = 16;

/** Snap a world coordinate to the nearest tile boundary. */
function snap(v: number): number {
  return Math.round(v / TILE) * TILE;
}

// ── Public interfaces ────────────────────────────────────────────────────────

/** A building successfully placed in world space. Interface kept stable so
 *  GameScene's sprite / physics stamping code requires no changes. */
/** Cardinal direction the building entrance faces. */
export type EntranceSide = 'n' | 's' | 'e' | 'w';

export interface PlacedBuilding {
  /** World x of the building centre. */
  x: number;
  /** World y of the building centre. */
  y: number;
  /** Display width in world pixels (drives sprite scale). */
  w: number;
  /** Approximate display height (w × 0.6 — used for overlap context only). */
  h: number;
  /** Named frame key on the 'building-roofs' texture. */
  frameKey: string;
  /** Human-readable role — for tooltips, lore, and future NPC attachment. */
  role: string;
  /** Which side of the building the entrance/exit is on. */
  entranceSide: EntranceSide;
  /** World x of the entrance point (on the building edge). */
  entranceX: number;
  /** World y of the entrance point (on the building edge). */
  entranceY: number;
}

/** The open civic square at the heart of the settlement. */
export interface PlazaDef {
  /** World x of plaza centre. */
  x: number;
  /** World y of plaza centre. */
  y: number;
  /** Total width in pixels (always a multiple of TILE). */
  w: number;
  /** Total height in pixels (always a multiple of TILE). */
  h: number;
}

/**
 * An axis-aligned dirt street segment expressed as a top-left rect.
 * GameScene draws these with fillRect before placing buildings.
 */
export interface StreetSegment {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Full layout returned to GameScene for rendering. */
export interface SettlementLayout {
  buildings: PlacedBuilding[];
  plaza:     PlazaDef;
  streets:   StreetSegment[];
}

// ── Template system ──────────────────────────────────────────────────────────

/**
 * A building slot in tile-grid units relative to the settlement centre.
 * Positive col = east, positive row = south (screen-down).
 */
interface SlotDef {
  col:      number;
  row:      number;
  role:     string;
  frameKey: string;
  /** Base display width in pixels — varied ±8% by rng per instance. */
  w:        number;
  /** Which side the entrance faces. Defaults to 's' (south / toward the player). */
  entrance?: EntranceSide;
}

interface Template {
  /** Plaza width in tiles. */
  plazaCols: number;
  /** Plaza height in tiles. */
  plazaRows: number;
  /**
   * Plaza centre row offset from settlement centre, in tiles.
   * Negative = north of centre (typical — puts the entry street to the south).
   */
  plazaRowOffset: number;
  slots: SlotDef[];
}

/**
 * Per-settlement templates. Positions are intentional, not random — each
 * settlement has its own character expressed in where things are placed.
 *
 * Reading the grid: col 0 = settlement centre x. Row 0 = settlement centre y.
 * Negative row = north (up the screen). Negative col = west.
 *
 * Key buildings sit directly adjacent to the plaza (row/col ~±3–4 from centre
 * depending on plaza size). Homes and storage fill the outer ring.
 */
const TEMPLATES: Record<string, Template> = {

  // ── Strandviken — coastal fishing hamlet ──────────────────────────────────
  // Longhouse anchors the north. Smokehouse and fishing hut flank the plaza
  // east and west. Net sheds and a second fishing hut sit at the south edge.
  strandviken: {
    plazaCols: 4, plazaRows: 4, plazaRowOffset: -1,
    slots: [
      { col:  0, row: -5, role: 'longhouse',  frameKey: 'mw-longhouse',   w: 38, entrance: 's' },
      { col: -5, row: -2, role: 'smokehouse', frameKey: 'mw-smokehouse',  w: 22, entrance: 'e' },
      { col:  5, row: -2, role: 'fishing-hut',frameKey: 'mw-cottage',     w: 18, entrance: 'w' },
      { col: -5, row: -5, role: 'home',       frameKey: 'mw-cottage',     w: 20, entrance: 's' },
      { col:  5, row: -5, role: 'home',       frameKey: 'mw-cottage',     w: 20, entrance: 's' },
      { col: -4, row:  4, role: 'net-shed',   frameKey: 'mw-cottage',     w: 16, entrance: 'n' },
      { col:  4, row:  4, role: 'fishing-hut',frameKey: 'mw-cottage',     w: 18, entrance: 'n' },
    ],
  },

  // ── Skogsgläntan — forest trading village ─────────────────────────────────
  // Largest settlement. Market hall dominates the north. Sawmill to the west,
  // workshop to the east. Four dwellings ring the plaza. Storage at the south.
  skogsglanten: {
    plazaCols: 5, plazaRows: 4, plazaRowOffset: -1,
    slots: [
      { col:  0, row: -6, role: 'market-hall',frameKey: 'mw-market-hall', w: 40, entrance: 's' },
      { col: -6, row: -3, role: 'sawmill',    frameKey: 'mw-workshop',    w: 30, entrance: 'e' },
      { col:  6, row: -3, role: 'workshop',   frameKey: 'mw-workshop',    w: 20, entrance: 'w' },
      { col: -5, row: -6, role: 'dwelling',   frameKey: 'mw-dwelling',    w: 26, entrance: 's' },
      { col:  5, row: -6, role: 'dwelling',   frameKey: 'mw-dwelling',    w: 26, entrance: 's' },
      { col: -5, row:  4, role: 'dwelling',   frameKey: 'mw-dwelling',    w: 24, entrance: 'n' },
      { col:  5, row:  4, role: 'dwelling',   frameKey: 'mw-dwelling',    w: 24, entrance: 'n' },
      { col: -3, row:  6, role: 'storage',    frameKey: 'mw-cottage',     w: 16, entrance: 'n' },
      { col:  3, row:  6, role: 'storage',    frameKey: 'mw-cottage',     w: 16, entrance: 'n' },
    ],
  },

  // ── Klippbyn — isolated mountain hamlet ───────────────────────────────────
  // Smallest settlement. Lodge at the north, smithy to the west, three
  // shelter huts scattered around the south. Sparse, austere.
  klippbyn: {
    plazaCols: 4, plazaRows: 3, plazaRowOffset: -1,
    slots: [
      { col:  0, row: -5, role: 'lodge',       frameKey: 'mw-longhouse',   w: 34, entrance: 's' },
      { col: -4, row: -2, role: 'smithy',      frameKey: 'mw-workshop',    w: 22, entrance: 'e' },
      { col:  4, row: -2, role: 'shelter-hut', frameKey: 'mw-cottage',     w: 16, entrance: 'w' },
      { col: -3, row:  4, role: 'shelter-hut', frameKey: 'mw-cottage',     w: 14, entrance: 'n' },
      { col:  3, row:  4, role: 'shelter-hut', frameKey: 'mw-cottage',     w: 14, entrance: 'n' },
    ],
  },
};

// ── Layout function ──────────────────────────────────────────────────────────

/**
 * Generate the full layout for a settlement.
 *
 * @param s    Settlement definition from Level1.SETTLEMENTS
 * @param rng  Seeded PRNG (mulberry32) — must be dedicated to this settlement
 */
export function layoutSettlement(s: Settlement, rng: () => number): SettlementLayout {
  const template = TEMPLATES[s.id];
  if (!template) {
    // Unknown settlement — return empty layout so nothing breaks.
    return { buildings: [], plaza: { x: s.x, y: s.y, w: 0, h: 0 }, streets: [] };
  }

  // Snap centre to tile grid — keeps everything pixel-aligned with the terrain.
  const cx = snap(s.x);
  const cy = snap(s.y);

  // ── Plaza ────────────────────────────────────────────────────────────────
  const plazaW  = template.plazaCols * TILE;
  const plazaH  = template.plazaRows * TILE;
  const plazaCY = cy + template.plazaRowOffset * TILE;
  const plaza: PlazaDef = { x: cx, y: plazaCY, w: plazaW, h: plazaH };

  // ── Buildings ────────────────────────────────────────────────────────────
  const buildings: PlacedBuilding[] = template.slots.map(slot => {
    const bx = snap(cx + slot.col * TILE);
    const by = snap(cy + slot.row * TILE);
    // ±8 % size variation for a hand-crafted feel — not enough to misalign.
    const w  = Math.round(slot.w * (0.92 + rng() * 0.16));
    const h  = Math.round(w * 0.6);

    // Entrance point — placed at the midpoint of the relevant building edge.
    const side: EntranceSide = slot.entrance ?? 's';
    let ex = bx;
    let ey = by;
    switch (side) {
      case 'n': ey = by - h / 2; break;
      case 's': ey = by + h / 2; break;
      case 'w': ex = bx - w / 2; break;
      case 'e': ex = bx + w / 2; break;
    }

    return {
      x: bx, y: by, w, h,
      frameKey: slot.frameKey, role: slot.role,
      entranceSide: side, entranceX: ex, entranceY: ey,
    };
  });

  // ── Streets ──────────────────────────────────────────────────────────────
  // Three axis-aligned dirt segments form the skeleton of the settlement:
  //
  //   Main street  (vertical)   — south entry point → plaza south face
  //   Cross street (horizontal) — east edge → west edge through plaza mid
  //   North spur   (vertical)   — plaza north face → landmark building area
  //
  // All widths are multiples of TILE so they align with the grid.
  const MAIN_W  = 2 * TILE;   // 32 px — main street, wide enough for two people
  const CROSS_W = 2 * TILE;   // 32 px — cross axis
  const SPUR_W  = TILE;       // 16 px — narrower side lane

  const plazaTop    = plazaCY - plazaH / 2;
  const plazaBottom = plazaCY + plazaH / 2;

  // South entry: one radius below centre, snapped to grid.
  const entryY = snap(cy + s.radius);

  const streets: StreetSegment[] = [
    // Main street: south entry → plaza south face
    {
      x: cx - MAIN_W / 2,
      y: plazaBottom,
      w: MAIN_W,
      h: Math.max(0, entryY - plazaBottom),
    },
    // Cross street: spans ~130 % of the radius east-west through plaza centre
    {
      x: snap(cx - s.radius * 0.65),
      y: plazaCY - CROSS_W / 2,
      w: snap(s.radius * 1.30),
      h: CROSS_W,
    },
    // North spur: plaza north face → ~45 % of radius above centre
    {
      x: cx - SPUR_W / 2,
      y: snap(cy - s.radius * 0.45),
      w: SPUR_W,
      h: Math.max(0, plazaTop - snap(cy - s.radius * 0.45)),
    },
  ];

  return { buildings, plaza, streets };
}
