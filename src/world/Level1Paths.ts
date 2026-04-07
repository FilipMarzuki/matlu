/**
 * Level 1 path segment layout.
 *
 * The world is 8000×8000. Player spawns near (400, 1000), portal is at (2100, 220).
 * Segments are defined as axis-aligned rects in world coordinates.
 *
 * Layout narrative:
 *  - Dirt road  : connects spawn area east toward the forest (main travel route)
 *  - Animal trail: winds from the forest meadow north-east toward the plateau
 *  - Forest path : narrow gap through the dense forest belt
 *  - Paved road  : short stretch on the plateau approaching the portal
 */

import type { PathSegment } from './PathSystem';

export const LEVEL1_PATHS: PathSegment[] = [
  // ── Dirt road — runs east from spawn toward the forest ──────────────────────
  {
    id: 'dirt-east-1',
    type: 'dirt',
    x: 300, y: 960, w: 600, h: 80,
    condition: 80,
  },
  {
    id: 'dirt-east-2',
    type: 'dirt',
    x: 900, y: 900, w: 500, h: 80,
    condition: 75,
  },

  // ── Animal trail — meanders from the meadow toward the plateau ───────────────
  // Animals use this to cross between Zone 1 and Zone 2; wildlife clusters here.
  {
    id: 'animal-trail-1',
    type: 'animal',
    x: 700, y: 700, w: 60, h: 350,
    condition: 90,
  },
  {
    id: 'animal-trail-2',
    type: 'animal',
    x: 700, y: 500, w: 400, h: 60,
    condition: 88,
  },
  {
    id: 'animal-trail-3',
    type: 'animal',
    x: 1060, y: 300, w: 60, h: 260,
    condition: 85,
  },

  // ── Forest path — narrow gap through the dense tree belt ───────────────────
  {
    id: 'forest-path-1',
    type: 'forest',
    x: 1400, y: 600, w: 300, h: 60,
    condition: 70,
  },
  {
    id: 'forest-path-2',
    type: 'forest',
    x: 1650, y: 350, w: 60, h: 310,
    condition: 68,
  },

  // ── Paved road — approaches the portal on the plateau ──────────────────────
  {
    id: 'paved-plateau-1',
    type: 'paved',
    x: 1700, y: 180, w: 500, h: 100,
    condition: 95,
  },
];
