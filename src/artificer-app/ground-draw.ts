/**
 * Draws the ground under the Warden (#2022, ground-view.ts) into a canvas: the 3 × 3 squares around
 * them, what stands on the squares, and the Warden, top-down 2D, in pixel art.
 *
 * The art was made for this view (#2027; scripts/artificer-ground-assets.py builds the sheets), all
 * seen from above as in a top-down RPG, in the ground tiles' colours:
 * - the ground tiles (`ground.png`, 32 px a square);
 * - what stands on the squares (`things.png`): birch and pine crowns, bushes, stones, a boulder, a
 *   log, a stump, reeds, heather, and camp's fire, tent, lean-to and woodpile, each on a 48 px cell;
 * - the Warden (`warden-ground.png`): walking, idle and at work, facing four ways, 48 px cells.
 *
 * Everything is drawn at the tiles' own pixel size (32 px a square, so a 48 px cell is a square and
 * a half), centred on its square. Low things (stones, bushes, the fire) go under the Warden and the
 * crowns of trees and roofs over them, so the Warden walks under the trees. Until an image has
 * loaded, the squares are drawn in their ground's colour, so the view is never empty.
 *
 * The paths below are written out whole: the Artificer's build copies the sprites its code names
 * (scripts/build-artificer.mjs `referencedAssets`).
 */

import { VIEW, groundAt, thingAt, tileAt, variantAt, type Anim, type Facing, type Ground, type GroundWorld, type Pose, type Thing } from './ground-view';

const SRC = {
  ground: '/assets/sprites/tilesets/artificer-ground/ground.png',
  things: '/assets/sprites/tilesets/artificer-ground/things.png',
  warden: '/assets/sprites/characters/mistheim/heroes/warden/warden-ground.png',
} as const;
type ImgId = keyof typeof SRC;

/** A square's pixels in the art: the ground tiles' size, which the things and the Warden are drawn at too. */
export const ART_SQUARE = 32;
/** A thing's cell in things.png, and the Warden's in its sheet: a square and a half. */
export const THING_CELL = 48;
export const THINGS_ACROSS = 4;

/**
 * Each thing's cells in things.png (a square that has one picks among them by its hash), and whether
 * it stands over the Warden (a crown, a roof) or under them.
 */
export const THING_ART: Readonly<Record<Thing, { cells: readonly number[]; over: boolean }>> = {
  birch: { cells: [0, 1], over: true },
  pine: { cells: [2, 3], over: true },
  bush: { cells: [4, 5], over: false },
  stones: { cells: [6], over: false },
  boulder: { cells: [7], over: false },
  log: { cells: [8], over: false },
  stump: { cells: [9], over: false },
  fire: { cells: [10], over: false },
  shelter: { cells: [11], over: true },
  tent: { cells: [12], over: true },
  woodpile: { cells: [13], over: false },
  reeds: { cells: [14], over: false },
  heather: { cells: [15], over: false },
};
export const THING_COUNT = 16;

/** The Warden's sheet: one row per animation and facing (ANIMS × DIRS), one frame per column. */
export const WARDEN_CELL = { w: THING_CELL, h: THING_CELL } as const;
export const WARDEN_ANIMS: readonly (readonly [Anim, number])[] = [['idle', 4], ['walk', 8], ['pickup', 5], ['pull', 6], ['crouch', 5], ['drink', 6]];
export const WARDEN_DIRS: readonly Facing[] = ['south', 'north', 'east', 'west'];
/** Milliseconds a frame of the Warden's animation shows, walking and working. */
const FRAME_MS: Readonly<Record<Anim, number>> = { idle: 260, walk: 110, pickup: 170, pull: 150, crouch: 220, drink: 200 };

/** The colour a square is drawn before its tile has loaded. */
const GROUND_COLOUR: Readonly<Record<Ground, string>> = {
  birch: '#304e2d', pine: '#4a3b2a', meadow: '#516e30', heath: '#4c343d', marsh: '#223c2a', scree: '#6e6a6f', fell: '#5c4d52',
  snow: '#eef5fa', river: '#538789', lake: '#172038', shore: '#8b8990', camp: '#2a1d1f',
};

const images = new Map<ImgId, HTMLImageElement>();
/**
 * Who to tell when an image arrives: the latest draw's redraw, and only until it's called, so an
 * image doesn't keep a finished day's timer (and every state it played) alive after it.
 */
let arrived: (() => void) | null = null;
/** An image, loading it the first time; null until it has loaded (its arrival asks for a redraw). */
function img(id: ImgId): HTMLImageElement | null {
  let im = images.get(id);
  if (!im) {
    const el = new Image();
    el.decoding = 'async';
    el.onload = () => { el.onload = null; const redraw = arrived; arrived = null; redraw?.(); };
    el.src = SRC[id];
    images.set(id, el);
    im = el;
  }
  return im.complete && im.naturalWidth > 0 ? im : null;
}

/** Whether the viewer has asked for less motion: the Warden then steps square by square, and stands still between. */
const lessMotion = (): boolean => { try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** The frame of the Warden's sheet for this animation, facing and moment. */
export function wardenFrame(anim: Anim, facing: Facing, now: number): { col: number; row: number } {
  const a = Math.max(0, WARDEN_ANIMS.findIndex(([n]) => n === anim));
  const frames = WARDEN_ANIMS[a][1];
  return { col: Math.floor(now / FRAME_MS[anim]) % frames, row: a * WARDEN_DIRS.length + Math.max(0, WARDEN_DIRS.indexOf(facing)) };
}

/**
 * Draw the ground around `pose` into `cv`, the Warden in the middle. `now` (ms) drives the Warden's
 * animation; `redraw` is called when an image arrives, so the first frames fill in as they load.
 */
export function drawGround(cv: HTMLCanvasElement, w: GroundWorld, shown: Pose, now: number, redraw: () => void): void {
  arrived = redraw;
  // With less motion: no gliding and no animation, the Warden on whole squares in one frame.
  const still = lessMotion();
  const pose: Pose = still ? { ...shown, at: { x: Math.round(shown.at.x), y: Math.round(shown.at.y) } } : shown;
  const css = cv.clientWidth || 96;
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const size = Math.max(1, Math.round(css * dpr));
  if (cv.width !== size || cv.height !== size) { cv.width = size; cv.height = size; }
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  const T = size / VIEW;
  // The Warden's square's middle sits at the canvas's middle.
  const sx = (x: number): number => Math.round((x - pose.at.x) * T + size / 2 - T / 2);
  const sy = (y: number): number => Math.round((y - pose.at.y) * T + size / 2 - T / 2);
  const half = Math.ceil(VIEW / 2) + 1;
  const x0 = Math.floor(pose.at.x) - half, x1 = Math.ceil(pose.at.x) + half;
  const y0 = Math.floor(pose.at.y) - half, y1 = Math.ceil(pose.at.y) + half;
  const ground = img('ground');
  const across = ground ? Math.floor(ground.naturalWidth / ART_SQUARE) : 4;
  ctx.fillStyle = '#1c1c25';
  ctx.fillRect(0, 0, size, size);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = sx(x), py = sy(y), pw = sx(x + 1) - px, ph = sy(y + 1) - py;
      const tile = tileAt(w, x, y);
      if (tile === null) continue;
      if (ground) ctx.drawImage(ground, (tile % across) * ART_SQUARE, Math.floor(tile / across) * ART_SQUARE, ART_SQUARE, ART_SQUARE, px, py, pw, ph);
      else { ctx.fillStyle = GROUND_COLOUR[groundAt(w, x, y) ?? 'fell']; ctx.fillRect(px, py, pw, ph); }
    }
  }
  // A 48 px cell (a thing's or the Warden's) drawn at the tiles' size, a square and a half, centred on (cx, cy).
  const cellSize = (THING_CELL / ART_SQUARE) * T;
  const drawCell = (im: HTMLImageElement, col: number, row: number, cx: number, cy: number): void => {
    ctx.drawImage(im, col * THING_CELL, row * THING_CELL, THING_CELL, THING_CELL, Math.round(cx - cellSize / 2), Math.round(cy - cellSize / 2), Math.round(cellSize), Math.round(cellSize));
  };
  // What stands on the squares: low things first, then the Warden, then the crowns and roofs over them.
  const things = img('things');
  const over: (() => void)[] = [];
  if (things) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const thing = thingAt(w, x, y);
        if (!thing) continue;
        const art = THING_ART[thing];
        const cell = art.cells[variantAt(x, y, art.cells.length)];
        const draw = (): void => drawCell(things, cell % THINGS_ACROSS, Math.floor(cell / THINGS_ACROSS), sx(x) + T / 2, sy(y) + T / 2);
        if (art.over) over.push(draw); else draw();
      }
    }
  }
  const sheet = img('warden');
  if (sheet) {
    const f = wardenFrame(pose.anim, pose.facing, still ? 0 : now);
    drawCell(sheet, f.col, f.row, size / 2, size / 2);
  }
  for (const draw of over) draw();
}
