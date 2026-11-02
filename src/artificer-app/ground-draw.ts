/**
 * Draws the ground under the Warden (#2022, ground-view.ts) into a canvas: the 3 × 3 squares around
 * them, what stands on the squares, and the Warden, top-down, in pixel art.
 *
 * The art is the repo's own:
 * - the ground tiles generated for this view (scripts/artificer-ground-assets.py) in the isometric
 *   tiles' colours;
 * - the trees, bushes, stones and logs the isometric game's woods use;
 * - the campfire and the lean-to;
 * - the Mistheim hero's walk, idle and work animations, cut into one sheet by the same script.
 *
 * Tall things (trees, the shelter, the Warden) stand up from the bottom of their square and are drawn
 * row by row from the back, so what's nearer covers what's behind, as in a top-down RPG. Until an
 * image has loaded, the squares are drawn in their ground's colour, so the view is never empty.
 *
 * The paths below are written out whole: the Artificer's build copies the sprites its code names
 * (scripts/build-artificer.mjs `referencedAssets`).
 */

import { VIEW, groundAt, thingAt, tileAt, variantAt, type Anim, type Facing, type Ground, type GroundWorld, type Pose, type Thing } from './ground-view';

const SRC = {
  ground: '/assets/sprites/tilesets/artificer-ground/ground.png',
  warden: '/assets/sprites/characters/mistheim/heroes/loke/loke-ground.png',
  birch0: '/assets/sprites/trees/birch/mature/0.png',
  birch1: '/assets/sprites/trees/birch/mature/1.png',
  birch2: '/assets/sprites/trees/birch/mature/2.png',
  birch3: '/assets/sprites/trees/birch/mature/3.png',
  pine0: '/assets/sprites/trees/pine/mature/0.png',
  pine1: '/assets/sprites/trees/pine/mature/1.png',
  pine2: '/assets/sprites/trees/pine/mature/2.png',
  bush: '/assets/sprites/trees/birch/objects/berry-bush.png',
  stones: '/assets/sprites/trees/birch/objects/stones.png',
  log: '/assets/sprites/trees/birch/objects/log.png',
  stump: '/assets/sprites/trees/birch/objects/stump.png',
  fire: '/assets/packs/building-forge/campfire_obj_32.png',
  shelter: '/assets/sprites/icons/items/shelter-leanto.png',
} as const;
type ImgId = keyof typeof SRC;

/** Each thing's drawings, and how tall it stands, in squares. */
const THING_ART: Readonly<Record<Thing, { imgs: readonly ImgId[]; tall: number }>> = {
  birch: { imgs: ['birch0', 'birch1', 'birch2', 'birch3'], tall: 1.7 },
  pine: { imgs: ['pine0', 'pine1', 'pine2'], tall: 1.8 },
  bush: { imgs: ['bush'], tall: 0.8 },
  stones: { imgs: ['stones'], tall: 0.6 },
  log: { imgs: ['log'], tall: 0.6 },
  stump: { imgs: ['stump'], tall: 0.6 },
  fire: { imgs: ['fire'], tall: 0.9 },
  shelter: { imgs: ['shelter'], tall: 1.2 },
};

/** The Warden's sheet: one row per animation and facing (ANIMS × DIRS), one frame per column. */
export const WARDEN_CELL = { w: 26, h: 41 } as const;
export const WARDEN_ANIMS: readonly (readonly [Anim, number])[] = [['idle', 4], ['walk', 8], ['pickup', 5], ['pull', 6], ['crouch', 5], ['drink', 6]];
export const WARDEN_DIRS: readonly Facing[] = ['south', 'north', 'east', 'west'];
/** How tall the Warden stands, in squares: a person is about one square of 2 m tall, a little less. */
const WARDEN_TALL = 1.1;
/** Milliseconds a frame of the Warden's animation shows, walking and working. */
const FRAME_MS: Readonly<Record<Anim, number>> = { idle: 260, walk: 110, pickup: 170, pull: 150, crouch: 220, drink: 200 };

/** The colour a square is drawn before its tile has loaded. */
const GROUND_COLOUR: Readonly<Record<Ground, string>> = {
  birch: '#304e2d', pine: '#4a3b2a', meadow: '#516e30', heath: '#4c343d', marsh: '#223c2a', scree: '#6e6a6f', fell: '#5c4d52',
  snow: '#eef5fa', river: '#538789', lake: '#172038', shore: '#8b8990', camp: '#2a1d1f',
};

const images = new Map<ImgId, HTMLImageElement>();
/** An image, loading it the first time; null until it has loaded (`onload` asks for a redraw). */
function img(id: ImgId, redraw: () => void): HTMLImageElement | null {
  let im = images.get(id);
  if (!im) {
    im = new Image();
    im.decoding = 'async';
    im.onload = redraw;
    im.src = SRC[id];
    images.set(id, im);
  }
  return im.complete && im.naturalWidth > 0 ? im : null;
}

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
export function drawGround(cv: HTMLCanvasElement, w: GroundWorld, pose: Pose, now: number, redraw: () => void): void {
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
  const y0 = Math.floor(pose.at.y) - half, y1 = Math.ceil(pose.at.y) + half + 2;
  const ground = img('ground', redraw);
  const across = ground ? Math.floor(ground.naturalWidth / 32) : 4;
  ctx.fillStyle = '#1c1c25';
  ctx.fillRect(0, 0, size, size);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = sx(x), py = sy(y), pw = sx(x + 1) - px, ph = sy(y + 1) - py;
      const tile = tileAt(w, x, y);
      if (tile === null) continue;
      if (ground) ctx.drawImage(ground, (tile % across) * 32, Math.floor(tile / across) * 32, 32, 32, px, py, pw, ph);
      else { ctx.fillStyle = GROUND_COLOUR[groundAt(w, x, y) ?? 'fell']; ctx.fillRect(px, py, pw, ph); }
    }
  }
  // What stands up, from the back row forward; the Warden among them by where they stand.
  const standing: { y: number; draw: () => void }[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const thing = thingAt(w, x, y);
      if (!thing) continue;
      const art = THING_ART[thing];
      const im = img(art.imgs[variantAt(x, y, art.imgs.length)], redraw);
      if (!im) continue;
      standing.push({ y, draw: () => {
        const h = art.tall * T, wd = (im.naturalWidth / im.naturalHeight) * h;
        ctx.drawImage(im, Math.round(sx(x) + T / 2 - wd / 2), Math.round(sy(y) + T * 0.95 - h), Math.round(wd), Math.round(h));
      } });
    }
  }
  const sheet = img('warden', redraw);
  if (sheet) {
    standing.push({ y: pose.at.y + 0.01, draw: () => {
      const f = wardenFrame(pose.anim, pose.facing, now);
      const h = WARDEN_TALL * T, wd = (WARDEN_CELL.w / WARDEN_CELL.h) * h;
      ctx.drawImage(sheet, f.col * WARDEN_CELL.w, f.row * WARDEN_CELL.h, WARDEN_CELL.w, WARDEN_CELL.h, Math.round(size / 2 - wd / 2), Math.round(size / 2 + T * 0.45 - h), Math.round(wd), Math.round(h));
    } });
  }
  standing.sort((a, b) => a.y - b.y);
  for (const s of standing) s.draw();
}
