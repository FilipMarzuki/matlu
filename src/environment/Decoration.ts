import * as Phaser from 'phaser';
import { WorldObject } from './WorldObject';

/**
 * Decoration — pure visual decoration with no collision.
 *
 * Flowers, grass, leaves, stones that appear in the world but that the player
 * walks through. Performance: hundreds of instances are fine since they have
 * no physics bodies or update loops.
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
