/**
 * WorldObject — basklass för alla statiska miljöobjekt.
 *
 * Till skillnad från Entity har WorldObject ingen update()-loop —
 * den placeras en gång och lever sedan passivt i världen.
 *
 * Djupsortering: origin(0.5, 1) förankrar i botten så att
 * setDepth(this.y) ger korrekt overlap — objekt längre ner
 * renderas framför objekt längre upp.
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
