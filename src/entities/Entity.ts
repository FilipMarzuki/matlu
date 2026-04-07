/**
 * Entity — base class for all game entities with position and lifecycle.
 *
 * Every moving object in Matlu inherits from here: player, animals, enemies.
 * The class only handles position and basic Phaser integration — no behaviour
 * is added at this level.
 */
export abstract class Entity extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    scene.add.existing(this);
  }

  /**
   * Called every frame by Phaser's game loop.
   * Subclasses implement their specific logic here.
   */
  abstract update(delta: number): void;
}
