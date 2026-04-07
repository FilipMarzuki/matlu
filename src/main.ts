import Phaser from 'phaser';
import VirtualJoystickPlugin from 'phaser3-rex-plugins/plugins/virtualjoystick-plugin';
import './lib/supabaseClient';
import { WilderviewScene } from './scenes/WilderviewScene';
import { GameScene } from './scenes/GameScene';
import { CreditsScene } from './scenes/CreditsScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-container',
  backgroundColor: 0x2d6b2e,
  // Disable anti-aliasing so pixel-art sprites render crisp rather than blurry.
  render: { pixelArt: true },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  // RESIZE makes the canvas fill the full viewport — no letterboxing.
  // UI elements must use this.scale.width/height instead of hardcoded 800×600.
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // Register the rex virtual joystick plugin from npm rather than CDN so it
  // works reliably in production (raw.githubusercontent.com is not dependable).
  plugins: {
    global: [
      {
        key: 'rexvirtualjoystickplugin',
        plugin: VirtualJoystickPlugin,
        start: true,
      },
    ],
  },
  // WilderviewScene is the default entry point; it launches GameScene on demand
  scene: [WilderviewScene, GameScene, CreditsScene],
});

// Expose game instance for Playwright tests and dev tooling
if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
  (window as unknown as Record<string, unknown>)['__game'] = game;
}
