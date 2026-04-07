/**
 * Level 1 path segment definitions (FIL-33).
 *
 * Four path types cover the three zones:
 *
 *   Zone 1 — Startplatsen (x 0–600,   y 700–1300)
 *     • Dirt road running east–west through spawn (the main road at y ≈ 1000)
 *     • North–south connector between zones
 *
 *   Zone 2 — Skogen (x 600–1600, y 500–1350)
 *     • Forest path cutting through the woods
 *     • Animal trail weaving through the quieter eastern edge
 *
 *   Zone 3 — Platån (x 1600–2500, y 100–900)
 *     • Paved road on the plateau approaching the parent meeting point
 *
 * Segment rects are axis-aligned bounding boxes in world coordinates.
 * For a diagonal path break it into two or more shorter horizontal/vertical
 * rects — good enough for the speed-multiplier lookup.
 */

import type { PathSystem } from './PathSystem';

/** Register all Level 1 path segments on a PathSystem instance. */
export function loadLevel1Paths(ps: PathSystem): void {
  ps.addSegments([
    // ── Zone 1: dirt road (east–west main road near y=1000) ──────────────────
    {
      id:      'z1-dirt-ew',
      type:    'dirt',
      rect:    { x: 0,   y: 960,  w: 620, h: 80 },
      underlay: null,
    },
    // ── Zone 1: dirt road (north–south connector toward Zone 2) ──────────────
    {
      id:      'z1-dirt-ns',
      type:    'dirt',
      rect:    { x: 560, y: 700,  w: 80,  h: 340 },
      underlay: null,
    },

    // ── Zone 2: forest path (main through-route in the woods) ─────────────────
    {
      id:      'z2-forest-w',
      type:    'forest',
      rect:    { x: 600, y: 850,  w: 500, h: 60  },
      underlay: null,
    },
    {
      id:      'z2-forest-n',
      type:    'forest',
      rect:    { x: 1060, y: 600, w: 60,  h: 310 },
      underlay: null,
    },
    {
      id:      'z2-forest-e',
      type:    'forest',
      rect:    { x: 1060, y: 600, w: 480, h: 60  },
      underlay: null,
    },

    // ── Zone 2: animal trail (quieter path through eastern forest) ────────────
    {
      id:      'z2-animal-ne',
      type:    'animal',
      rect:    { x: 900, y: 500,  w: 40,  h: 380 },
      underlay: null,
    },
    {
      id:      'z2-animal-e',
      type:    'animal',
      rect:    { x: 900, y: 500,  w: 700, h: 40  },
      underlay: null,
    },

    // ── Zone 2→3 transition: forest path climbing to plateau ──────────────────
    {
      id:      'z2z3-forest',
      type:    'forest',
      rect:    { x: 1500, y: 500, w: 160, h: 500 },
      underlay: null,
    },

    // ── Zone 3: paved road on the plateau ────────────────────────────────────
    {
      id:      'z3-paved-w',
      type:    'paved',
      rect:    { x: 1600, y: 350, w: 600, h: 70  },
      underlay: 'dirt',    // old dirt road paved over
    },
    {
      id:      'z3-paved-e',
      type:    'paved',
      rect:    { x: 2100, y: 250, w: 400, h: 150 },
      underlay: 'dirt',
    },
  ]);
}
