/**
 * The ground under the Warden (#2022, ground-view.ts). The look is exempt (`ui-hud` / `art`:
 * screenshots and a browser spec, tests/artificer-minimap.spec.ts); what can be checked without a
 * browser: what each square is and what stands on it (and that it's the same every time), each
 * step's way out and back, where the Warden is at each point of a step, and that every kind of task
 * moves the Warden (the owner: "every action should simulate the character actually traveling").
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseItem, runAction, type QueueItem } from '../artificer/region1';
import { TASK_NEED } from '../artificer/walk-the-map';
import { landOfRun } from '../artificer/world/hex-window';
import type { Biome } from '../artificer/world/reach';
import { enqueue, makeWarden, type AppState } from './controller';
import {
  CELL, GROUND_COUNT, GROUND_TILES, ICE_TILES, SNOWY_TILES, cellOf, groundAt, hash, key, middleOf, poseAt, sceneOf, thingAt, tileAt, walkingShare,
  type GroundWorld, type Need, type P,
} from './ground-view';
import { WARDEN_ANIMS, WARDEN_CELL, WARDEN_DIRS, wardenFrame } from './ground-draw';
import { placesOf, stepWalk } from './minimap';
import { playDay } from './playback';

/** A small land: a row of cells, west to east, each its own kind. */
function landOf(rows: Biome[][]): GroundWorld['land'] {
  return { w: rows[0].length, h: rows.length, cells: rows.flat().map(biome => ({ biome })) as unknown as GroundWorld['land']['cells'] };
}
const LAND = landOf([
  ['heath', 'birch', 'river', 'meadow'],
  ['heath', 'pine', 'lake', 'scree'],
]);
const world = (over: Partial<GroundWorld> = {}): GroundWorld => ({ land: LAND, camp: null, snow: false, ice: false, ...over });
const dist = (a: P, b: P): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

describe('the squares (#2022)', () => {
  it('a cell is CELL squares across, its middle in it, and the squares either side of a border in different cells', () => {
    for (const c of [{ x: 0, y: 0 }, { x: 2, y: 1 }]) expect(cellOf(middleOf(c).x, middleOf(c).y)).toEqual(c);
    const m = middleOf({ x: 1, y: 0 });
    expect(cellOf(m.x - CELL / 2, m.y).x).toBe(1);
    expect(cellOf(m.x - CELL / 2 - 1, m.y).x).toBe(0);
    expect(cellOf(m.x + CELL / 2 - 1, m.y).x).toBe(1);
    expect(cellOf(m.x + CELL / 2, m.y).x).toBe(2);
  });

  it('each square is its cell\'s land; past the land\'s edge, nothing', () => {
    const w = world();
    expect(groundAt(w, middleOf({ x: 1, y: 0 }).x, 0)).toBe('birch');
    expect(groundAt(w, middleOf({ x: 1, y: 1 }).x, middleOf({ x: 1, y: 1 }).y)).toBe('pine');
    expect(groundAt(w, -CELL, 0)).toBeNull();
    expect(groundAt(w, 0, CELL * 5)).toBeNull();
  });

  it('land beside the water is the shore; the water itself stays water', () => {
    const w = world();
    const riverEdge = middleOf({ x: 2, y: 0 }).x - CELL / 2;
    expect(groundAt(w, riverEdge, 0)).toBe('river');
    expect(groundAt(w, riverEdge - 1, 0)).toBe('shore');
    expect(groundAt(w, riverEdge - 2, 0)).toBe('birch');
  });

  it('camp\'s trodden ground by the fire, with the fire and the shelter, and the land round it', () => {
    const w = world({ camp: { x: 0, y: 0 } });
    expect(groundAt(w, 0, 0)).toBe('camp');
    expect(groundAt(w, 1, 0)).toBe('camp');
    expect(groundAt(w, 1, 1)).toBe('heath');
    expect(thingAt(w, 1, 0)).toBe('fire');
    expect(thingAt(w, -1, -1)).toBe('shelter');
    expect(thingAt(w, 0, 0)).toBeNull();
  });

  it('the same square looks the same every time, and the ground isn\'t one tile stamped over and over', () => {
    const w = world();
    const tiles = new Set<number>();
    for (let x = 1; x < 6; x++) for (let y = 1; y < 6; y++) {
      expect(tileAt(w, x, y)).toBe(tileAt(w, x, y));
      expect(thingAt(w, x, y)).toBe(thingAt(w, x, y));
      expect(hash(x, y)).toBe(hash(x, y));
      tiles.add(tileAt(w, x, y)!);
      expect(GROUND_TILES.heath).toContain(tileAt(w, x, y));
    }
    expect(tiles.size).toBeGreaterThan(1);
  });

  it('with snow lying, the land\'s snowy tile (or the snowfield\'s); iced over, the lake and the river', () => {
    const snowy = world({ snow: true });
    const bx = middleOf({ x: 1, y: 0 }).x + 2;
    expect(SNOWY_TILES.birch).toContain(tileAt(snowy, bx, 2));
    expect(GROUND_TILES.snow).toContain(tileAt(snowy, middleOf({ x: 3, y: 1 }).x + 2, middleOf({ x: 3, y: 1 }).y + 2));
    const iced = world({ ice: true });
    expect(tileAt(iced, middleOf({ x: 2, y: 1 }).x, middleOf({ x: 2, y: 1 }).y)).toBe(ICE_TILES.lake);
    expect(tileAt(iced, middleOf({ x: 2, y: 0 }).x, 2)).toBe(ICE_TILES.river);
    // Every tile named is in the atlas.
    const all = [...Object.values(GROUND_TILES).flat(), ...Object.values(SNOWY_TILES).flat(), ...Object.values(ICE_TILES)];
    expect(Math.max(...all)).toBeLessThan(GROUND_COUNT);
  });

  it('a birch wood has trees, scree its stones; the lines the walks run along are clear', () => {
    const w = world();
    const count = (cell: { x: number; y: number }, thing: string): number => {
      const m = middleOf(cell);
      let n = 0;
      for (let x = m.x - 5; x <= m.x + 5; x++) for (let y = m.y - 5; y <= m.y + 5; y++) if (thingAt(w, x, y) === thing) n += 1;
      return n;
    };
    expect(count({ x: 1, y: 0 }, 'birch')).toBeGreaterThan(5);
    expect(count({ x: 3, y: 1 }, 'stones')).toBeGreaterThan(5);
    for (let k = -30; k <= 30; k++) {
      expect(thingAt(w, k, 0)).toBeNull();
      expect(thingAt(w, middleOf({ x: 1, y: 0 }).x, k)).toBeNull();
    }
  });
});

describe('a step\'s way and work (#2022)', () => {
  const A = { x: 0, y: 1 }, B = { x: 1, y: 1 };

  it('a trip there and back walks middle to middle out, and the same way back', () => {
    const sc = sceneOf([A, B, A], 'timber', 'wood', world());
    expect(sc.out).toEqual([middleOf(A), middleOf(B)]);
    expect(sc.back).toEqual([middleOf(B), middleOf(A)]);
    expect(sc.spots[0].at).toEqual(middleOf(B));
    expect(sc.anim).toBe('pull');
    // Something to work on, one square ahead of each spot, and nothing where the Warden stands.
    const ahead = [...sc.extra].filter(([, v]) => v !== null);
    expect(ahead.length).toBe(2);
    expect(ahead.every(([, v]) => v === 'pine')).toBe(true);
    expect(sc.extra.get(key(middleOf(B).x, middleOf(B).y))).toBeNull();
  });

  it('water stops at the shore, facing the water, not in the middle of the river', () => {
    const w = world();
    // From the birch wood east into the river.
    const sc = sceneOf([{ x: 1, y: 0 }, { x: 2, y: 0 }], 'water', 'water', w);
    const at = sc.spots[0].at;
    expect(groundAt(w, at.x, at.y)).toBe('shore');
    expect(sc.spots[0].facing).toBe('east');
    const ahead = { x: at.x + 1, y: at.y };
    expect(['river', 'lake']).toContain(groundAt({ ...w, extra: sc.extra }, ahead.x, ahead.y));
    expect(sc.anim).toBe('drink');
  });

  it('work in the cell it started from walks a few squares out to it and back', () => {
    const sc = sceneOf([A], 'forage', 'gather', world());
    expect(sc.out).toHaveLength(2);
    expect(dist(sc.out[0], sc.out[1])).toBe(4);
    expect(sc.back[sc.back.length - 1]).toEqual(middleOf(A));
    expect([...sc.extra.values()].filter(v => v === 'bush')).toHaveLength(2);
  });

  it('look around walks a loop and comes back to where it started', () => {
    const sc = sceneOf([A], 'look', 'explore', world());
    expect(sc.loop).toBe(true);
    expect(sc.out[0]).toEqual(middleOf(A));
    expect(sc.out[sc.out.length - 1]).toEqual(middleOf(A));
    expect(sc.out.length).toBeGreaterThan(3);
  });

  it('work at camp: by the fire, or between the fire, the shelter and back; a job that walked first walks there', () => {
    expect(sceneOf([A], 'camp', 'rest', world()).spots).toHaveLength(1);
    const craft = sceneOf([A], 'camp', 'knife', world());
    expect(craft.spots).toHaveLength(3);
    expect(craft.anim).toBe('pickup');
    const make = sceneOf([A, B], 'camp', 'camp', world());
    expect(make.out).toEqual([middleOf(A), middleOf(B)]);
    expect(make.spots[0].at).toEqual(middleOf(B));
  });
});

describe('where the Warden is in a step (#2022)', () => {
  const A = { x: 0, y: 1 }, B = { x: 1, y: 1 };
  const trip = sceneOf([A, B, A], 'timber', 'wood', world());

  it('a trip: out over the first share of the time, at the work in the middle, back at the end', () => {
    expect(poseAt(trip, 0, 4).at).toEqual(middleOf(A));
    const s = walkingShare(CELL, 4);
    expect(s).toBeCloseTo(0.125);
    expect(poseAt(trip, s / 2, 4)).toMatchObject({ anim: 'walk', facing: 'east' });
    expect(poseAt(trip, s / 2, 4).at.x).toBeCloseTo(CELL / 2);
    const mid = poseAt(trip, 0.5, 4);
    expect(dist(mid.at, middleOf(B))).toBeLessThanOrEqual(1);
    expect(['pull', 'walk']).toContain(mid.anim);
    expect(poseAt(trip, 1 - s / 2, 4)).toMatchObject({ anim: 'walk', facing: 'west' });
    expect(poseAt(trip, 1, 4).at).toEqual(middleOf(A));
  });

  it('a session (#1668) walks by its legs: each trip out, there, back', () => {
    const legs = [{ kind: 'out' as const, hours: 1 }, { kind: 'work' as const, hours: 2 }, { kind: 'back' as const, hours: 1 }];
    const at = (h: number): P => poseAt(trip, h / 8, 8, [...legs, ...legs]).at;
    expect(at(0)).toEqual(middleOf(A));
    expect(at(0.5).x).toBeCloseTo(CELL / 2);
    expect(dist(at(2), middleOf(B))).toBeLessThanOrEqual(1);
    expect(at(4)).toEqual(middleOf(A));
    expect(at(4.5).x).toBeCloseTo(CELL / 2);
  });

  it('at the work the Warden steps between the spots, facing the work', () => {
    const seen = new Set<string>();
    for (let f = 0.2; f < 0.8; f += 0.01) { const p = poseAt(trip, f, 4); if (p.anim === 'pull') seen.add(key(p.at.x, p.at.y)); }
    expect(seen.size).toBe(2);
  });

  it('look around walks its whole loop over the step, and is back at the end', () => {
    const sc = sceneOf([A], 'look', 'explore', world());
    expect(poseAt(sc, 0, 3).at).toEqual(middleOf(A));
    expect(dist(poseAt(sc, 0.5, 3).at, middleOf(A))).toBeGreaterThan(2);
    expect(poseAt(sc, 1, 3)).toEqual({ at: middleOf(A), facing: expect.any(String), anim: 'idle' });
  });
});

describe('every task moves the Warden (#2022)', () => {
  /** A Warden who has looked about and learned to plan, with water, wood and food queued (as tests/helpers/artificer-planned-save.ts). */
  function planned(): AppState {
    const a = makeWarden({ id: 'w-side-queue' });
    let s = runAction(a.sim, 'scout');
    s = runAction(s, 'survey');
    return (['water', 'wood', 'gather', 'knife'] as QueueItem[]).reduce(enqueue, { ...a, sim: { ...s, canPlan: true } } as AppState);
  }

  it('a played day: in every step, the Warden is somewhere else at some point, and ends where the next starts', () => {
    const a = planned();
    const land = landOfRun(a.sim);
    const p = playDay(a);
    const w0: GroundWorld = { land, camp: placesOf(a.sim, land).camp, snow: false, ice: false };
    let end: P | null = null;
    for (const [i, st] of p.steps.entries()) {
      if (st.hours <= 0) continue;
      const before = i ? p.steps[i - 1].sim : p.before.sim;
      const { id } = parseItem(st.item);
      const sc = sceneOf(stepWalk(before, st.sim, land), (TASK_NEED[id] as Need | undefined) ?? 'camp', id, w0);
      const at = Array.from({ length: 41 }, (_, k) => poseAt(sc, k / 40, st.hours, st.phases).at);
      expect(new Set(at.map(q => key(Math.round(q.x * 10), Math.round(q.y * 10)))).size, id).toBeGreaterThan(1);
      if (end) expect(at[0], id).toEqual(end);
      end = at[at.length - 1];
    }
  });
});

describe('the art (#2022)', () => {
  /** A PNG's width and height, from its header. */
  const size = (path: string): { w: number; h: number } => { const b = readFileSync(path); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

  it('the ground atlas holds every tile; the Warden\'s sheet one row per animation and facing', () => {
    const g = size('public/assets/sprites/tilesets/artificer-ground/ground.png');
    expect((g.w / 32) * (g.h / 32)).toBeGreaterThanOrEqual(GROUND_COUNT);
    const s = size('public/assets/sprites/characters/mistheim/heroes/loke/loke-ground.png');
    expect(s.h).toBe(WARDEN_ANIMS.length * WARDEN_DIRS.length * WARDEN_CELL.h);
    expect(s.w).toBe(Math.max(...WARDEN_ANIMS.map(([, n]) => n)) * WARDEN_CELL.w);
  });

  it('the Warden\'s frame: its animation and facing\'s row, cycling through that animation\'s frames', () => {
    expect(wardenFrame('walk', 'east', 0)).toEqual({ col: 0, row: 1 * 4 + 2 });
    const cols = new Set(Array.from({ length: 50 }, (_, k) => wardenFrame('walk', 'east', k * 37).col));
    expect(Math.max(...cols)).toBe(7);
    expect(Math.max(...Array.from({ length: 50 }, (_, k) => wardenFrame('pickup', 'south', k * 37).col))).toBe(4);
  });

  it('every picture the ground draws is in public/, so the Artificer\'s build copies it', () => {
    const src = readFileSync('src/artificer-app/ground-draw.ts', 'utf8');
    const paths = [...src.matchAll(/'(\/assets\/[^']+\.png)'/g)].map(m => m[1]);
    expect(paths.length).toBeGreaterThan(10);
    for (const p of paths) expect(() => readFileSync(`public${p}`), p).not.toThrow();
  });
});
