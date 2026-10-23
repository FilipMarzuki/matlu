/**
 * Acceptance tests for #1899 — the hex-world switch and a walking window over world cells. One
 * test per Given/When/Then, in the issue's order (criterion 1, the registry, is covered by
 * features.test.ts's pin tests and criterion 7 by the rest of the unit:src suite).
 */

import { describe, it, expect } from 'vitest';
import { createRegion1, type Region1State } from '../region1';
import { FULL_WORLD } from '../world';
import { seedOf } from '../rng';
import { hexOfCell } from '../../../worldmap/coords';
import { generateReach, walkFrom, REACH_W, REACH_H } from './reach';
import { landOfRun, worldWindow, toWorld, toLocal, reachIndexOf, hexWorldOn, HEX_WORLD, WINDOW_MARGIN, type Land } from './hex-window';

const runWith = (features?: Record<string, boolean>): Region1State =>
  createRegion1({ world: { ...FULL_WORLD, ...(features ? { features } : {}) } }, undefined, { id: 'w-vega' });

describe('the hex-world switch (#1899)', () => {
  it('is a rules feature, off by default', () => {
    const r = runWith();
    expect(hexWorldOn(r)).toBe(false);
    expect(hexWorldOn(runWith({ [HEX_WORLD]: false }))).toBe(false);
    expect(hexWorldOn(runWith({ [HEX_WORLD]: true }))).toBe(true);
  });
});

describe('landOfRun: the Reach with the switch off (#1899)', () => {
  it.each([
    ['default (no features saved)', runWith()],
    ['a saved run with the switch explicitly off', runWith({ [HEX_WORLD]: false })],
  ])('%s: is the run’s Reach, with ox = oy = 0', (_label, s) => {
    const reach = generateReach(seedOf(s.character.id));
    const land = landOfRun(s);
    expect(land.ox).toBe(0);
    expect(land.oy).toBe(0);
    expect(land.w).toBe(reach.w);
    expect(land.h).toBe(reach.h);
    expect(land.camp).toEqual(reach.camp);
    expect(land.cells).toEqual(reach.cells);
    expect(land.hours).toEqual(reach.hours);
  });

  it('with the switch on, is a world window instead', () => {
    const s = runWith({ [HEX_WORLD]: true });
    const land = landOfRun(s);
    expect(land.ox).toBe(-WINDOW_MARGIN);
    expect(land.oy).toBe(-WINDOW_MARGIN);
    expect(land).toEqual(worldWindow(seedOf(s.character.id)));
  });
});

describe('worldWindow: a window around the start hex (#1899)', () => {
  for (const seedId of ['w-vega', 'w-astrid']) {
    const seed = seedOf(seedId);
    const reach = generateReach(seed);
    const window = worldWindow(seed);

    it(`${seedId}: is 72×56 with ox = oy = -12, and carries every Reach cell at (x+12, y+12)`, () => {
      expect(window.w).toBe(REACH_W + 2 * WINDOW_MARGIN);
      expect(window.h).toBe(REACH_H + 2 * WINDOW_MARGIN);
      expect(window.ox).toBe(-WINDOW_MARGIN);
      expect(window.oy).toBe(-WINDOW_MARGIN);
      for (let y = 0; y < REACH_H; y++) {
        for (let x = 0; x < REACH_W; x++) {
          const local = toLocal(window, x, y);
          expect(local).toEqual({ x: x + WINDOW_MARGIN, y: y + WINDOW_MARGIN });
          expect(window.cells[local!.y * window.w + local!.x]).toEqual(reach.cells[y * reach.w + x]);
        }
      }
    });

    it(`${seedId}: camp is the Reach camp + (12, 12)`, () => {
      expect(window.camp).toEqual({ x: reach.camp.x + WINDOW_MARGIN, y: reach.camp.y + WINDOW_MARGIN });
    });

    it(`${seedId}: every Reach cell's window hours are ≤ its Reach hours, and equal within 3h of camp`, () => {
      for (let y = 0; y < REACH_H; y++) {
        for (let x = 0; x < REACH_W; x++) {
          const reachHours = reach.hours[y * reach.w + x];
          const windowHours = window.hours[(y + WINDOW_MARGIN) * window.w + (x + WINDOW_MARGIN)];
          expect(windowHours).toBeLessThanOrEqual(reachHours);
          if (reachHours <= 3) expect(windowHours).toBe(reachHours);
        }
      }
    });

    it(`${seedId}: reaches land outside the Reach, including into a neighbouring hex within a day's walk`, () => {
      let outsideFinite = false;
      let neighbourHexReachable = false;
      for (let y = 0; y < window.h; y++) {
        for (let x = 0; x < window.w; x++) {
          const i = y * window.w + x;
          if (reachIndexOf(window, x, y) === null && Number.isFinite(window.hours[i])) outsideFinite = true;
          const world = toWorld(window, x, y);
          const hex = hexOfCell(world);
          if ((hex.q !== 0 || hex.r !== 0) && window.hours[i] <= 9) neighbourHexReachable = true;
        }
      }
      expect(outsideFinite).toBe(true);
      expect(neighbourHexReachable).toBe(true);
    });
  }

  it('caches only the last 2 seeds (same seed returns the same object)', () => {
    const a = worldWindow(seedOf('w-vega'));
    const b = worldWindow(seedOf('w-vega'));
    expect(a).toBe(b);
  });
});

describe('toWorld / toLocal / reachIndexOf (#1899)', () => {
  const window: Land = worldWindow(seedOf('w-vega'));

  it('toWorld and toLocal round-trip inside the window', () => {
    const world = toWorld(window, 5, 7);
    expect(world).toEqual({ cx: 5 - WINDOW_MARGIN, cy: 7 - WINDOW_MARGIN });
    expect(toLocal(window, world.cx, world.cy)).toEqual({ x: 5, y: 7 });
  });

  it('toLocal is null outside the window', () => {
    expect(toLocal(window, -1000, -1000)).toBeNull();
    expect(toLocal(window, 1000, 1000)).toBeNull();
  });

  it('reachIndexOf is the Reach index inside the Reach rectangle, else null', () => {
    expect(reachIndexOf(window, WINDOW_MARGIN, WINDOW_MARGIN)).toBe(0);
    expect(reachIndexOf(window, WINDOW_MARGIN + 1, WINDOW_MARGIN)).toBe(1);
    expect(reachIndexOf(window, 0, 0)).toBeNull();
    expect(reachIndexOf(window, window.w - 1, window.h - 1)).toBeNull();
  });
});

describe('walkFrom: a Reach and a window of the same seed never share a cached walk (#1899)', () => {
  it('in either order, the Reach walk has 1,536 entries and the window’s has 4,032', () => {
    const seed = seedOf('w-reach-then-window');
    const reach = generateReach(seed);
    const window = worldWindow(seed);
    expect(walkFrom(reach, 10, 10)).toHaveLength(REACH_W * REACH_H);
    expect(walkFrom(window, 10, 10)).toHaveLength(window.w * window.h);
  });

  it('the other order gives the same two sizes', () => {
    const seed = seedOf('w-window-then-reach');
    const reach = generateReach(seed);
    const window = worldWindow(seed);
    expect(walkFrom(window, 10, 10)).toHaveLength(window.w * window.h);
    expect(walkFrom(reach, 10, 10)).toHaveLength(REACH_W * REACH_H);
  });
});
