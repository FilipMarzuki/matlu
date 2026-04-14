import * as Phaser from 'phaser';
/**
 * WorldObject — base class for all static environment objects.
 *
 * Unlike Entity, WorldObject has no update() loop — it is placed once
 * and lives passively in the world.
 *
 * Depth sorting: origin(0.5, 1) anchors the sprite at its bottom centre so
 * that setDepth(this.y) produces correct overlap — objects further down the
 * screen render in front of objects further up.
 */
export abstract class WorldObject extends Phaser.GameObjects.Sprite {
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    texture: string,
    frame?: string | number
  ) {
    super(scene, x, y, texture, frame);
    scene.add.existing(this);
    // Bottom-centre anchor for correct depth sorting in top-down perspective
    this.setOrigin(0.5, 1);
  }

  /**
   * Set depth based on y-position for correct top-down overlap.
   * Call once after all objects are placed in the scene.
   */
  sortDepth(): void {
    this.setDepth(this.y);
  }
}
