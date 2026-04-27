/**
 * IsoRenderer — shared isometric drawing utilities.
 *
 * Extracted from SettlementForgeScene so both the forge preview and the
 * SettlementEditorScene can share the same coordinate math and drawing code.
 *
 * All functions are pure — they take an IsoConfig struct instead of reading
 * class fields, so they work from any Phaser scene.
 *
 * Coordinate system (same as SettlementForgeScene):
 *   isoPos(tx, ty) gives the NORTH APEX (top point) of the diamond for
 *   that tile. East apex = north + (isoW/2, isoH/2), etc.
 */

import * as Phaser from 'phaser';

/** All the parameters needed to convert between tile and screen space. */
export interface IsoConfig {
  /** World x of the north apex of tile (0,0). */
  originX: number;
  /** World y of the north apex of tile (0,0). */
  originY: number;
  /** Pixel width of one iso tile diamond (left apex to right apex). */
  isoW: number;
  /** Pixel height of one iso tile diamond (top apex to bottom apex). */
  isoH: number;
}

/** World position of the north apex of tile (tx, ty). */
export function isoPos(cfg: IsoConfig, tx: number, ty: number): { x: number; y: number } {
  return {
    x: cfg.originX + (tx - ty) * (cfg.isoW / 2),
    y: cfg.originY + (tx + ty) * (cfg.isoH / 2),
  };
}

/**
 * Inverse of isoPos — converts a world position to floating-point tile coords.
 * Round the result to get the nearest integer tile.
 *
 * Derivation:
 *   dx = (tx - ty) * hw  →  dx/hw = tx - ty
 *   dy = (tx + ty) * hh  →  dy/hh = tx + ty
 *   tx = (dx/hw + dy/hh) / 2
 *   ty = (dy/hh - dx/hw) / 2
 */
export function screenToTile(cfg: IsoConfig, wx: number, wy: number): { tx: number; ty: number } {
  const dx = wx - cfg.originX;
  const dy = wy - cfg.originY;
  const hw = cfg.isoW / 2;
  const hh = cfg.isoH / 2;
  return {
    tx: (dx / hw + dy / hh) / 2,
    ty: (dy / hh - dx / hw) / 2,
  };
}

/** Multiply each RGB channel of a hex colour by `factor` (0–1 = darken). */
export function darken(color: number, factor: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * factor);
  const g = Math.floor(((color >> 8) & 0xff) * factor);
  const b = Math.floor((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/**
 * Draw a flat iso diamond at tile (tx, ty).
 * Optionally stroked — pass strokeColor to draw the outline.
 */
export function drawIsoDiamond(
  gfx: Phaser.GameObjects.Graphics,
  cfg: IsoConfig,
  tx: number,
  ty: number,
  fillColor: number,
  fillAlpha: number,
  strokeColor?: number,
  strokeAlpha?: number,
): void {
  const { x, y } = isoPos(cfg, tx, ty);
  const hw = cfg.isoW / 2;
  const hh = cfg.isoH / 2;

  gfx.fillStyle(fillColor, fillAlpha);
  gfx.beginPath();
  gfx.moveTo(x, y);
  gfx.lineTo(x + hw, y + hh);
  gfx.lineTo(x, y + hh * 2);
  gfx.lineTo(x - hw, y + hh);
  gfx.closePath();
  gfx.fillPath();

  if (strokeColor !== undefined) {
    gfx.lineStyle(1, strokeColor, strokeAlpha ?? 0.3);
    gfx.beginPath();
    gfx.moveTo(x, y);
    gfx.lineTo(x + hw, y + hh);
    gfx.lineTo(x, y + hh * 2);
    gfx.lineTo(x - hw, y + hh);
    gfx.closePath();
    gfx.strokePath();
  }
}

/** Corner points returned by drawIsoBox — used to mark entrance edges. */
export interface IsoBoxCorners {
  topN: { x: number; y: number };
  topE: { x: number; y: number };
  topS: { x: number; y: number };
  topW: { x: number; y: number };
  botE: { x: number; y: number };
  botS: { x: number; y: number };
  botW: { x: number; y: number };
}

/**
 * Draw an isometric box (building) centred at tile (tx, ty).
 *
 * The box has a top diamond face and two visible side faces (right = east,
 * left = south). heightPx lifts the top face above the ground plane.
 * Pass 0 for a flat footprint view (same as SettlementForgeScene).
 *
 * Returns the eight corner points so callers can draw entrance markers.
 */
export function drawIsoBox(
  gfx: Phaser.GameObjects.Graphics,
  cfg: IsoConfig,
  tx: number,
  ty: number,
  widthTiles: number,
  _depthTiles: number,
  heightPx: number,
  color: number,
  alpha: number,
): IsoBoxCorners {
  // The building footprint extends `half` tiles in each direction from centre.
  // ceil matches the stamp logic in SettlementPlacement.
  const half = Math.ceil(widthTiles / 2);
  const { x, y } = isoPos(cfg, tx - half, ty - half);
  const hw = cfg.isoW / 2;
  const hh = cfg.isoH / 2;

  const fullW = 2 * half + 1;
  // _depthTiles kept in the signature for API symmetry with SettlementForgeScene's drawIsoBox.
  // Footprint is always square so we only use fullW.
  const sw = hw * fullW;
  const sh = hh * fullW; // always square footprint

  const topN = { x: x,      y: y - heightPx };
  const topE = { x: x + sw, y: y + sh - heightPx };
  const topS = { x: x,      y: y + sh * 2 - heightPx };
  const topW = { x: x - sw, y: y + sh - heightPx };

  const botE = { x: x + sw, y: y + sh };
  const botS = { x: x,      y: y + sh * 2 };
  const botW = { x: x - sw, y: y + sh };

  const fillQuad = (
    c: number, a: number,
    p1: { x: number; y: number }, p2: { x: number; y: number },
    p3: { x: number; y: number }, p4: { x: number; y: number },
  ) => {
    gfx.fillStyle(c, a);
    gfx.beginPath();
    gfx.moveTo(p1.x, p1.y);
    gfx.lineTo(p2.x, p2.y);
    gfx.lineTo(p3.x, p3.y);
    gfx.lineTo(p4.x, p4.y);
    gfx.closePath();
    gfx.fillPath();
  };

  // Right face (east-facing) — darkest
  fillQuad(darken(color, 0.7), alpha, topE, topS, botS, botE);
  // Left face (south-facing) — mid tone
  fillQuad(darken(color, 0.5), alpha, topS, topW, botW, botS);
  // Top face — full colour
  fillQuad(color, alpha, topN, topE, topS, topW);

  // Outline edges
  gfx.lineStyle(1, 0x000000, 0.4);
  gfx.beginPath();
  gfx.moveTo(topN.x, topN.y);
  gfx.lineTo(topE.x, topE.y);
  gfx.lineTo(topS.x, topS.y);
  gfx.lineTo(topW.x, topW.y);
  gfx.closePath();
  gfx.strokePath();
  gfx.lineBetween(topE.x, topE.y, botE.x, botE.y);
  gfx.lineBetween(topS.x, topS.y, botS.x, botS.y);
  gfx.lineBetween(topW.x, topW.y, botW.x, botW.y);

  return { topN, topE, topS, topW, botE, botS, botW };
}
