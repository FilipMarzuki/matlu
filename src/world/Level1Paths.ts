/**
 * Level 1 path segment layout.
 *
 * The world is 4500×3000, diagonal SW→NE corridor.
 * Player spawns near (300, 2650); portal is at (4100, 350).
 * Segments are axis-aligned rects that approximate the diagonal route.
 *
 * Layout narrative:
 *  - Dirt road    : coastal track from spawn NE through the shore zone
 *  - Animal trail : meanders mid-corridor through the forest belt
 *  - Forest path  : narrow gap through dense spruce (mid-NE)
 *  - Paved road   : old stone track approaching the portal plateau
 */

import type { PathSegment } from './PathSystem';

export const LEVEL1_PATHS: PathSegment[] = [
  // ── Dirt road — from SW spawn up the diagonal toward the first settlement ───
  {
    id: 'dirt-sw-1',
    type: 'dirt',
    x: 200, y: 2600, w: 80, h: 300,   // heading north from spawn
    condition: 80,
  },
  {
    id: 'dirt-sw-2',
    type: 'dirt',
    x: 200, y: 2330, w: 400, h: 80,   // dog-leg east toward corridor
    condition: 78,
  },
  {
    id: 'dirt-sw-3',
    type: 'dirt',
    x: 580, y: 2100, w: 80, h: 310,   // heading north again
    condition: 76,
  },
  {
    id: 'dirt-sw-4',
    type: 'dirt',
    x: 580, y: 2100, w: 500, h: 70,   // east leg toward forest
    condition: 74,
  },

  // ── Animal trail — cuts diagonally mid-corridor through the boreal forest ───
  {
    id: 'animal-trail-1',
    type: 'animal',
    x: 1050, y: 1950, w: 60, h: 350,
    condition: 90,
  },
  {
    id: 'animal-trail-2',
    type: 'animal',
    x: 1050, y: 1650, w: 500, h: 60,
    condition: 88,
  },
  {
    id: 'animal-trail-3',
    type: 'animal',
    x: 1500, y: 1350, w: 60, h: 360,
    condition: 86,
  },
  {
    id: 'animal-trail-4',
    type: 'animal',
    x: 1500, y: 1350, w: 500, h: 60,
    condition: 84,
  },
  {
    id: 'animal-trail-5',
    type: 'animal',
    x: 1950, y: 1100, w: 60, h: 310,
    condition: 82,
  },

  // ── Forest path — narrow gap through the dense spruce belt ─────────────────
  {
    id: 'forest-path-1',
    type: 'forest',
    x: 2400, y: 1100, w: 500, h: 60,
    condition: 72,
  },
  {
    id: 'forest-path-2',
    type: 'forest',
    x: 2850, y: 820, w: 60, h: 340,
    condition: 70,
  },
  {
    id: 'forest-path-3',
    type: 'forest',
    x: 2850, y: 820, w: 500, h: 60,
    condition: 68,
  },

  // ── River crossing wading fords (FIL-100) ──────────────────────────────────
  // One per river, at the shallow ford gap in each river barrier.
  // Speed drops to 0.55× so the player visibly slows while wading across.
  {
    id: 'river-a-wading',
    type: 'wading',
    x: 350, y: 2048, w: 128, h: 96,
    condition: 100,
  },
  {
    id: 'river-b-wading',
    type: 'wading',
    x: 1700, y: 1472, w: 128, h: 96,
    condition: 100,
  },

  // ── Paved road — old stone track approaching the NE portal plateau ──────────
  {
    id: 'paved-plateau-1',
    type: 'paved',
    x: 3300, y: 620, w: 500, h: 80,
    condition: 92,
  },
  {
    id: 'paved-plateau-2',
    type: 'paved',
    x: 3750, y: 380, w: 450, h: 80,
    condition: 95,
  },
];
