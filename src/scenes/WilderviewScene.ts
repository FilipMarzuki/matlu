import Phaser from 'phaser';

/**
 * Passthrough — immediately starts GameScene, which owns its own attract mode
 * (camera cycling through animals before the player presses play).
 */
export class WilderviewScene extends Phaser.Scene {
  constructor() {
    super({ key: 'WilderviewScene' });
  }

  create(): void {
    this.scene.start('GameScene');
  }
}
