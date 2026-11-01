/**
 * The minimap (#2016, minimap.ts). The look is exempt (`ui-hud`: screenshots and a browser spec,
 * tests/artificer-minimap.spec.ts); what can be checked without a browser: the squares around a
 * place (the land's edge, camp), the squares an action walked, where along its walk the Warden is
 * at each point of the action, and what the HTML says.
 */

import { describe, expect, it } from 'vitest';
import { makeT } from '../artificer/i18n';
import { runAction, type QueueItem } from '../artificer/region1';
import { WALK_THE_MAP } from '../artificer/walk-the-map';
import { landOfRun } from '../artificer/world/hex-window';
import { enqueue, makeWarden, type AppState } from './controller';
import { MINI_R, miniAround, minimapHtml, placesOf, roundTrip, stepWalk, walkPos, walkPosByLegs, walkShare, type At } from './minimap';
import { playDay } from './playback';

const en = makeT('en');
const sv = makeT('sv');

/** A Warden who has looked about and learned to plan, with water, wood and food queued (as tests/helpers/artificer-planned-save.ts). */
function planned(features: Record<string, boolean> = {}): AppState {
  const a = makeWarden({ id: 'w-side-queue' }, undefined, features);
  let s = runAction(a.sim, 'scout');
  s = runAction(s, 'survey');
  return (['water', 'wood', 'gather'] as QueueItem[]).reduce(enqueue, { ...a, sim: { ...s, canPlan: true } } as AppState);
}

const same = (p: At, q: At): boolean => p.x === q.x && p.y === q.y;
const adjacent = (p: At, q: At): boolean => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) === 1;

describe('the squares around the Warden (#2016)', () => {
  const a = planned();
  const land = landOfRun(a.sim);

  it('a 5 × 5 of the land around them, row by row, the middle where they stand', () => {
    const { at } = placesOf(a.sim, land);
    const sq = miniAround(land, at, null);
    expect(sq).toHaveLength((2 * MINI_R + 1) ** 2);
    expect(sq[12].biome).toBe(land.cells[at.y * land.w + at.x].biome);
    expect(sq[0].biome).toBe(land.cells[(at.y - 2) * land.w + at.x - 2].biome);
    expect(sq[24].biome).toBe(land.cells[(at.y + 2) * land.w + at.x + 2].biome);
  });

  it('past the land\'s edge, no biome', () => {
    const sq = miniAround(land, { x: 0, y: 0 }, null);
    expect(sq.slice(0, 5).every(q => q.biome === null)).toBe(true);
    expect(sq.filter(q => q.biome === null)).toHaveLength(16);
    expect(sq[12].biome).toBe(land.cells[0].biome);
  });

  it('camp marked where it is, and nowhere before camp is made', () => {
    expect(placesOf(a.sim, land).camp).toBeNull();
    const at = { x: 10, y: 10 };
    const sq = miniAround(land, at, { x: 11, y: 9 });
    // One square right and one up from the middle: row 1, column 3 of the 5 × 5.
    expect(sq.map((q, k) => (q.camp ? k : -1)).filter(k => k >= 0)).toEqual([8]);
  });
});

describe('the squares an action walked (#2016)', () => {
  const a = planned();
  const p = playDay(a);
  const walks = p.steps.map((st, i) => stepWalk(i ? p.steps[i - 1].sim : p.before.sim, st.sim));
  const home = placesOf(a.sim).at;

  it('a trip walks out and back on one path, square by square, from where the Warden stood', () => {
    for (const w of walks.slice(0, 2)) {
      expect(w.length).toBeGreaterThanOrEqual(3);
      expect(same(w[0], home)).toBe(true);
      expect(same(w[w.length - 1], home)).toBe(true);
      for (let k = 1; k < w.length; k++) expect(adjacent(w[k - 1], w[k])).toBe(true);
      // The way back is the way out, reversed.
      expect(w.map(q => `${q.x},${q.y}`)).toEqual([...w].reverse().map(q => `${q.x},${q.y}`));
    }
    // The wood is further out than the water here.
    expect(walks[1].length).toBeGreaterThan(walks[0].length);
  });

  it('work done where they stand walks nowhere', () => {
    expect(walks[2]).toEqual([home]);
  });

  it('with walk-the-map off there is no trail, and the Warden stays put', () => {
    const off = planned({ [WALK_THE_MAP]: false });
    const q = playDay(off);
    const w = stepWalk(q.before.sim, q.steps[0].sim);
    expect(w).toEqual([placesOf(off.sim).at]);
  });
});

describe('where along the walk the Warden is (#2016)', () => {
  const A = { x: 0, y: 0 }, B = { x: 1, y: 0 }, C = { x: 2, y: 0 };
  const there = [A, B, C, B, A];

  it('a trip there and back: out at the start, at the far end for the work, back at the end', () => {
    expect(walkPos(there, 0)).toEqual(A);
    expect(walkPos(there, 0.5)).toEqual(C);
    expect(walkPos(there, 1)).toEqual(A);
    // Walking out: past the first square before the far end.
    expect(walkPos(there, 0.15)).toEqual(B);
    expect(walkPos(there, 0.85)).toEqual(B);
  });

  it('the walk takes the share of the time its squares take, half an hour each, between 5% and 45%', () => {
    expect(walkShare(there, 10)).toBeCloseTo(0.1);
    expect(walkShare(there, 1)).toBe(0.45);
    expect(walkShare([A, B, A], 100)).toBe(0.05);
    expect(walkShare(there)).toBe(0.3);
    // A ten-hour trip two squares out: the Warden is out there by 10% of the way, and still there at 85%.
    expect(walkPos(there, 0.1, 10)).toEqual(C);
    expect(walkPos(there, 0.85, 10)).toEqual(C);
  });

  it('a walk that ends elsewhere (heading out) is walked evenly', () => {
    const out = [A, B, C];
    expect(walkPos(out, 0)).toEqual(A);
    expect(walkPos(out, 0.5)).toEqual(B);
    expect(walkPos(out, 1)).toEqual(C);
  });

  it('nowhere to walk: where they stand', () => {
    expect(walkPos([A], 0.7)).toEqual(A);
  });

  it('a walk there and back ends where it started', () => {
    expect(roundTrip(there)).toBe(true);
    expect(roundTrip([A, B, C])).toBe(false);
    expect(roundTrip([A])).toBe(false);
  });

  it('a session (#1668) walks by its legs, as the timer\'s bar plays them: each trip out, there, back', () => {
    // Two trips, each 1h out, 2h of work, 1h back: 8 hours.
    const legs = [{ kind: 'out' as const, hours: 1 }, { kind: 'work' as const, hours: 2 }, { kind: 'back' as const, hours: 1 }];
    const two = [...legs, ...legs];
    const at = (h: number) => walkPosByLegs(there, two, h / 8);
    expect(at(0)).toEqual(A);
    expect(at(0.5)).toEqual(B);
    expect(at(1.5)).toEqual(C);
    expect(at(3.5)).toEqual(B);
    // The second trip starts at camp again, and walks the same path.
    expect(at(4)).toEqual(A);
    expect(at(4.5)).toEqual(B);
    expect(at(6)).toEqual(C);
    expect(at(8)).toEqual(A);
  });
});

describe('the minimap\'s HTML (#2016)', () => {
  const sq = Array.from({ length: 25 }, (_, k) => ({ biome: k === 12 ? 'birch' as const : k === 0 ? null : 'river' as const, camp: k === 13 }));

  it('25 squares in a grid, the middle one the Warden, camp marked, past the edge blank', () => {
    const html = minimapHtml(sq, en, { size: 'sm' });
    expect(html.match(/<i /g)).toHaveLength(25);
    expect(html).toContain('<i class="mm-birch mm-here"></i>');
    expect(html).toContain('<i class="mm-river mm-camp"></i>');
    expect(html).toMatch(/^<div class="minimap mm-sm" role="img" aria-label="Where you stand: Birch wood"><div class="mmgrid"><i class="mm-out"><\/i>/);
  });

  it('with the middle past the land\'s edge, says just where you stand', () => {
    const edge = sq.map((q, k) => (k === 12 ? { ...q, biome: null } : q));
    expect(minimapHtml(edge, en, { size: 'sm' })).toContain('aria-label="Where you stand"');
  });

  it('says where you stand in Swedish too', () => {
    expect(minimapHtml(sq, sv, { size: 'lg', id: 'pb-mini' })).toContain('class="minimap mm-lg" id="pb-mini" role="img" aria-label="Där du står: Björkskog"');
  });

  it('slides in from the last square, one step at most; a jump just redraws', () => {
    expect(minimapHtml(sq, en, { size: 'lg', slide: { dx: 1, dy: 0 } })).toContain('<div class="mmgrid slide" style="--dx:1;--dy:0">');
    expect(minimapHtml(sq, en, { size: 'lg', slide: { dx: 0, dy: 0 } })).toContain('<div class="mmgrid">');
    expect(minimapHtml(sq, en, { size: 'lg', slide: { dx: 3, dy: 0 } })).toContain('<div class="mmgrid">');
  });
});
