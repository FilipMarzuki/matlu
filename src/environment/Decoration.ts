import { WorldObject } from './WorldObject';

/**
 * Decoration — ren dekoration utan kollision.
 *
 * Blommor, gräs, löv, stenar som syns i världen men som spelaren
 * går igenom. Prestanda: hundratals instanser är OK eftersom de
 * inte har fysik eller update-loopar.
 */
export class Decoration extends WorldObject {
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    frame?: string | number
  ) {
    super(scene, x, y, texture, frame);
  }
}
