import Phaser from 'phaser';

/**
 * Passthrough — routes immediately to MainMenuScene.
 * Kept for compatibility; MainMenuScene is the true entry point.
 */
export class WilderviewScene extends Phaser.Scene {
  constructor() {
    super({ key: 'WilderviewScene' });
  }

  create(): void {
    this.scene.start('MainMenuScene');
  }
}
