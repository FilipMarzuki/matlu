import Phaser from 'phaser';
import VirtualJoystickPlugin from 'phaser3-rex-plugins/plugins/virtualjoystick-plugin';
import './lib/supabaseClient';
import { MainMenuScene } from './scenes/MainMenuScene';
import { WilderviewScene } from './scenes/WilderviewScene';
import { GameScene } from './scenes/GameScene';
import { CreditsScene } from './scenes/CreditsScene';
import { NpcDialogScene } from './scenes/NpcDialogScene';
import { SettingsScene } from './scenes/SettingsScene';
import { PauseMenuScene } from './scenes/PauseMenuScene';

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
  // MainMenuScene is the entry point (first in array = auto-started).
  // WilderviewScene is kept for compatibility but now redirects to MainMenuScene.
  scene: [MainMenuScene, WilderviewScene, GameScene, CreditsScene, NpcDialogScene, SettingsScene, PauseMenuScene],
});

// Restore mute preference saved by SettingsScene.
// Must run after the game is created so the sound manager exists.
if (typeof localStorage !== 'undefined' && localStorage.getItem('matlu_muted') === 'true') {
  game.sound.setMute(true);
}

// Expose game instance for Playwright tests and dev tooling.
// Always set so that preview-mode Playwright tests can access it.
(window as unknown as Record<string, unknown>)['__game'] = game;
