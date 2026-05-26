/**
 * Generates 16×16 side-view sprite sheets for Höga Kusten forest fauna:
 * deer, fox, rabbit (hare), and boar. Each animal gets an idle (1 frame)
 * and walk (2 frames, alternating leg positions) sheet. Sprite faces right;
 * Phaser code can flipX to face left.
 *
 * The visual style matches the existing bird-bluetit sprites (programmatic
 * pixel art via the `sharp` raw-pixel buffer pipeline). Palette is sampled
 * from docs/matlu-palette.hex — muted earth tones, single-color dark outline,
 * basic shading. No anti-aliasing.
 *
 * Output directory: public/assets/sprites/environment/
 * Files:
 *   fauna-deer-idle.png   (16×16, 1 frame)
 *   fauna-deer-walk.png   (32×16, 2 frames)
 *   fauna-fox-idle.png    (16×16, 1 frame)
 *   fauna-fox-walk.png    (32×16, 2 frames)
 *   fauna-rabbit-idle.png (16×16, 1 frame)
 *   fauna-rabbit-walk.png (32×16, 2 frames)
 *   fauna-boar-idle.png   (16×16, 1 frame)
 *   fauna-boar-walk.png   (32×16, 2 frames)
 *
 * Run with: node scripts/generate-forest-fauna-sprites.mjs
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'assets', 'sprites', 'environment');

const SIZE = 16;

// ─── Palette (RGBA) ──────────────────────────────────────────────────────────
const _  = [0, 0, 0, 0];               // transparent
const D  = [0x1a, 0x10, 0x25, 255];    // dark outline
const E  = [0x0a, 0x05, 0x10, 255];    // very dark (eyes, hooves, tail tip)

// Deer (warm brown)
const dB = [0x8b, 0x62, 0x32, 255];    // brown body
const dL = [0xb8, 0x8e, 0x55, 255];    // tan highlight / belly
const dW = [0xf0, 0xea, 0xd6, 255];    // white tail spot

// Fox (orange-red)
const fO = [0xc9, 0x5a, 0x30, 255];    // fox orange
const fL = [0xe8, 0x88, 0x50, 255];    // light orange highlight
const fW = [0xf0, 0xea, 0xd6, 255];    // white belly/chest/tail-tip

// Rabbit (gray-brown)
const rG = [0x75, 0x60, 0x50, 255];    // grey-brown body
const rL = [0xa8, 0x90, 0x80, 255];    // lighter brown highlight
const rW = [0xf0, 0xea, 0xd6, 255];    // white tail puff

// Boar (dark brown, bristly)
const bB = [0x4a, 0x34, 0x22, 255];    // dark brown body
const bL = [0x6a, 0x4f, 0x37, 255];    // lighter brown belly
const bT = [0xe0, 0xd6, 0xb0, 255];    // ivory tusks

// ─── Sprite definitions ──────────────────────────────────────────────────────
// Each frame is a 16×16 grid. Pixel art reads top-to-bottom, left-to-right.
// All animals face right; the empty rows above the body sit them along the
// bottom edge so feet roughly align across species when drawn at y=8+.

/** Deer — idle. Tall body, small antlers, four legs planted. */
const DEER_IDLE = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,D,_,D,_,_], // antler tips
  [_,_,_,_,_,_,_,_,_,_,D,D,D,D,_,_], // antlers + head top
  [_,_,_,_,_,_,_,_,_,D,dB,dL,dL,D,_,_], // head
  [_,_,_,_,_,_,_,_,D,dB,dB,E,dL,D,_,_], // eye
  [_,_,D,D,D,D,D,D,D,dB,dB,dB,D,_,_,_], // neck/shoulder
  [_,D,dB,dB,dB,dB,dB,dB,dB,dB,dB,dB,D,_,_,_], // body top
  [_,D,dW,dB,dB,dB,dB,dB,dB,dB,dB,dB,D,_,_,_], // tail-side body
  [_,D,dL,dL,dL,dL,dL,dL,dL,dL,dL,dL,D,_,_,_], // belly
  [_,_,D,D,D,_,_,D,D,_,_,D,D,_,_,_],   // leg tops
  [_,_,D,dB,D,_,_,D,dB,_,_,D,dB,_,_,_],
  [_,_,D,dB,D,_,_,D,dB,_,_,D,dB,_,_,_],
  [_,_,D,dB,D,_,_,D,dB,_,_,D,dB,_,_,_],
  [_,_,_,E,_,_,_,_,E,_,_,_,E,_,_,_],   // hooves
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** Deer — walk frame 1. Front-left + back-right forward. */
const DEER_WALK_1 = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,D,_,D,_,_],
  [_,_,_,_,_,_,_,_,_,_,D,D,D,D,_,_],
  [_,_,_,_,_,_,_,_,_,D,dB,dL,dL,D,_,_],
  [_,_,_,_,_,_,_,_,D,dB,dB,E,dL,D,_,_],
  [_,_,D,D,D,D,D,D,D,dB,dB,dB,D,_,_,_],
  [_,D,dB,dB,dB,dB,dB,dB,dB,dB,dB,dB,D,_,_,_],
  [_,D,dW,dB,dB,dB,dB,dB,dB,dB,dB,dB,D,_,_,_],
  [_,D,dL,dL,dL,dL,dL,dL,dL,dL,dL,dL,D,_,_,_],
  [_,_,_,D,D,_,_,D,_,_,_,D,D,_,_,_],
  [_,_,_,_,D,dB,_,D,_,_,_,D,dB,_,_,_],
  [_,_,_,_,_,D,dB,D,_,_,_,D,dB,_,_,_],
  [_,_,_,_,_,_,D,_,_,_,_,D,dB,_,_,_],
  [_,_,_,_,_,_,E,_,_,_,_,_,E,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** Deer — walk frame 2. Mirror leg phase. */
const DEER_WALK_2 = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,D,_,D,_,_],
  [_,_,_,_,_,_,_,_,_,_,D,D,D,D,_,_],
  [_,_,_,_,_,_,_,_,_,D,dB,dL,dL,D,_,_],
  [_,_,_,_,_,_,_,_,D,dB,dB,E,dL,D,_,_],
  [_,_,D,D,D,D,D,D,D,dB,dB,dB,D,_,_,_],
  [_,D,dB,dB,dB,dB,dB,dB,dB,dB,dB,dB,D,_,_,_],
  [_,D,dW,dB,dB,dB,dB,dB,dB,dB,dB,dB,D,_,_,_],
  [_,D,dL,dL,dL,dL,dL,dL,dL,dL,dL,dL,D,_,_,_],
  [_,_,D,D,_,_,_,D,_,_,D,D,_,_,_,_],
  [_,_,D,dB,_,_,_,D,_,_,D,dB,_,_,_,_],
  [_,_,D,dB,_,_,_,D,_,_,_,D,dB,_,_,_],
  [_,_,D,dB,_,_,_,D,_,_,_,_,D,_,_,_],
  [_,_,_,E,_,_,_,E,_,_,_,_,E,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** Fox — idle. Long bushy tail trailing left, pointed snout right. */
const FOX_IDLE = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,D,_,D,_,_], // ear tips
  [_,_,_,_,_,_,_,_,_,_,D,fO,D,fO,D,_], // ears
  [_,_,_,_,_,_,_,_,_,D,fO,fO,fO,fO,D,_], // head top
  [_,_,_,_,_,_,_,_,D,fO,E,fO,fL,fW,D,_], // eye + snout
  [_,_,D,D,_,_,_,D,fO,fO,fO,fO,fO,D,_,_], // neck
  [_,D,fO,fO,D,D,D,fO,fO,fO,fO,fO,D,_,_,_], // body top
  [_,D,fO,fW,fO,fO,fO,fO,fW,fW,fO,D,_,_,_,_], // body with chest patch
  [_,_,D,fW,fW,fW,fW,fW,fW,fW,D,_,_,_,_,_], // white belly
  [_,_,_,D,D,_,_,D,D,_,_,_,_,_,_,_],   // legs
  [_,_,_,D,fO,_,_,D,fO,_,_,_,_,_,_,_],
  [_,_,_,_,E,_,_,_,E,_,_,_,_,_,_,_],   // paws
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

const FOX_WALK_1 = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,D,_,D,_,_],
  [_,_,_,_,_,_,_,_,_,_,D,fO,D,fO,D,_],
  [_,_,_,_,_,_,_,_,_,D,fO,fO,fO,fO,D,_],
  [_,_,_,_,_,_,_,_,D,fO,E,fO,fL,fW,D,_],
  [_,_,D,D,_,_,_,D,fO,fO,fO,fO,fO,D,_,_],
  [_,D,fO,fO,D,D,D,fO,fO,fO,fO,fO,D,_,_,_],
  [_,D,fO,fW,fO,fO,fO,fO,fW,fW,fO,D,_,_,_,_],
  [_,_,D,fW,fW,fW,fW,fW,fW,fW,D,_,_,_,_,_],
  [_,_,_,_,D,_,_,_,D,_,_,_,_,_,_,_],
  [_,_,_,_,D,fO,_,_,_,D,_,_,_,_,_,_],
  [_,_,_,_,_,E,_,_,_,_,E,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

const FOX_WALK_2 = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,D,_,D,_,_],
  [_,_,_,_,_,_,_,_,_,_,D,fO,D,fO,D,_],
  [_,_,_,_,_,_,_,_,_,D,fO,fO,fO,fO,D,_],
  [_,_,_,_,_,_,_,_,D,fO,E,fO,fL,fW,D,_],
  [_,_,D,D,_,_,_,D,fO,fO,fO,fO,fO,D,_,_],
  [_,D,fO,fO,D,D,D,fO,fO,fO,fO,fO,D,_,_,_],
  [_,D,fO,fW,fO,fO,fO,fO,fW,fW,fO,D,_,_,_,_],
  [_,_,D,fW,fW,fW,fW,fW,fW,fW,D,_,_,_,_,_],
  [_,_,D,_,_,_,_,D,_,_,_,_,_,_,_,_],
  [_,_,D,fO,_,_,_,D,fO,_,_,_,_,_,_,_],
  [_,_,_,E,_,_,_,_,E,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** Rabbit — idle. Tall ears, round body, white tail puff. */
const RABBIT_IDLE = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,D,_,D,_,_,_,_,_], // ear tips
  [_,_,_,_,_,_,_,_,D,rL,D,rL,_,_,_,_], // ears
  [_,_,_,_,_,_,_,_,D,rL,D,rL,_,_,_,_],
  [_,_,_,_,_,_,_,D,rG,rG,rG,rG,D,_,_,_], // head top
  [_,_,_,_,_,_,D,rG,rG,rG,E,rG,rL,D,_,_], // eye
  [_,_,D,D,D,D,rG,rG,rG,rG,rG,rG,D,_,_,_], // neck
  [_,D,rW,rG,rG,rG,rG,rG,rG,rG,rG,D,_,_,_,_], // body, tail puff
  [_,D,rL,rL,rL,rL,rL,rL,rL,rL,D,_,_,_,_,_], // belly
  [_,_,D,D,_,_,_,D,D,_,_,_,_,_,_,_],   // back legs / front feet
  [_,_,D,rG,_,_,_,D,rG,D,_,_,_,_,_,_],
  [_,_,_,E,_,_,_,_,E,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** Rabbit — walk frame 1 (mid hop, body slightly raised). */
const RABBIT_WALK_1 = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,D,_,D,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,D,rL,D,rL,_,_,_,_],
  [_,_,_,_,_,_,_,_,D,rL,D,rL,_,_,_,_],
  [_,_,_,_,_,_,_,D,rG,rG,rG,rG,D,_,_,_],
  [_,_,_,_,_,_,D,rG,rG,rG,E,rG,rL,D,_,_],
  [_,_,D,D,D,D,rG,rG,rG,rG,rG,rG,D,_,_,_],
  [_,D,rW,rG,rG,rG,rG,rG,rG,rG,rG,D,_,_,_,_],
  [_,D,rL,rL,rL,rL,rL,rL,rL,rL,D,_,_,_,_,_],
  [_,_,_,_,_,_,_,D,_,_,_,_,_,_,_,_],   // feet tucked (mid-hop)
  [_,_,_,_,_,_,_,D,rG,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,E,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** Rabbit — walk frame 2 (landing crouch, body lower). */
const RABBIT_WALK_2 = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,D,_,D,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,D,rL,D,rL,_,_,_,_],
  [_,_,_,_,_,_,_,_,D,rL,D,rL,_,_,_,_],
  [_,_,_,_,_,_,_,D,rG,rG,rG,rG,D,_,_,_],
  [_,_,_,_,_,_,D,rG,rG,rG,E,rG,rL,D,_,_],
  [_,_,D,D,D,D,rG,rG,rG,rG,rG,rG,D,_,_,_],
  [_,D,rW,rG,rG,rG,rG,rG,rG,rG,rG,D,_,_,_,_],
  [_,D,rL,rL,rL,rL,rL,rL,rL,rL,D,_,_,_,_,_],
  [_,_,D,D,D,_,_,D,D,D,_,_,_,_,_,_],   // landing with all 4 feet down
  [_,_,_,E,_,_,_,_,_,E,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

/** Boar — idle. Stocky, low body, tusks, bristly back. */
const BOAR_IDLE = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,D,_,D,_,D,_,D,_,_,_,_,_], // bristles on back
  [_,_,_,D,bB,D,bB,D,bB,D,bB,D,D,_,_,_], // head top + bristle bases
  [_,_,D,bB,bB,bB,bB,bB,bB,bB,bB,bB,bL,D,_,_], // body top, snout
  [_,D,bB,bB,bB,bB,bB,bB,bB,bB,bB,E,bL,bT,D,_], // eye + tusk
  [_,D,bB,bB,bB,bB,bB,bB,bB,bB,bB,bB,bL,bT,D,_], // lower tusk
  [_,D,bL,bL,bL,bL,bL,bL,bL,bL,bL,bL,bL,D,_,_], // belly
  [_,_,D,D,D,_,_,D,D,_,_,D,D,_,_,_],
  [_,_,D,bB,D,_,_,D,bB,_,_,D,bB,_,_,_],
  [_,_,D,bB,D,_,_,D,bB,_,_,D,bB,_,_,_],
  [_,_,_,E,_,_,_,_,E,_,_,_,E,_,_,_],   // hooves
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

const BOAR_WALK_1 = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,D,_,D,_,D,_,D,_,_,_,_,_],
  [_,_,_,D,bB,D,bB,D,bB,D,bB,D,D,_,_,_],
  [_,_,D,bB,bB,bB,bB,bB,bB,bB,bB,bB,bL,D,_,_],
  [_,D,bB,bB,bB,bB,bB,bB,bB,bB,bB,E,bL,bT,D,_],
  [_,D,bB,bB,bB,bB,bB,bB,bB,bB,bB,bB,bL,bT,D,_],
  [_,D,bL,bL,bL,bL,bL,bL,bL,bL,bL,bL,bL,D,_,_],
  [_,_,_,D,D,_,_,D,_,_,_,D,D,_,_,_],
  [_,_,_,_,D,bB,_,D,_,_,_,D,bB,_,_,_],
  [_,_,_,_,_,D,bB,D,_,_,_,D,bB,_,_,_],
  [_,_,_,_,_,_,E,_,_,_,_,_,E,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

const BOAR_WALK_2 = [
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,D,_,D,_,D,_,D,_,_,_,_,_],
  [_,_,_,D,bB,D,bB,D,bB,D,bB,D,D,_,_,_],
  [_,_,D,bB,bB,bB,bB,bB,bB,bB,bB,bB,bL,D,_,_],
  [_,D,bB,bB,bB,bB,bB,bB,bB,bB,bB,E,bL,bT,D,_],
  [_,D,bB,bB,bB,bB,bB,bB,bB,bB,bB,bB,bL,bT,D,_],
  [_,D,bL,bL,bL,bL,bL,bL,bL,bL,bL,bL,bL,D,_,_],
  [_,_,D,D,_,_,_,D,D,_,_,D,_,_,_,_],
  [_,_,D,bB,_,_,_,D,bB,_,_,D,bB,_,_,_],
  [_,_,D,bB,_,_,_,_,D,bB,_,D,bB,_,_,_],
  [_,_,_,E,_,_,_,_,_,E,_,_,E,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
  [_,_,_,_,_,_,_,_,_,_,_,_,_,_,_,_],
];

// ─── Rendering helpers ───────────────────────────────────────────────────────

function frameToBuffer(frame) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = frame[y]?.[x] ?? _;
      const i = (y * SIZE + x) * 4;
      buf[i]     = px[0];
      buf[i + 1] = px[1];
      buf[i + 2] = px[2];
      buf[i + 3] = px[3];
    }
  }
  return buf;
}

async function writeSheet(filename, frames) {
  const w = SIZE * frames.length;
  const buf = Buffer.alloc(w * SIZE * 4);
  frames.forEach((frame, fi) => {
    const fb = frameToBuffer(frame);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const src = (y * SIZE + x) * 4;
        const dst = (y * w + fi * SIZE + x) * 4;
        fb.copy(buf, dst, src, src + 4);
      }
    }
  });
  const out = path.join(OUT_DIR, filename);
  await sharp(buf, { raw: { width: w, height: SIZE, channels: 4 } }).png().toFile(out);
  console.log(`Written: ${out} (${frames.length} frames, ${w}×${SIZE})`);
}

// ─── Generate all sheets ─────────────────────────────────────────────────────

await mkdir(OUT_DIR, { recursive: true });

await writeSheet('fauna-deer-idle.png',   [DEER_IDLE]);
await writeSheet('fauna-deer-walk.png',   [DEER_WALK_1, DEER_WALK_2]);
await writeSheet('fauna-fox-idle.png',    [FOX_IDLE]);
await writeSheet('fauna-fox-walk.png',    [FOX_WALK_1, FOX_WALK_2]);
await writeSheet('fauna-rabbit-idle.png', [RABBIT_IDLE]);
await writeSheet('fauna-rabbit-walk.png', [RABBIT_WALK_1, RABBIT_WALK_2]);
await writeSheet('fauna-boar-idle.png',   [BOAR_IDLE]);
await writeSheet('fauna-boar-walk.png',   [BOAR_WALK_1, BOAR_WALK_2]);

console.log('\nAll forest fauna sprite sheets generated.');
