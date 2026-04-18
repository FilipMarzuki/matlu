/**
 * LevelSmall — compact test world (1500×1000 px, ~47×32 tiles).
 *
 * Identical biome layout to the full Level 1 map (NW mountains, SE ocean,
 * diagonal SW→NE corridor) but small enough to traverse in seconds.
 * Activate with ?mapSize=small in the URL.
 *
 * ## World constants (kept here as reference — the actual consts live in GameScene.ts)
 *   WORLD_W  1500 px   tilesX  47
 *   WORLD_H  1000 px   tilesY  32
 *   SPAWN    (100, 880)
 *   PORTAL   (1360, 120)
 *   BOSS     (1260, 170)
 *
 * ## Layout
 *   Two settlements: SW hamlet (Lilla Hamn) and NE outpost (Utsikten).
 *   A staircase dirt road approximates the diagonal and connects them.
 *   Two rivers flow from the NW mountain zone toward the SE ocean.
 */

import type { PathSegment } from './PathSystem';
import type { DiagonalRiver } from './RiverData';

// ─── Zones (scaled 1/3 from Level 1) ──────────────────────────────────────────

export const ZONES = [
  {
    // Shore zone — where the player arrives, SW coastal area.
    id: 'zone-start',
    x: 0, y: 700, w: 240, h: 300,
    corruption: 65,
    tintColor: 0x303030,
    tintAlpha: 0.04,
  },
  {
    // Forest belt — mid-corridor boreal fringe.
    id: 'zone-forest',
    x: 530, y: 330, w: 370, h: 300,
    corruption: 40,
    tintColor: 0x1a2a1a,
    tintAlpha: 0.04,
  },
  {
    // Summit zone — NE plateau near the portal.
    id: 'zone-plateau',
    x: 1130, y: 0, w: 370, h: 300,
    corruption: 15,
    tintColor: 0x1a2244,
    tintAlpha: 0.03,
  },
];

// ─── Collectibles — none in the test world ────────────────────────────────────

export const COLLECTIBLES: Array<{
  id: string; x: number; y: number; label: string; zoneId: string;
}> = [];

// ─── Settlements ───────────────────────────────────────────────────────────────
// Uses existing SettlementLayout templates so the building generator works.
// 'strandviken' → SW hamlet (Lilla Hamn); 'klippbyn' → NE outpost (Utsikten).

export const SETTLEMENTS = [
  {
    id: 'strandviken',          // reuse existing building template
    name: 'Lilla Hamn',         // SW hamlet near spawn
    x: 150, y: 920,
    radius: 40,
    type: 'hamlet' as const,
  },
  {
    id: 'klippbyn',             // reuse existing building template
    name: 'Utsikten',           // NE outpost near portal
    x: 1300, y: 200,
    radius: 35,
    type: 'hamlet' as const,
  },
];

// ─── Stub level data (meeting, cleanse, secrets) ──────────────────────────────

export const MEETING_POINT  = { x: 1260, y: 170 };
export const MEETING_RADIUS = 80;
export const PATH_CHOICES   = [{ id: 'continue', label: 'Continue' }];
export function meetingOpeningLine(_itemsFound: number): string { return '...'; }
export const PASSIVE_CLEANSE_RATE = 0.001;
export const PASSIVE_CLEANSE_CAP  = 15;
export const SECRET_POSITIONS:      ReadonlyArray<{ x: number; y: number; label: string }> = [];
export const ZONE_BOUNDARY_MARKERS: ReadonlyArray<{ x: number; y: number }> = [];

// ─── Diagonal road (SW hamlet → NE outpost) ────────────────────────────────────
//
// The road follows the SW→NE corridor in a staircase of four N+E leg pairs.
// Each leg advances ~288 px east and ~180 px north, approximating the 1150/720
// pixel diagonal from (150,920) to (1300,200).
//
//  Lilla Hamn (150,920)
//    │ leg 1 — coastal heath
//    └─────→ (460,730)
//              │ leg 2 — forest edge
//              └─────→ (755,545)
//                        │ leg 3 — boreal fringe
//                        └─────→ (1050,360)
//                                  │ leg 4 — summit (paved)
//                                  └─────→ Utsikten (1300,200)

export const PATHS: PathSegment[] = [
  // Leg 1 — departs the SW hamlet
  { id: 'road-1-n', type: 'dirt',   x: 160, y: 730, w: 55, h: 190, condition: 75 },
  { id: 'road-1-e', type: 'dirt',   x: 160, y: 730, w: 300, h: 55, condition: 73 },

  // Leg 2 — across coastal heath
  { id: 'road-2-n', type: 'dirt',   x: 455, y: 545, w: 55, h: 190, condition: 70 },
  { id: 'road-2-e', type: 'dirt',   x: 455, y: 545, w: 300, h: 55, condition: 68 },

  // Leg 3 — into the boreal fringe
  { id: 'road-3-n', type: 'dirt',   x: 750, y: 355, w: 55, h: 195, condition: 65 },
  { id: 'road-3-e', type: 'dirt',   x: 750, y: 355, w: 305, h: 55, condition: 63 },

  // Leg 4 — old stone track approaching the outpost
  { id: 'road-4-n', type: 'paved',  x: 1045, y: 195, w: 55, h: 170, condition: 85 },
  { id: 'road-4-e', type: 'paved',  x: 1045, y: 195, w: 260, h: 55, condition: 83 },
];

// ─── Rivers ────────────────────────────────────────────────────────────────────
//
// Source tiles are scaled proportionally from the Level 1 values:
//   river-a: (5/141, 50/94) of 141×94 → (2, 17) of 47×32
//   river-b: (5/141, 15/94) of 141×94 → (2,  5) of 47×32
//
// Both stay in the NW mountain zone (perpDiag ≈ −0.3) so gradient descent
// flows naturally SE toward the ocean.  halfWidth is reduced from 48 → 32
// so the river band looks proportionate at the smaller scale.

export const RIVERS: ReadonlyArray<DiagonalRiver> = [
  {
    id: 'river-a',
    sourceTile:  { tx: 2, ty: 17 },
    halfWidth:   32,
    bridge: { pathIndex: 0, width: 80 },
    ford:   { pathIndex: 0, width: 80 },
  },
  {
    id: 'river-b',
    sourceTile:  { tx: 2, ty: 5 },
    halfWidth:   32,
    bridge: { pathIndex: 0, width: 64 },
    ford:   { pathIndex: 0, width: 64 },
  },
];
